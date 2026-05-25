"""
LLM scraper: uses Google Gemini to extract product info from page text.
This is the third method tried in the fallback pipeline.

Flow:
  1. Fetch the search page using requests (same as basic.py — no browser needed).
  2. Strip script/style tags, then extract all visible text with BeautifulSoup.
  3. Truncate to ~8,000 characters (product info appears near the top of search pages).
  4. Ask Gemini to find the best-matching product and return a JSON object.
  5. Parse Gemini's JSON response into a ProductResult.
"""

import os
import json
import asyncio
import requests
from bs4 import BeautifulSoup
import google.generativeai as genai
from dotenv import load_dotenv
from models import ProductResult, ScrapingStatus, ScrapingMethod
from scrapers.basic import get_headers, detect_block

load_dotenv()

# How much page text to send to Gemini (characters, not tokens).
# Products appear near the top of search pages, so 8k chars is usually enough.
MAX_TEXT_LENGTH = 8_000

# gemini-1.5-flash: free-tier, fast, good at structured extraction
GEMINI_MODEL = "gemini-1.5-flash"

# Module-level client — initialized once on first use (lazy init)
_gemini_client = None


def _get_gemini_client():
    """
    Lazily initialize and return the Gemini GenerativeModel.
    Reads GEMINI_API_KEY from the environment (loaded from .env by dotenv).
    Raises ValueError if the key is missing.
    """
    global _gemini_client
    if _gemini_client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not set — add it to backend/.env")
        genai.configure(api_key=api_key)
        _gemini_client = genai.GenerativeModel(GEMINI_MODEL)
    return _gemini_client


def _extract_page_text(html: str) -> str:
    """
    Strip tags and return the visible text of the page.
    Removes <script>, <style>, and <noscript> first so their contents
    don't pollute the text (JS code and CSS rules are noise to the LLM).
    """
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
    return text[:MAX_TEXT_LENGTH]


def _build_prompt(site_name: str, query: str, page_text: str) -> str:
    """
    Build the Gemini prompt.
    We ask for a strict JSON response so we can parse it reliably.
    The "no markdown" instruction prevents Gemini from wrapping the output
    in ```json ... ``` fences (though we strip those anyway as a fallback).
    """
    return f"""You are a web scraping assistant. Below is text extracted from a {site_name} search results page for the query: "{query}".

Find the single best-matching product for the query and extract:
- title: the full product name
- price: the price as a number only, no currency symbols (e.g. 99.99)
- rating: the star rating as a number out of 5 (e.g. 4.6), or null if not shown
- review_count: the total number of reviews as an integer, or null if not shown
- url: the full product URL (must start with https://), or null if not found

Respond with ONLY a JSON object — no markdown, no explanation, no code fences:
{{"title": "...", "price": 99.99, "rating": 4.6, "review_count": 1234, "url": "https://..."}}

If you cannot find a matching product, respond with:
{{"error": "no match found"}}

Page text:
{page_text}"""


def _parse_gemini_response(raw: str) -> dict:
    """
    Parse the raw text from Gemini into a Python dict.
    Gemini sometimes wraps JSON in ```json ... ``` fences despite instructions;
    we strip those defensively before parsing.
    """
    raw = raw.strip()

    # Strip markdown code fences if present (e.g. ```json\n{...}\n```)
    if raw.startswith("```"):
        parts = raw.split("```")
        # parts[1] is the content inside the fences
        raw = parts[1].strip()
        # Remove the "json" language tag if present
        if raw.startswith("json"):
            raw = raw[4:].strip()

    return json.loads(raw)


async def scrape_llm(site_name: str, search_url: str, query: str) -> ProductResult:
    """
    Entry point for the LLM scraping method.

    Fetches the search page, extracts visible text, asks Gemini to find
    the best-matching product, and returns a ProductResult.
    """
    # --- Step 1: Fetch the page ---
    resp = requests.get(search_url, headers=get_headers(), timeout=10)
    resp.raise_for_status()
    # If the site returned a CAPTCHA / block page, the extracted text would
    # be garbage and waste a Gemini API call — fast-fail instead.
    if detect_block(resp.text):
        raise ValueError(f"{site_name} returned a CAPTCHA / bot-block page — skipping LLM")

    # --- Step 2: Extract visible text ---
    page_text = _extract_page_text(resp.text)

    # --- Step 3: Build prompt and call Gemini ---
    prompt = _build_prompt(site_name, query, page_text)
    client = _get_gemini_client()

    # Gemini's generate_content is synchronous — run it in a thread so it
    # doesn't block the asyncio event loop while we wait for the API response.
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, client.generate_content, prompt)

    # --- Step 4: Parse the JSON response ---
    data = _parse_gemini_response(response.text)

    if "error" in data:
        raise ValueError(f"Gemini could not find a match: {data['error']}")

    # Extract fields — Gemini returns numbers directly, but we guard against
    # unexpected string values by using float()/int() with a fallback of None.
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

    return ProductResult(
        website=site_name,
        title=data.get("title") or None,
        price=safe_float(data.get("price")),
        rating=safe_float(data.get("rating")),
        review_count=safe_int(data.get("review_count")),
        product_url=data.get("url") or None,
        status=ScrapingStatus.SUCCESS,
        method=ScrapingMethod.LLM,
    )
