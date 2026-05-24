from pydantic import BaseModel
from typing import Optional
from enum import Enum


class ScrapingMethod(str, Enum):
    BASIC = "Basic"
    BROWSER = "Browser"
    LLM = "LLM"
    FIRECRAWL = "Firecrawl"
    NA = "N/A"


class ScrapingStatus(str, Enum):
    SUCCESS = "Success"
    FAILED = "Failed"


class ProductResult(BaseModel):
    """Represents the scraped result for one website."""
    website: str                          # e.g. "Amazon.com"
    title: Optional[str] = None           # Product title
    price: Optional[float] = None         # Price in USD
    rating: Optional[float] = None        # Average star rating (0-5)
    review_count: Optional[int] = None    # Number of reviews
    product_url: Optional[str] = None     # URL of the product page
    status: ScrapingStatus = ScrapingStatus.FAILED
    method: ScrapingMethod = ScrapingMethod.NA
    error: Optional[str] = None           # Error message if failed


class SearchRequest(BaseModel):
    """Request body for the /search endpoint."""
    query: str                            # e.g. "Lenovo Tab P12-2024"


class SearchResponse(BaseModel):
    """Response from the /search endpoint."""
    query: str
    results: list[ProductResult]
