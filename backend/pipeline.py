"""
Fallback scraping pipeline orchestrator.

For each site, tries scraping methods in this order:
  1. Basic (requests + BeautifulSoup)
  2. Browser (Playwright)
  3. LLM (Google Gemini)
  4. Firecrawl API

Moves to the next method if the current one fails or returns incomplete data.
Supports an optional async progress_callback for live streaming progress events.
"""

import asyncio
from typing import Callable, Awaitable, Optional
from models import ProductResult, ScrapingStatus, ScrapingMethod

# Site-specific search URL builders
SITES = {
    "Amazon.com":  "https://www.amazon.com/s?k={query}",
    "BestBuy.com": "https://www.bestbuy.com/site/searchpage.jsp?st={query}",
    "Walmart.com": "https://www.walmart.com/search?q={query}",
    "Newegg.com":  "https://www.newegg.com/p/pl?d={query}",
}

# Per-method timeout in seconds — fast bail-out so the fallback chain stays snappy
METHOD_TIMEOUTS: dict[ScrapingMethod, float] = {
    ScrapingMethod.BASIC:      8.0,
    ScrapingMethod.BROWSER:   12.0,
    ScrapingMethod.LLM:       15.0,
    ScrapingMethod.FIRECRAWL: 20.0,
}

# Type alias for the async progress callback
ProgressCallback = Callable[[dict], Awaitable[None]]


def is_valid_result(result: ProductResult) -> bool:
    """
    A result is valid if it has a title and a price that makes sense.
    - Minimum $15 to filter out accessories/stickers that slipped through.
    - Maximum $100,000 to filter out obvious parsing errors.
    """
    if not result.title or not result.price:
        return False
    if result.price < 15 or result.price > 100_000:
        return False
    return True


async def scrape_site(
    site_name: str,
    query: str,
    progress: Optional[ProgressCallback] = None,
) -> ProductResult:
    """
    Try each scraping method in order for a single site.
    Emits progress events via the optional callback.
    Returns the first successful valid result, or a clean failure.
    """
    # Import scrapers here to avoid circular imports at module load time
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
        # Notify frontend: we're about to try this method
        if progress:
            await progress({
                "type": "method_try",
                "site": site_name,
                "method": method_name.value,
            })

        try:
            print(f"[{site_name}] Trying {method_name.value}...")
            result = await asyncio.wait_for(
                scraper_fn(site_name, search_url, query),
                timeout=METHOD_TIMEOUTS[method_name],
            )

            if is_valid_result(result):
                result.method = method_name
                result.status = ScrapingStatus.SUCCESS
                print(f"[{site_name}] ✓ Success with {method_name.value}")
                if progress:
                    await progress({
                        "type": "site_done",
                        "site": site_name,
                        "method": method_name.value,
                    })
                return result
            else:
                last_error = "missing title or price"
                print(f"[{site_name}] ✗ {method_name.value}: {last_error}")
                if progress:
                    await progress({
                        "type": "method_failed",
                        "site": site_name,
                        "method": method_name.value,
                        "error": last_error,
                    })

        except asyncio.TimeoutError:
            last_error = "timed out"
            print(f"[{site_name}] ✗ {method_name.value}: timed out")
            if progress:
                await progress({
                    "type": "method_failed",
                    "site": site_name,
                    "method": method_name.value,
                    "error": "timed out",
                })

        except Exception as e:
            last_error = str(e)
            print(f"[{site_name}] ✗ {method_name.value}: {last_error}")
            if progress:
                await progress({
                    "type": "method_failed",
                    "site": site_name,
                    "method": method_name.value,
                    "error": last_error,
                })

    # All four methods failed for this site
    if progress:
        await progress({
            "type": "site_failed",
            "site": site_name,
            "error": last_error,
        })

    return ProductResult(
        website=site_name,
        status=ScrapingStatus.FAILED,
        method=ScrapingMethod.NA,
        error=last_error,
    )


async def scrape_all_sites(
    queries: dict[str, str],
    progress: Optional[ProgressCallback] = None,
) -> list[ProductResult]:
    """
    Scrape all sites concurrently.
    Each site runs its own fallback pipeline independently.
    'queries' maps each site name to its LLM-optimized search string.
    """
    tasks = [
        scrape_site(site_name, queries[site_name], progress)
        for site_name in SITES
    ]
    results = await asyncio.gather(*tasks, return_exceptions=False)
    return list(results)
