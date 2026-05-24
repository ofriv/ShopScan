from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models import SearchRequest, SearchResponse, ProductResult
from pipeline import scrape_all_sites
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
    Returns one result per site with title, price, rating, review count,
    scraping method used, and success/failure status.
    """
    results: list[ProductResult] = await scrape_all_sites(request.query)
    return SearchResponse(query=request.query, results=results)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
