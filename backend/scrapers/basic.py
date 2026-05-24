"""
Basic scraper: uses requests + BeautifulSoup.
This is the first method tried in the fallback pipeline.
"""

import re
import requests
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
from models import ProductResult, ScrapingStatus, ScrapingMethod

# Minimum word-overlap score to consider a result relevant (0.0 - 1.0)
SIMILARITY_THRESHOLD = 0.3
# How many top search results to compare before picking the best match
MAX_CANDIDATES = 5

ua = UserAgent()

def get_headers() -> dict:
    """Return realistic browser headers to avoid simple bot detection."""
    return {
        "User-Agent": ua.random,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }


def similarity_score(query: str, title: str) -> float:
    """
    Calculates how well a product title matches the search query.
    Uses word overlap: score = matching words / total words in query.
    Both strings are lowercased and stripped of punctuation before comparison.
    Returns a float between 0.0 and 1.0.
    """
    def tokenize(text: str) -> set:
        text = text.lower()
        text = re.sub(r"[^a-z0-9\s]", " ", text)
        return set(text.split())

    query_words = tokenize(query)
    title_words = tokenize(title)

    if not query_words:
        return 0.0

    matching = query_words & title_words
    return len(matching) / len(query_words)


# Phrases that strongly indicate an accessory rather than the product itself.
# We check if the title contains one of these phrases (case-insensitive).
ACCESSORY_PHRASES = [
    "case for", "cover for", "stand for", "compatible with",
    "screen protector", "tempered glass", "keyboard for",
    "stylus for", "pen for", "charger for", "cable for",
    "sleeve for", "bag for", "pouch for", "folio for",
    "replacement for", "skin for", "bumper for",
]


def is_accessory(title: str) -> bool:
    """
    Returns True if the title looks like an accessory rather than the product.
    Uses phrase matching so words like 'screen' in 'Touchscreen Tablet' are safe.
    """
    title_lower = title.lower()
    return any(phrase in title_lower for phrase in ACCESSORY_PHRASES)


def best_match(candidates: list[dict], query: str) -> dict | None:
    """
    Given a list of candidate dicts with a 'title' key,
    return the one that best matches the query — skipping accessories.
    Returns None if no candidate scores above the threshold.
    """
    best = None
    best_score = SIMILARITY_THRESHOLD  # must beat this to be accepted

    for candidate in candidates:
        title = candidate.get("title") or ""

        # Skip accessories — they score perfectly but are not the product
        if is_accessory(title):
            continue

        score = similarity_score(query, title)
        if score > best_score:
            best_score = score
            best = candidate

    return best


def parse_price(text: str) -> float | None:
    """Extract the first price-looking number from a string."""
    if not text:
        return None
    # Remove currency symbols and commas, then extract first float
    match = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
    if match:
        try:
            return float(match.group())
        except ValueError:
            return None
    return None


def parse_rating(text: str) -> float | None:
    """Extract a rating number like '4.6' from strings like '4.6 out of 5 stars'."""
    if not text:
        return None
    match = re.search(r"(\d+\.?\d*)\s*out of\s*\d+", text)
    if match:
        return float(match.group(1))
    # Fallback: just grab the first float
    match = re.search(r"\d+\.?\d*", text)
    if match:
        val = float(match.group())
        return val if val <= 5.0 else None
    return None


def parse_review_count(text: str) -> int | None:
    """Extract a review count from strings like '(1,234)' or '1,234 ratings'."""
    if not text:
        return None
    text = text.replace(",", "")
    match = re.search(r"\d+", text)
    if match:
        return int(match.group())
    return None


# ---------------------------------------------------------------------------
# Site-specific scrapers
# ---------------------------------------------------------------------------

def scrape_amazon(search_url: str, query: str) -> dict | None:
    """Scrape Amazon search results page."""
    resp = requests.get(search_url, headers=get_headers(), timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    candidates = []
    cards = soup.select('[data-component-type="s-search-result"]')[:MAX_CANDIDATES]

    for card in cards:
        # Title — try multiple selectors Amazon has used
        title_el = (
            card.select_one("h2 a span")
            or card.select_one("h2 span")
            or card.select_one(".a-text-normal")
        )
        title = title_el.get_text(strip=True) if title_el else None

        # Price — the offscreen span holds the machine-readable price
        price_el = card.select_one(".a-price .a-offscreen")
        price_text = price_el.get_text(strip=True) if price_el else None

        # Rating
        rating_el = card.select_one(".a-icon-alt")
        rating_text = rating_el.get_text(strip=True) if rating_el else None

        # Review count
        review_el = card.select_one(".a-size-base.s-underline-text")
        review_text = review_el.get_text(strip=True) if review_el else None

        # Product URL
        link_el = card.select_one("h2 a")
        url = ("https://www.amazon.com" + link_el["href"]) if link_el and link_el.get("href") else None

        if title:
            candidates.append({
                "title": title,
                "price": parse_price(price_text),
                "rating": parse_rating(rating_text),
                "review_count": parse_review_count(review_text),
                "url": url,
            })

    return best_match(candidates, query)


def scrape_bestbuy(search_url: str, query: str) -> dict | None:
    """Scrape BestBuy search results page."""
    resp = requests.get(search_url, headers=get_headers(), timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    candidates = []
    cards = soup.select(".sku-item")[:MAX_CANDIDATES]

    for card in cards:
        title_el = card.select_one(".sku-title a")
        title = title_el.get_text(strip=True) if title_el else None

        price_el = card.select_one(".priceView-customer-price span")
        price_text = price_el.get_text(strip=True) if price_el else None

        rating_el = card.select_one(".c-review-average")
        rating_text = rating_el.get_text(strip=True) if rating_el else None

        review_el = card.select_one(".c-reviews")
        review_text = review_el.get_text(strip=True) if review_el else None

        link_el = card.select_one(".sku-title a")
        url = ("https://www.bestbuy.com" + link_el["href"]) if link_el and link_el.get("href") else None

        if title:
            candidates.append({
                "title": title,
                "price": parse_price(price_text),
                "rating": parse_rating(rating_text),
                "review_count": parse_review_count(review_text),
                "url": url,
            })

    return best_match(candidates, query)


def scrape_walmart(search_url: str, query: str) -> dict | None:
    """Scrape Walmart search results page via embedded __NEXT_DATA__ JSON."""
    import json

    resp = requests.get(search_url, headers=get_headers(), timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    candidates = []

    # Walmart embeds all search results in a <script id="__NEXT_DATA__"> JSON blob.
    # Use .get_text() (not .string) because BeautifulSoup may return None for large scripts.
    script = soup.find("script", {"id": "__NEXT_DATA__"})
    if script:
        try:
            data = json.loads(script.get_text())
            props = data.get("props", {}).get("pageProps", {}).get("initialData", {})
            stacks = props.get("searchResult", {}).get("itemStacks", [])

            # Collect items from all stacks
            all_items = []
            for stack in stacks:
                all_items.extend(stack.get("items", []))

            for item in all_items[:MAX_CANDIDATES]:
                name = item.get("name") or item.get("title")
                if not name:
                    continue

                # Price lives in priceInfo.linePrice (e.g. "$99.00")
                price_text = item.get("priceInfo", {}).get("linePrice", "")
                rating = item.get("averageRating")
                review_count = item.get("numberOfReviews")
                canonical = item.get("canonicalUrl", "")
                url = ("https://www.walmart.com" + canonical) if canonical else None

                candidates.append({
                    "title": name,
                    "price": parse_price(price_text),
                    "rating": float(rating) if rating else None,
                    "review_count": int(review_count) if review_count else None,
                    "url": url,
                })
        except (json.JSONDecodeError, KeyError, IndexError):
            pass

    return best_match(candidates, query)


def scrape_newegg(search_url: str, query: str) -> dict | None:
    """Scrape Newegg search results page."""
    resp = requests.get(search_url, headers=get_headers(), timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    candidates = []
    cards = soup.select(".item-cell")[:MAX_CANDIDATES]

    for card in cards:
        title_el = card.select_one(".item-title")
        title = title_el.get_text(strip=True) if title_el else None

        # Price is split into dollars and cents in two spans
        price_dollars = card.select_one(".price-current strong")
        price_cents = card.select_one(".price-current sup:last-child")
        if price_dollars:
            dollars = price_dollars.get_text(strip=True).replace(",", "")
            cents = price_cents.get_text(strip=True) if price_cents else "00"
            try:
                price = float(f"{dollars}.{cents}")
            except ValueError:
                price = parse_price(price_dollars.get_text(strip=True))
        else:
            price = None

        rating_el = card.select_one(".item-rating")
        rating_text = rating_el.get("title") if rating_el else None

        review_el = card.select_one(".item-rating-num")
        review_text = review_el.get_text(strip=True) if review_el else None

        link_el = card.select_one(".item-title")
        url = link_el["href"] if link_el and link_el.get("href") else None

        if title:
            candidates.append({
                "title": title,
                "price": price,
                "rating": parse_rating(rating_text),
                "review_count": parse_review_count(review_text),
                "url": url,
            })

    return best_match(candidates, query)


# ---------------------------------------------------------------------------
# Main entry point called by the pipeline
# ---------------------------------------------------------------------------

SITE_SCRAPERS = {
    "Amazon.com":  scrape_amazon,
    "BestBuy.com": scrape_bestbuy,
    "Walmart.com": scrape_walmart,
    "Newegg.com":  scrape_newegg,
}


async def scrape_basic(site_name: str, search_url: str, query: str) -> ProductResult:
    """
    Entry point for the basic scraping method.
    Runs synchronous requests/BS4 code (not truly async, but wrapped for the pipeline).
    """
    import asyncio

    scraper_fn = SITE_SCRAPERS.get(site_name)
    if not scraper_fn:
        raise ValueError(f"No basic scraper defined for {site_name}")

    # Run the blocking I/O in a thread so it doesn't block the event loop
    loop = asyncio.get_event_loop()
    result_dict = await loop.run_in_executor(None, scraper_fn, search_url, query)

    if not result_dict:
        raise ValueError("No matching product found in search results")

    return ProductResult(
        website=site_name,
        title=result_dict.get("title"),
        price=result_dict.get("price"),
        rating=result_dict.get("rating"),
        review_count=result_dict.get("review_count"),
        product_url=result_dict.get("url"),
        status=ScrapingStatus.SUCCESS,
        method=ScrapingMethod.BASIC,
    )
