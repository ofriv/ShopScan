// These types mirror the Pydantic models in backend/models.py exactly.

export type ScrapingMethod = 'Basic' | 'Browser' | 'LLM' | 'Firecrawl' | 'N/A';
export type ScrapingStatus = 'Success' | 'Failed';

export interface ProductResult {
  website: string;           // e.g. "Amazon.com"
  title: string | null;
  price: number | null;      // USD
  rating: number | null;     // 0–5
  review_count: number | null;
  product_url: string | null;
  status: ScrapingStatus;
  method: ScrapingMethod;
  error: string | null;
  price_warning: string | null;
}

export interface SearchResponse {
  query: string;
  results: ProductResult[];
  error: string | null;      // set when the query was rejected before scraping
}
