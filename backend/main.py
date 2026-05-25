import asyncio
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from models import SearchRequest, SearchResponse, ProductResult, ScrapingStatus
from pipeline import scrape_all_sites
from query_processor import process_query, check_price, get_suggestion
from scrapers.browser import init_browser, close_browser
import uvicorn


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan handler.
    Startup:  launch the shared Playwright browser once, so every
              scrape_browser() call can reuse it instead of cold-starting.
    Shutdown: close the browser cleanly before the process exits.
    """
    await init_browser()
    yield
    await close_browser()


app = FastAPI(
    title="Shopping Scraper API",
    description="Scrapes product info from Amazon, BestBuy, Walmart, and Newegg.",
    version="1.0.0",
    lifespan=lifespan,
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
    Original non-streaming endpoint — kept for direct API testing.

    Flow:
      1. Validate the query with OpenAI — if not a real product, return error.
      2. Scrape all 4 sites concurrently with the fallback pipeline.
      3. Price-check each successful result.
    """
    query_result = await process_query(request.query)

    if not query_result.get("valid"):
        return SearchResponse(
            query=request.query,
            results=[],
            error=query_result.get("reason", "Invalid query"),
        )

    per_site_queries: dict[str, str] = query_result["queries"]
    results: list[ProductResult] = await scrape_all_sites(per_site_queries)

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


@app.post("/search/stream")
async def search_stream(request: SearchRequest):
    """
    SSE streaming endpoint — emits JSON progress events as scraping happens.

    Event shapes:
      {"type": "query_processing"}
      {"type": "query_done",    "queries": {"Amazon.com": "...", ...}}
      {"type": "method_try",    "site": "...", "method": "..."}
      {"type": "method_failed", "site": "...", "method": "...", "error": "..."}
      {"type": "site_done",     "site": "...", "method": "..."}
      {"type": "site_failed",   "site": "...", "error": "..."}
      {"type": "done",          "results": [...]}
      {"type": "error",         "message": "..."}
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def progress(event: dict) -> None:
        """Push an event into the queue to be streamed to the client."""
        await queue.put(event)

    async def run_pipeline() -> None:
        try:
            # Step 1: validate and optimize the query
            await progress({"type": "query_processing"})
            query_result = await process_query(request.query)

            if not query_result.get("valid"):
                await progress({
                    "type": "error",
                    "message": query_result.get("reason", "Invalid query"),
                })
                return

            per_site_queries: dict[str, str] = query_result["queries"]
            await progress({"type": "query_done", "queries": per_site_queries})

            # Step 2: scrape all 4 sites concurrently, each with its own fallback chain
            results: list[ProductResult] = await scrape_all_sites(
                per_site_queries, progress=progress
            )

            # Step 3: price sanity check — silent, no progress events needed
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

            await progress({
                "type": "done",
                # mode="json" ensures enums are serialized as their string values
                "results": [r.model_dump(mode="json") for r in results],
            })

        except Exception as e:
            await progress({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)  # sentinel — tells generate() to close the stream

    async def generate():
        task = asyncio.create_task(run_pipeline())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            # Clean up the pipeline task if the client disconnects early
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering if present
        },
    )


@app.post("/suggest")
async def suggest(request: SearchRequest):
    """
    Return a complementary product suggestion for the given query.
    Called by the frontend after results are displayed.
    """
    data = await get_suggestion(request.query)
    return data


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
