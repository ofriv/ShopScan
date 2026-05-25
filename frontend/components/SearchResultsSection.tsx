"use client";

/**
 * SearchResultsSection — renders a complete set of search results for one slot:
 *   scan status panel → results-meta + sort tabs → cards grid
 *
 * Intentionally has NO search bar — that lives in page.tsx only.
 * Used for both the primary search and the secondary (suggestion) search.
 */

import ProductCard from "./ProductCard";
import SkeletonCard from "./SkeletonCard";
import type { ProductResult } from "@/types";
import { SITE_DISPLAY } from "@/hooks/useSearchSlot";
import type { SiteState, SortKey } from "@/hooks/useSearchSlot";

interface SearchResultsSectionProps {
  loading: boolean;
  results: ProductResult[] | null;
  fetchError: string | null;
  queryError: string | null;
  searchedQuery: string;
  searchTime: number | null;
  siteStates: Record<string, SiteState>;
  sortBy: SortKey;
  setSortBy: (key: SortKey) => void;
  sortedResults: ProductResult[] | null;
  bestPriceWebsite: string | null;
  lowestPrice: number | null;
  successCount: number;
}

export default function SearchResultsSection({
  loading,
  results,
  fetchError,
  queryError,
  searchedQuery,
  searchTime,
  siteStates,
  sortBy,
  setSortBy,
  sortedResults,
  bestPriceWebsite,
  lowestPrice,
  successCount,
}: SearchResultsSectionProps) {
  return (
    <>
      {/* ── Query-rejection error ──────────────────────────────────────── */}
      {queryError && !loading && (
        <div className="error-banner">
          <strong>Query rejected:</strong> {queryError}
        </div>
      )}

      {/* ── Network / backend error ────────────────────────────────────── */}
      {fetchError && !loading && (
        <div className="error-banner">
          <strong>Connection error:</strong> {fetchError}
        </div>
      )}

      {/* ── Scan status panel ─────────────────────────────────────────── */}
      <section className="scan-panel">
        <div className="scan-head">
          <div className="scan-head-left">
            <span>$ shopscan</span>
            <span className="query-echo">&ldquo;{searchedQuery}&rdquo;</span>
          </div>
          <div className="scan-head-right">
            {loading ? (
              <span className="scan-scanning">scanning…</span>
            ) : (
              <>
                <span><b>{successCount}</b> / 4 sources</span>
                <span className="sep">·</span>
                <span><b>{searchTime?.toFixed(2)}s</b></span>
                <span className="sep">·</span>
                {fetchError || queryError
                  ? <span className="scan-err">✗ error</span>
                  : <span className="scan-ok">✓ ready</span>
                }
              </>
            )}
          </div>
        </div>

        <div className="scan-strip">
          {Object.entries(SITE_DISPLAY).map(([site, name]) => {
            const s = siteStates[site];
            const meta =
              s.state === "idle" ? "—" :
              s.state === "run"  ? `${s.method} · …` :
              s.state === "fail" ? "FAILED" :
              `${s.method} · ${s.elapsed}`;
            return (
              <div key={site} className="scan-item" data-state={s.state}>
                <span className="scan-dot" />
                <span className="r-name">{name}</span>
                <span className="r-meta">{meta}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Results meta + sort tabs ───────────────────────────────────── */}
      <div className="results-meta">
        <div className="results-title">
          {loading ? (
            <>Scanning <em>&ldquo;{searchedQuery}&rdquo;</em>…</>
          ) : (
            <>
              {successCount} result{successCount !== 1 ? "s" : ""}{" "}
              <em>
                {sortBy === "price"  ? "sorted by price" :
                 sortBy === "rating" ? "sorted by rating" :
                                      "sorted by method speed"}{" "}
                for &ldquo;{searchedQuery}&rdquo;
              </em>
            </>
          )}
        </div>
        {!loading && (
          <div className="sort-tabs">
            {(["price", "rating", "speed"] as SortKey[]).map((key) => (
              <button
                key={key}
                className={`sort-tab${sortBy === key ? " active" : ""}`}
                onClick={() => setSortBy(key)}
              >
                {key === "price" ? "Price" : key === "rating" ? "Rating" : "Speed"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Cards grid ────────────────────────────────────────────────── */}
      <div className="grid">
        {loading
          ? Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
          : sortedResults?.map((result, i) => (
              <ProductCard
                key={result.website}
                result={result}
                isBestPrice={result.website === bestPriceWebsite}
                rank={result.status === "Success" ? i + 1 : null}
                lowestPrice={lowestPrice}
              />
            ))}
      </div>
    </>
  );
}
