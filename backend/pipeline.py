"""
Fallback scraping pipeline orchestrator.

For each site, tries scraping methods in this order:
  1. Basic (requests + BeautifulSoup)
  2. Browser (Playwright)
  3. LLM (Google Gemini)
  4. Firecrawl API

Moves to the next method if the current one fails or returns incomplete data.
"""

import asyncio
from models import ProductResult, ScrapingStatus, ScrapingMethod

# Site-specific search URL builders
SITES = {
    "Amazon.com": "https://www.amazon.com/s?k={query}",
    "BestBuy.com": "https://www.bestbuy.com/site/searchpage.jsp?st={query}",
    "Walmart.com": "https://www.walmart.com/search?q={query}",
    "Newegg.com": "https://www.newegg.com/p/pl?d={query}",
}


def is_valid_result(result: ProductResult) -> bool:
    """
    A result is valid if it has at least a title and a price.
    We also sanity-check that the price is a positive number.
    """
    if not result.title or not result.price:
        return False
    if result.price <= 0 or result.price > 100_000:
        return False
    return True


async def scrape_site(site_name: str, query: str) -> ProductResult:
    """
    Try each scraping method in order for a single site.
    Returns the first successful valid result, or a failure result.
    """
    # Import scrapers here to avoid circular imports
    from scrapers.basic import scrape_basic
    from scrapers.browser import scrape_browser
    from scrapers.llm import scrape_llm
    from scrapers.firecrawl import scrape_firecrawl

    search_url = SITES[site_name].format(query=query.replace(" ", "+"))

    methods = [
        (ScrapingMethod.BASIC,     scrape_basic),
        (ScrapingMethod.BROWSER,   scrape_browser),
        (ScrapingMethod.LLM,       scrape_llm),
        (ScrapingMethod.FIRECRAWL, scrape_firecrawl),
    ]

    last_error = "All scraping methods failed"

    for method_name, scraper_fn in methods:
        try:
            print(f"[{site_name}] Trying {method_name}...")
            result = await scraper_fn(site_name, search_url, query)

            if is_valid_result(result):
                result.method = method_name
                result.status = ScrapingStatus.SUCCESS
                print(f"[{site_name}] ✓ Success with {method_name}")
                return result
            else:
                last_error = f"{method_name}: missing title or price"
                print(f"[{site_name}] ✗ {last_error}, trying next method...")

        except Exception as e:
            last_error = f"{method_name}: {str(e)}"
            print(f"[{site_name}] ✗ {last_error}, trying next method...")

    # All methods failed — return a clean failure result
    return ProductResult(
        website=site_name,
        status=ScrapingStatus.FAILED,
        method=ScrapingMethod.NA,
        error=last_error,
    )


async def scrape_all_sites(query: str) -> list[ProductResult]:
    """
    Scrape all sites concurrently.
    Each site runs its own fallback pipeline independently.
    """
    tasks = [scrape_site(site_name, query) for site_name in SITES]
    results = await asyncio.gather(*tasks, return_exceptions=False)
    return list(results)
