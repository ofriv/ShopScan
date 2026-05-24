"""
Query processing using OpenAI GPT-4o-mini.

Two responsibilities:
  1. process_query(query) — validates the raw user query and returns an
     optimized search string tailored to each shopping site.
  2. check_price(title, price) — asks the LLM whether a scraped price looks
     reasonable for the given product; returns a warning string or None.
"""

import os
import json
import asyncio
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# gpt-4o-mini: fast, cheap, and more than capable for structured extraction
OPENAI_MODEL = "gpt-4o-mini"

# Module-level client — initialized once on first use
_openai_client: AsyncOpenAI | None = None


def _get_openai_client() -> AsyncOpenAI:
    """
    Lazily initialize and return the AsyncOpenAI client.
    Reads OPENAI_API_KEY from the environment (loaded from .env by dotenv).
    Raises ValueError if the key is missing.
    """
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set — add it to backend/.env")
        _openai_client = AsyncOpenAI(api_key=api_key)
    return _openai_client


def _strip_fences(raw: str) -> str:
    """
    Strip markdown code fences if the model adds them despite being asked not to.
    Handles both ```json ... ``` and ``` ... ``` forms.
    """
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    return raw


async def process_query(query: str) -> dict:
    """
    Validate the user's raw query and return optimized per-site search strings.

    Returns one of two shapes:
      {"valid": False, "reason": "..."}
          — query is not a real product; reason is shown directly to the user.
      {"valid": True, "queries": {"Amazon.com": "...", "BestBuy.com": "...",
                                   "Walmart.com": "...", "Newegg.com": "..."}}
          — query is valid; each site gets its own optimized search string.
    """
    client = _get_openai_client()

    prompt = f"""You are a shopping assistant. A user wants to search for a product online.

User query: "{query}"

First, decide whether this is a valid product search query — something a person would actually buy in an online store.

Examples of VALID queries: "iPhone 15 Pro", "gaming chair", "Sony WH-1000XM5 headphones", "4K monitor"
Examples of INVALID queries: "how is the weather", "hello world", "asdfghjkl", "who won the game"

If NOT a valid product query, respond with:
{{"valid": false, "reason": "Short, friendly explanation shown directly to the user"}}

If it IS valid, provide an optimized search string for each site below.
Tailor each query to that site's strengths:
- Amazon.com: broad marketplace — use full product name with brand and key specs
- BestBuy.com: electronics and appliances — use brand name and model number when known
- Walmart.com: general merchandise — use the common, everyday name people would use
- Newegg.com: tech and computer parts — use technical specs, brand, and part numbers

Respond with ONLY a JSON object, no markdown, no explanation:
{{"valid": true, "queries": {{"Amazon.com": "...", "BestBuy.com": "...", "Walmart.com": "...", "Newegg.com": "..."}}}}"""

    response = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,  # deterministic — we want consistent structured output
    )

    raw = _strip_fences(response.choices[0].message.content)
    return json.loads(raw)


async def check_price(title: str, price: float) -> str | None:
    """
    Ask the LLM whether a scraped price looks reasonable for the product.

    Returns:
      - None   if the price seems correct.
      - str    a short warning message if the price looks suspicious.
    """
    client = _get_openai_client()

    prompt = f"""Is ${price:.2f} a reasonable retail price for the following product?

Product: "{title}"

Think about typical market prices for this type of product. Flag the price as unreasonable only if it is clearly wrong — for example, $1.99 for a laptop, or $50,000 for a USB cable.

Respond with ONLY a JSON object, no markdown:
{{"reasonable": true}}
OR
{{"reasonable": false, "warning": "One concise sentence explaining why the price seems wrong"}}"""

    response = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )

    raw = _strip_fences(response.choices[0].message.content)
    data = json.loads(raw)

    if not data.get("reasonable", True):
        return data.get("warning", "Price may be incorrect")
    return None
