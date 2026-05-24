/**
 * ProductCard — displays the scraping result for a single retailer.
 *
 * Handles two visual states:
 *   - Available (status === "Success"): shows title, price, rating, link
 *   - Unavailable (status === "Failed"): muted "Not Available" layout
 *
 * The method badge in the top-right corner shows which scraper succeeded
 * (or which one was last tried before all failed).
 */
import type { ProductResult } from "@/types";

// Maps backend website names → display metadata
const RETAILER_MAP: Record<
  string,
  { cls: string; initial: string; display: string; domain: string }
> = {
  "Amazon.com":  { cls: "amazon",  initial: "a", display: "Amazon",   domain: "amazon.com" },
  "BestBuy.com": { cls: "bestbuy", initial: "B", display: "Best Buy", domain: "bestbuy.com" },
  "Walmart.com": { cls: "walmart", initial: "W", display: "Walmart",  domain: "walmart.com" },
  "Newegg.com":  { cls: "newegg",  initial: "N", display: "Newegg",   domain: "newegg.com" },
};

// Maps ScrapingMethod → CSS badge class
const METHOD_CLS: Record<string, string> = {
  Basic:     "basic",
  Browser:   "browser",
  LLM:       "llm",
  Firecrawl: "firecrawl",
  "N/A":     "na",
};

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      width="14" height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export default function ProductCard({ result }: { result: ProductResult }) {
  // Resolve retailer metadata, falling back gracefully for unknown sites
  const retailer = RETAILER_MAP[result.website] ?? {
    cls: "basic",
    initial: result.website[0]?.toUpperCase() ?? "?",
    display: result.website,
    domain: result.website.toLowerCase(),
  };
  const methodCls = METHOD_CLS[result.method] ?? "na";
  const isAvailable = result.status === "Success";

  // ── Unavailable state ───────────────────────────────────────────────
  if (!isAvailable) {
    return (
      <article className="card unavailable">
        <div className="card-head">
          <div className="retailer">
            <div className={`retailer-logo ${retailer.cls}`} aria-hidden="true">
              {retailer.initial}
            </div>
            <div className="retailer-text">
              <span className="retailer-name">{retailer.display}</span>
              <span className="retailer-domain">{retailer.domain}</span>
            </div>
          </div>
          <span className={`badge ${methodCls}`}>{result.method}</span>
        </div>

        <div className="unavail-block">
          <div className="unavail-icon">
            <svg
              width="22" height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M4.93 4.93l14.14 14.14" />
            </svg>
          </div>
          <div className="unavail-title">Not Available</div>
          <div className="unavail-sub">
            {result.error ?? "Scraper returned no matching product."}
          </div>
        </div>

        <div className="card-foot">
          <span
            className="view-link"
            style={{ color: "var(--text-faint)", pointerEvents: "none" }}
          >
            View Product →
          </span>
        </div>
      </article>
    );
  }

  // ── Available state ─────────────────────────────────────────────────
  return (
    <article className="card">
      {/* Header: retailer logo + method badge */}
      <div className="card-head">
        <div className="retailer">
          <div className={`retailer-logo ${retailer.cls}`} aria-hidden="true">
            {retailer.initial}
          </div>
          <div className="retailer-text">
            <span className="retailer-name">{retailer.display}</span>
            <span className="retailer-domain">{retailer.domain}</span>
          </div>
        </div>
        <span className={`badge ${methodCls}`}>{result.method}</span>
      </div>

      {/* Price warning (LLM-detected anomaly) */}
      {result.price_warning && (
        <div className="warning">
          <WarningIcon />
          <span>{result.price_warning}</span>
        </div>
      )}

      {/* Product title — clamped to 2 lines */}
      <div className="product-title">{result.title}</div>

      {/* Price */}
      <div className="price-row">
        <span className="price">
          ${result.price?.toFixed(2) ?? "—"}
        </span>
      </div>

      {/* Rating + review count (omitted if both are null) */}
      {(result.rating !== null || result.review_count !== null) && (
        <div className="rating">
          {result.rating !== null && (
            <span
              className="stars"
              aria-label={`${result.rating} out of 5`}
            >
              <StarIcon />
              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                {result.rating.toFixed(1)}
              </span>
            </span>
          )}
          {result.rating !== null && result.review_count !== null && (
            <span className="sep">·</span>
          )}
          {result.review_count !== null && (
            <span className="count">
              {result.review_count.toLocaleString()} reviews
            </span>
          )}
        </div>
      )}

      {/* Footer: product link */}
      <div className="card-foot">
        {result.product_url ? (
          <a
            className="view-link"
            href={result.product_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Product <span aria-hidden="true">→</span>
          </a>
        ) : (
          <span
            className="view-link"
            style={{ color: "var(--text-faint)", pointerEvents: "none" }}
          >
            View Product →
          </span>
        )}
      </div>
    </article>
  );
}
