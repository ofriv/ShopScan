/**
 * ProductCard — displays the scraping result for a single retailer.
 *
 * Props:
 *   result       — the scraped data
 *   isBestPrice  — true on the cheapest successful card (adds .card.best class)
 *   rank         — position after sorting (1, 2, 3 …), null for unavailable cards
 *   lowestPrice  — the cheapest price across all successful cards (for delta/bar)
 */
import type { ProductResult } from "@/types";

const RETAILER_MAP: Record<
  string,
  { cls: string; initial: string; display: string; domain: string }
> = {
  "Amazon.com":  { cls: "amazon",  initial: "a", display: "Amazon",   domain: "amazon.com" },
  "BestBuy.com": { cls: "bestbuy", initial: "B", display: "Best Buy", domain: "bestbuy.com" },
  "Walmart.com": { cls: "walmart", initial: "W", display: "Walmart",  domain: "walmart.com" },
  "Newegg.com":  { cls: "newegg",  initial: "N", display: "Newegg",   domain: "newegg.com" },
};

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

export default function ProductCard({
  result,
  isBestPrice = false,
  rank = null,
  lowestPrice = null,
}: {
  result: ProductResult;
  isBestPrice?: boolean;
  rank?: number | null;
  lowestPrice?: number | null;
}) {
  const retailer = RETAILER_MAP[result.website] ?? {
    cls: "basic",
    initial: result.website[0]?.toUpperCase() ?? "?",
    display: result.website,
    domain: result.website.toLowerCase(),
  };
  const methodCls = METHOD_CLS[result.method] ?? "na";
  const isAvailable = result.status === "Success";
  const isNA = result.method === "N/A";

  // Price delta vs lowest (only for non-best available cards)
  const priceDelta =
    !isBestPrice && result.price !== null && lowestPrice !== null
      ? result.price - lowestPrice
      : null;

  // Comparison bar: best card = 100%, others shrink proportionally
  const barWidth =
    result.price !== null && lowestPrice !== null && result.price > 0
      ? Math.round((lowestPrice / result.price) * 100)
      : 100;

  // Split price into dollars / cents for the new display format
  const [dollars, cents] =
    result.price !== null
      ? result.price.toFixed(2).split(".")
      : ["—", null];

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
    <article className={`card${isBestPrice ? " best" : ""}`}>
      {/* Rank badge (#1, #2 …) */}
      {rank !== null && (
        <div className="rank"><b>#{rank}</b></div>
      )}

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
        <span className={`badge ${methodCls}`}>
          {!isNA && "✓ "}{result.method}
        </span>
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

      {/* Price + delta badge */}
      <div className="price-row">
        <span className="price">
          ${dollars}
          {cents !== null && <span className="cents">.{cents}</span>}
        </span>
        {isBestPrice && <span className="delta best">✓ LOWEST</span>}
        {priceDelta !== null && (
          <span className="delta up">+${priceDelta.toFixed(2)}</span>
        )}
      </div>

      {/* Comparison bar — shown whenever we have a lowestPrice to compare to */}
      {lowestPrice !== null && result.price !== null && (
        <div className="compare">
          <div className="compare-bar">
            <div
              className="compare-bar-fill"
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="compare-meta">
            <span>${result.price.toFixed(2)}</span>
            {!isBestPrice && priceDelta !== null && lowestPrice > 0 && (
              <span>
                +{((priceDelta / lowestPrice) * 100).toFixed(0)}% vs ${lowestPrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Rating + review count */}
      {(result.rating !== null || result.review_count !== null) && (
        <div className="rating">
          {result.rating !== null && (
            <span className="stars" aria-label={`${result.rating} out of 5`}>
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
