"""
Firecrawl scraper (4th and final fallback).

Uses Firecrawl's built-in LLM extraction to pull structured product data
directly from a search results page. We define a JSON schema for the fields
we need; Firecrawl's backend LLM fills them in automatically.

This is the last resort — only reached when Basic, Browser, and LLM scrapers
have all failed for a given site.
"""

import os
import asyncio
from firecrawl import FirecrawlApp
from dotenv import load_dotenv
from models import ProductResult, ScrapingStatus, ScrapingMethod

load_dotenv()

# Module-level client — initialized once on first use (lazy init)
_firecrawl_client: FirecrawlApp | None = None


def _get_firecrawl_client() -> FirecrawlApp:
    """
    Lazily initialize and return the FirecrawlApp client.
    Reads FIRECRAWL_API_KEY from the environment (loaded from .env by dotenv).
    Raises ValueError if the key is missing.
    """
    global _firecrawl_client
    if _firecrawl_client is None:
        api_key = os.environ.get("FIRECRAWL_API_KEY")
        if not api_key:
            raise ValueError("FIRECRAWL_API_KEY not set — add it to backend/.env")
        _firecrawl_client = FirecrawlApp(api_key=api_key)
    return _firecrawl_client


# JSON Schema passed to Firecrawl's LLM extraction.
# Firecrawl sends this schema to its own LLM backend — the LLM reads the
# page and fills in each field according to the description we provide.
EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "description": "Full product name/title of the best-matching item",
        },
        "price": {
            "type": "number",
            "description": "Product price in USD as a plain number (no $ sign or commas)",
        },
        "rating": {
            "type": "number",
            "description": "Average customer star rating from 0 to 5, or null if not shown",
        },
        "review_count": {
            "type": "integer",
            "description": "Total number of customer reviews as an integer, or null if not shown",
        },
        "product_url": {
            "type": "string",
            "description": "Full absolute URL (starting with https://) to the product's detail page",
        },
    },
    "required": ["title", "price"],
}


def _build_prompt(site_name: str, query: str) -> str:
    """
    Natural-language instruction sent alongside the schema to guide Firecrawl's LLM.
    Tells it which product to pick and how to format certain fields.
    """
    return (
        f"From this {site_name} search results page for the query '{query}', "
        "extract the single most relevant product — the one that best matches the query. "
        "The price must be a plain number in USD (no currency symbols or commas). "
        "The product_url must be the full absolute URL to the product's detail page."
    )


def _do_scrape(client: FirecrawlApp, url: str, prompt: str) -> dict:
    """
    Synchronous Firecrawl API call.
    Kept as a plain function so we can hand it to run_in_executor and avoid
    blocking the asyncio event loop while waiting for the Firecrawl response.
    """
    result = client.scrape_url(
        url,
        formats=["extract"],
        extract={
            "schema": EXTRACT_SCHEMA,
            "prompt": prompt,
        },
    )
    # scrape_url returns a ScrapeResponse (Pydantic model) in newer SDK versions,
    # or a plain dict in older ones. Handle both defensively.
    if isinstance(result, dict):
        return result.get("extract") or {}
    return getattr(result, "extract", None) or {}


async def scrape_firecrawl(site_name: str, search_url: str, query: str) -> ProductResult:
    """
    Entry point for the Firecrawl scraping method.

    Sends the search URL to Firecrawl with an extraction schema and a
    guiding prompt. Firecrawl's LLM reads the page and returns structured
    JSON that we map directly into a ProductResult.
    """
    client = _get_firecrawl_client()
    prompt = _build_prompt(site_name, query)

    # scrape_url is synchronous — run it in a thread executor so we don't
    # block the asyncio event loop while the Firecrawl API does its work.
    loop = asyncio.get_event_loop()
    data: dict = await loop.run_in_executor(
        None, _do_scrape, client, search_url, prompt
    )

    if not data:
        raise ValueError("Firecrawl returned an empty extraction result")

    # Defensive type coercion — the schema should give us the right types,
    # but guard against strings or None slipping through anyway.
    def safe_float(val) -> float | None:
        try:
            return float(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    def safe_int(val) -> int | None:
        try:
            return int(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    rating = safe_float(data.get("rating"))
    if rating is not None and not (0 <= rating <= 5):
        rating = None  # discard clearly invalid ratings

    return ProductResult(
        website=site_name,
        title=data.get("title") or None,
        price=safe_float(data.get("price")),
        rating=rating,
        review_count=safe_int(data.get("review_count")),
        product_url=data.get("product_url") or None,
        status=ScrapingStatus.SUCCESS,
        method=ScrapingMethod.FIRECRAWL,
    )
