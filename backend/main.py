import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models import SearchRequest, SearchResponse, ProductResult, ScrapingStatus
from pipeline import scrape_all_sites
from query_processor import process_query, check_price
import uvicorn

app = FastAPI(
    title="Shopping Scraper API",
    description="Scrapes product info from Amazon, BestBuy, Walmart, and Newegg.",
    version="1.0.0",
)

# Allow requests from the Next.js frontend (localhost:3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Shopping Scraper API is running"}


@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """
    Search for a product across all supported e-commerce websites.

    Flow:
      1. Validate the query with OpenAI — if it's not a real product query,
         return an error immediately (no scraping attempted).
      2. Use the LLM-optimized per-site search strings to scrape all 4 sites
         concurrently, each with its own fallback pipeline.
      3. For each successful result, check whether the price looks reasonable.
         If not, attach a warning string to the result (price is kept as-is).
    """
    # --- Step 1: Validate and optimize the query ---
    query_result = await process_query(request.query)

    if not query_result.get("valid"):
        # Not a product query — return immediately with an error, no scraping
        return SearchResponse(
            query=request.query,
            results=[],
            error=query_result.get("reason", "Invalid query"),
        )

    per_site_queries: dict[str, str] = query_result["queries"]

    # --- Step 2: Scrape all sites concurrently ---
    results: list[ProductResult] = await scrape_all_sites(per_site_queries)

    # --- Step 3: Price sanity check on successful results ---
    # Build a list of coroutines — one per successful result that has both
    # a title and a price. Non-successful results get a no-op coroutine.
    async def _check_one(result: ProductResult) -> ProductResult:
        if (
            result.status == ScrapingStatus.SUCCESS
            and result.title
            and result.price is not None
        ):
            warning = await check_price(result.title, result.price)
            if warning:
                result.price_warning = warning
        return result

    results = list(await asyncio.gather(*[_check_one(r) for r in results]))

    return SearchResponse(query=request.query, results=results)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
