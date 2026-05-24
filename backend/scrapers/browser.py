"""
Browser-based scraper: uses Playwright to render JavaScript-heavy pages.
This is the second method tried in the fallback pipeline.

For each site, the flow is two steps:
  1. Load the search page with a real browser (so JS renders the product cards).
     Parse the rendered HTML with BeautifulSoup to find the best-matching
     candidate and its product URL — reusing basic.py's similarity logic.
  2. Navigate to that product's own page and scrape the full details directly
     from it (title, price, rating, review count are much more complete there).
"""

import json
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
from models import ProductResult, ScrapingStatus, ScrapingMethod
from scrapers.basic import (
    best_match, parse_price, parse_rating, parse_review_count, MAX_CANDIDATES
)

PAGE_TIMEOUT = 20_000  # ms — max wait for a page or element to load
VIEWPORT     = {"width": 1280, "height": 800}
USER_AGENT   = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# CSS selector that signals the search results have rendered for each site.
# We wait for this before grabbing page.content() so JS has time to run.
SEARCH_READY_SELECTOR = {
    "Amazon.com":  '[data-component-type="s-search-result"]',
    "BestBuy.com": ".sku-item",
    "Walmart.com": "script#__NEXT_DATA__",   # Walmart is SSR, present immediately
    "Newegg.com":  ".item-cell",
}


# ---------------------------------------------------------------------------
# Step 1 helpers — extract candidate list from rendered search-page HTML
# (identical selectors to basic.py; we just feed them JS-rendered HTML)
# ---------------------------------------------------------------------------

def _extract_amazon_candidates(html: str, query: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    candidates = []
    for card in soup.select('[data-component-type="s-search-result"]')[:MAX_CANDIDATES]:
        title_el = (
            card.select_one("h2 a span")
            or card.select_one("h2 span")
            or card.select_one(".a-text-normal")
        )
        title    = title_el.get_text(strip=True) if title_el else None
        price_el = card.select_one(".a-price .a-offscreen")
        price_text = price_el.get_text(strip=True) if price_el else None
        link_el  = card.select_one("h2 a")
        url = ("https://www.amazon.com" + link_el["href"]) if link_el and link_el.get("href") else None
        if title:
            candidates.append({"title": title, "price": parse_price(price_text), "url": url})
    return best_match(candidates, query)


def _extract_bestbuy_candidates(html: str, query: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    candidates = []
    for card in soup.select(".sku-item")[:MAX_CANDIDATES]:
        title_el = card.select_one(".sku-title a")
        title    = title_el.get_text(strip=True) if title_el else None
        price_el = card.select_one(".priceView-customer-price span")
        price_text = price_el.get_text(strip=True) if price_el else None
        link_el  = card.select_one(".sku-title a")
        url = ("https://www.bestbuy.com" + link_el["href"]) if link_el and link_el.get("href") else None
        if title:
            candidates.append({"title": title, "price": parse_price(price_text), "url": url})
    return best_match(candidates, query)


def _extract_walmart_candidates(html: str, query: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    candidates = []
    script = soup.find("script", {"id": "__NEXT_DATA__"})
    if script:
        try:
            data   = json.loads(script.get_text())
            props  = data.get("props", {}).get("pageProps", {}).get("initialData", {})
            stacks = props.get("searchResult", {}).get("itemStacks", [])
            all_items = []
            for stack in stacks:
                all_items.extend(stack.get("items", []))
            for item in all_items[:MAX_CANDIDATES]:
                name = item.get("name") or item.get("title")
                if not name:
                    continue
                price_text = item.get("priceInfo", {}).get("linePrice", "")
                canonical  = item.get("canonicalUrl", "")
                url = ("https://www.walmart.com" + canonical) if canonical else None
                candidates.append({"title": name, "price": parse_price(price_text), "url": url})
        except (json.JSONDecodeError, KeyError):
            pass
    return best_match(candidates, query)


def _extract_newegg_candidates(html: str, query: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    candidates = []
    for card in soup.select(".item-cell")[:MAX_CANDIDATES]:
        title_el     = card.select_one(".item-title")
        title        = title_el.get_text(strip=True) if title_el else None
        price_dollars = card.select_one(".price-current strong")
        price_cents   = card.select_one(".price-current sup:last-child")
        if price_dollars:
            dollars = price_dollars.get_text(strip=True).replace(",", "")
            cents   = price_cents.get_text(strip=True) if price_cents else "00"
            try:
                price = float(f"{dollars}.{cents}")
            except ValueError:
                price = parse_price(price_dollars.get_text(strip=True))
        else:
            price = None
        link_el = card.select_one(".item-title")
        url = link_el["href"] if link_el and link_el.get("href") else None
        if title:
            candidates.append({"title": title, "price": price, "url": url})
    return best_match(candidates, query)


# ---------------------------------------------------------------------------
# Step 2 helpers — scrape full details from a product's own page
# ---------------------------------------------------------------------------

async def _scrape_amazon_product(page) -> dict:
    """Scrape title, price, rating, review count from an Amazon product page."""
    try:
        await page.wait_for_selector("#productTitle", timeout=PAGE_TIMEOUT)
    except PlaywrightTimeout:
        pass

    title_el = await page.query_selector("#productTitle")
    title    = (await title_el.inner_text()).strip() if title_el else None

    price_el   = await page.query_selector(".a-price .a-offscreen")
    price_text = (await price_el.inner_text()).strip() if price_el else None

    # "#acrPopover" has a title attribute like "4.6 out of 5 stars"
    rating_el   = await page.query_selector("#acrPopover")
    rating_text = await rating_el.get_attribute("title") if rating_el else None

    # "#acrCustomerReviewText" reads "315 ratings"
    review_el   = await page.query_selector("#acrCustomerReviewText")
    review_text = (await review_el.inner_text()).strip() if review_el else None

    return {
        "title":        title,
        "price":        parse_price(price_text),
        "rating":       parse_rating(rating_text),
        "review_count": parse_review_count(review_text),
        "url":          page.url,
    }


async def _scrape_bestbuy_product(page) -> dict:
    """Scrape title, price, rating, review count from a BestBuy product page."""
    try:
        await page.wait_for_selector("h1", timeout=PAGE_TIMEOUT)
    except PlaywrightTimeout:
        pass

    # BestBuy uses several h1 class names; try the most specific one first
    title_el = await page.query_selector("h1.heading-5")
    if not title_el:
        title_el = await page.query_selector("h1")
    title = (await title_el.inner_text()).strip() if title_el else None

    price_el   = await page.query_selector(".priceView-customer-price span")
    price_text = (await price_el.inner_text()).strip() if price_el else None

    rating_el   = await page.query_selector(".c-review-average")
    rating_text = (await rating_el.inner_text()).strip() if rating_el else None

    review_el   = await page.query_selector(".c-reviews")
    review_text = (await review_el.inner_text()).strip() if review_el else None

    return {
        "title":        title,
        "price":        parse_price(price_text),
        "rating":       parse_rating(rating_text),
        "review_count": parse_review_count(review_text),
        "url":          page.url,
    }


async def _scrape_walmart_product(page) -> dict:
    """Scrape title, price, rating, review count from a Walmart product page."""
    try:
        await page.wait_for_selector("h1", timeout=PAGE_TIMEOUT)
    except PlaywrightTimeout:
        pass

    # Walmart uses microdata (itemprop) — great for structured extraction
    title_el = await page.query_selector("h1[itemprop='name']")
    if not title_el:
        title_el = await page.query_selector("h1")
    title = (await title_el.inner_text()).strip() if title_el else None

    # itemprop="price" holds the numeric value in a "content" attribute
    price_el   = await page.query_selector("[itemprop='price']")
    price_text = await price_el.get_attribute("content") if price_el else None

    rating_el   = await page.query_selector("[itemprop='ratingValue']")
    rating_text = await rating_el.get_attribute("content") if rating_el else None

    review_el   = await page.query_selector("[itemprop='reviewCount']")
    review_text = await review_el.get_attribute("content") if review_el else None

    return {
        "title":        title,
        "price":        parse_price(price_text),
        "rating":       parse_rating(rating_text),
        "review_count": parse_review_count(review_text),
        "url":          page.url,
    }


async def _scrape_newegg_product(page) -> dict:
    """Scrape title, price, rating, review count from a Newegg product page."""
    try:
        await page.wait_for_selector("h1.product-title", timeout=PAGE_TIMEOUT)
    except PlaywrightTimeout:
        pass

    title_el = await page.query_selector("h1.product-title")
    if not title_el:
        title_el = await page.query_selector(".product-name h1")
    title = (await title_el.inner_text()).strip() if title_el else None

    price_el   = await page.query_selector(".price-current strong")
    price_text = (await price_el.inner_text()).strip() if price_el else None

    rating_el   = await page.query_selector(".product-rating .rating")
    rating_text = (await rating_el.inner_text()).strip() if rating_el else None

    review_el   = await page.query_selector(".product-reviews")
    review_text = (await review_el.inner_text()).strip() if review_el else None

    return {
        "title":        title,
        "price":        parse_price(price_text),
        "rating":       parse_rating(rating_text),
        "review_count": parse_review_count(review_text),
        "url":          page.url,
    }


# ---------------------------------------------------------------------------
# Dispatch tables
# ---------------------------------------------------------------------------

SITE_SEARCH_EXTRACTORS = {
    "Amazon.com":  _extract_amazon_candidates,
    "BestBuy.com": _extract_bestbuy_candidates,
    "Walmart.com": _extract_walmart_candidates,
    "Newegg.com":  _extract_newegg_candidates,
}

SITE_PRODUCT_SCRAPERS = {
    "Amazon.com":  _scrape_amazon_product,
    "BestBuy.com": _scrape_bestbuy_product,
    "Walmart.com": _scrape_walmart_product,
    "Newegg.com":  _scrape_newegg_product,
}


# ---------------------------------------------------------------------------
# Core two-step browser flow
# ---------------------------------------------------------------------------

async def _scrape_with_browser(page, site_name: str, search_url: str, query: str) -> dict:
    """
    Step 1: Load search page → find best candidate with its product URL.
    Step 2: Navigate to product page → scrape full details.
    """
    # --- Step 1: Load the search page ---
    await page.goto(search_url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)

    # BestBuy geo-block: if we got redirected outside bestbuy.com (e.g. to
    # bestbuy.ca or a country-selector page), fast-fail so the pipeline moves
    # on to LLM/Firecrawl rather than wasting time trying to interact.
    if site_name == "BestBuy.com" and "bestbuy.com" not in page.url:
        raise ValueError("BestBuy redirected outside bestbuy.com (geo-block) — fast-fail")

    # Wait until the first product card is visible so JS results are ready
    selector = SEARCH_READY_SELECTOR.get(site_name)
    if selector:
        try:
            await page.wait_for_selector(selector, timeout=PAGE_TIMEOUT)
        except PlaywrightTimeout:
            pass  # proceed anyway; extractor returns None if nothing useful is there

    # Parse the fully-rendered HTML with BeautifulSoup
    html       = await page.content()
    extract_fn = SITE_SEARCH_EXTRACTORS[site_name]
    candidate  = extract_fn(html, query)

    if not candidate or not candidate.get("url"):
        raise ValueError(f"No matching product found on {site_name} search page")

    # --- Step 2: Navigate to the product page ---
    await page.goto(candidate["url"], wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)

    scrape_fn = SITE_PRODUCT_SCRAPERS[site_name]
    return await scrape_fn(page)


# ---------------------------------------------------------------------------
# Main entry point called by the pipeline
# ---------------------------------------------------------------------------

async def scrape_browser(site_name: str, search_url: str, query: str) -> ProductResult:
    """
    Entry point for the browser scraping method.
    Launches a headless Chromium browser, runs the two-step search→product flow,
    and returns a ProductResult.
    """
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                viewport=VIEWPORT,
                user_agent=USER_AGENT,
                locale="en-US",
            )
            page        = await context.new_page()
            result_dict = await _scrape_with_browser(page, site_name, search_url, query)
        finally:
            await browser.close()

    return ProductResult(
        website=site_name,
        title=result_dict.get("title"),
        price=result_dict.get("price"),
        rating=result_dict.get("rating"),
        review_count=result_dict.get("review_count"),
        product_url=result_dict.get("url"),
        status=ScrapingStatus.SUCCESS,
        method=ScrapingMethod.BROWSER,
    )
