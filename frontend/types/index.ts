// ── Core scraping types (mirror backend Pydantic models exactly) ────────────

export type ScrapingMethod = "Basic" | "Browser" | "LLM" | "Firecrawl" | "N/A";
export type ScrapingStatus = "Success" | "Failed";

export interface ProductResult {
  website: string;
  title: string | null;
  price: number | null;
  rating: number | null;
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
  error: string | null;
}

// ── SSE progress events emitted by /search/stream ───────────────────────────

export type ProgressEventType =
  | "query_processing" // AI is validating / optimizing the query
  | "query_done"       // query validated; per-site search strings ready
  | "method_try"       // about to try a scraping method on a site
  | "method_failed"    // that method failed; moving to the next one
  | "site_done"        // a site succeeded with this method
  | "site_failed"      // all methods failed for a site
  | "done"             // all sites finished; full results attached
  | "error";           // query rejected or unrecoverable error

export interface ProgressEvent {
  type: ProgressEventType;
  /** Site name, e.g. "Amazon.com" */
  site?: string;
  /** Scraping method name, e.g. "Basic" */
  method?: string;
  /** Error detail (method_failed / site_failed / error) */
  error?: string;
  /** Human-readable message for the "error" event type */
  message?: string;
  /** Per-site optimized queries (query_done) */
  queries?: Record<string, string>;
  /** Final scraped results (done) */
  results?: ProductResult[];
}

// ── Complementary suggestion from /suggest ──────────────────────────────────

export interface SuggestResponse {
  suggestion: string; // e.g. "Apple Pencil Grip"
  reason: string;     // e.g. "comfortable grip for long sessions"
}
