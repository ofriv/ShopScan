"use client";

/**
 * Main page — search bar, scan-status panel, results grid, and suggestions.
 *
 * Flow:
 *   1. User types a query and submits (or clicks a chip).
 *   2. POST /search/stream → SSE stream from FastAPI on localhost:8000.
 *   3. While streaming: skeleton cards + live scan-status panel update per site.
 *   4. On "done": render ProductCards (sorted), hide skeleton, fetch suggestion.
 *   5. Suggestion chips accumulate below the grid — clicking one runs a new search.
 */

import { useState, useRef } from "react";
import type { ProductResult, ProgressEvent, SuggestResponse } from "@/types";
import ProductCard from "@/components/ProductCard";
import SkeletonCard from "@/components/SkeletonCard";

const QUICK_CHIPS = [
  "Sony WH-1000XM5",
  "iPad Air M3",
  'LG C4 65"',
  "Dyson V15 Detect",
  "RTX 5080",
];

const BACKEND_URL = "http://localhost:8000";

// Human-readable name for each site key
const SITE_DISPLAY: Record<string, string> = {
  "Amazon.com":  "Amazon",
  "BestBuy.com": "Best Buy",
  "Walmart.com": "Walmart",
  "Newegg.com":  "Newegg",
};

// ── Per-site scan state ───────────────────────────────────────────────────────
type SiteStateValue = "idle" | "run" | "ok" | "warn" | "fail";

interface SiteState {
  state: SiteStateValue;
  method: string;   // last method tried or succeeded
  elapsed: string;  // "1.23s" after site_done / site_failed
}

const INITIAL_SITE_STATES: Record<string, SiteState> = Object.fromEntries(
  Object.keys(SITE_DISPLAY).map((k) => [k, { state: "idle", method: "—", elapsed: "" }])
);

// ── Sort key ─────────────────────────────────────────────────────────────────
type SortKey = "price" | "rating" | "speed";

const METHOD_SPEED: Record<string, number> = {
  Basic: 1, Browser: 2, LLM: 3, Firecrawl: 4, "N/A": 5,
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [query, setQuery]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [results, setResults]             = useState<ProductResult[] | null>(null);
  const [queryError, setQueryError]       = useState<string | null>(null);
  const [fetchError, setFetchError]       = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchTime, setSearchTime]       = useState<number | null>(null);
  const [siteStates, setSiteStates]       = useState<Record<string, SiteState>>(INITIAL_SITE_STATES);
  const [suggestions, setSuggestions]     = useState<SuggestResponse[]>([]);
  const [sortBy, setSortBy]               = useState<SortKey>("price");

  // Per-site start timestamps (don't need to trigger re-renders)
  const siteStartTimesRef = useRef<Record<string, number>>({});
  const searchStartRef    = useRef<number>(0);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function updateSite(site: string, patch: Partial<SiteState>) {
    setSiteStates((prev) => ({ ...prev, [site]: { ...prev[site], ...patch } }));
  }

  function elapsed(site: string): string {
    const t = siteStartTimesRef.current[site];
    return t ? `${((Date.now() - t) / 1000).toFixed(2)}s` : "";
  }

  // ── Suggestion fetch (non-blocking) ─────────────────────────────────────

  async function fetchSuggestion(q: string) {
    try {
      const res = await fetch(`${BACKEND_URL}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) return;
      const data: SuggestResponse = await res.json();
      if (data.suggestion) {
        // Deduplicate by suggestion text
        setSuggestions((prev) =>
          prev.some((s) => s.suggestion === data.suggestion) ? prev : [...prev, data]
        );
      }
    } catch {
      // Suggestions are non-critical — silently ignore errors
    }
  }

  // ── Main search ──────────────────────────────────────────────────────────

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    // Reset state for new search
    setLoading(true);
    setResults(null);
    setQueryError(null);
    setFetchError(null);
    setSearchedQuery(trimmed);
    setSearchTime(null);
    setSiteStates(INITIAL_SITE_STATES);
    siteStartTimesRef.current = {};
    searchStartRef.current = performance.now();

    try {
      const res = await fetch(`${BACKEND_URL}/search/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!res.ok) throw new Error(`Backend returned HTTP ${res.status}`);

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;

          let event: ProgressEvent;
          try { event = JSON.parse(line.slice(6)); }
          catch { continue; }

          // ── Handle each SSE event ───────────────────────────────────
          switch (event.type) {

            case "method_try":
              if (event.site && event.method) {
                // Record site start time on first method_try
                if (!siteStartTimesRef.current[event.site]) {
                  siteStartTimesRef.current[event.site] = Date.now();
                }
                updateSite(event.site, { state: "run", method: event.method });
              }
              break;

            case "method_failed":
              // Site stays "run" — next method_try will update the method name
              break;

            case "site_done":
              if (event.site && event.method) {
                updateSite(event.site, {
                  state: "ok",
                  method: event.method,
                  elapsed: elapsed(event.site),
                });
              }
              break;

            case "site_failed":
              if (event.site) {
                updateSite(event.site, {
                  state: "fail",
                  method: "N/A",
                  elapsed: elapsed(event.site),
                });
              }
              break;

            case "done": {
              const finalResults = event.results ?? [];
              setSearchTime((performance.now() - searchStartRef.current) / 1000);
              setResults(finalResults);
              // Promote sites with price_warning to "warn" state
              finalResults.forEach((r) => {
                if (r.price_warning && r.status === "Success") {
                  updateSite(r.website, { state: "warn" });
                }
              });
              if (finalResults.length > 0) fetchSuggestion(trimmed);
              break;
            }

            case "error":
              setQueryError(event.message ?? "Unknown error");
              setResults([]);
              break;
          }
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not connect to the backend. Make sure it is running on port 8000.";
      setFetchError(msg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  // Best price = cheapest successful result (used for card.best treatment + delta)
  const bestResult =
    results
      ?.filter((r) => r.status === "Success" && r.price !== null)
      .reduce<ProductResult | null>(
        (best, r) => (!best || r.price! < best.price!) ? r : best,
        null,
      ) ?? null;
  const bestPriceWebsite = bestResult?.website ?? null;
  const lowestPrice      = bestResult?.price ?? null;

  const successCount = results?.filter((r) => r.status === "Success").length ?? 0;
  const showResults  = loading || results !== null;

  // Sorted results: available cards first, then by chosen sort key
  const sortedResults = results
    ? [...results].sort((a, b) => {
        const aOk = a.status === "Success", bOk = b.status === "Success";
        if (aOk !== bOk) return aOk ? -1 : 1;
        if (!aOk) return 0;
        switch (sortBy) {
          case "price":  return (a.price  ?? Infinity) - (b.price  ?? Infinity);
          case "rating": return (b.rating ?? 0)        - (a.rating ?? 0);
          case "speed":  return (METHOD_SPEED[a.method] ?? 5) - (METHOD_SPEED[b.method] ?? 5);
          default:       return 0;
        }
      })
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page">

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>ShopScan</span>
        </div>
        <nav>
          <a href="#">How it works</a>
          <a href="#">Retailers</a>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="eyebrow">
          <span className="pulse" />
          4 retailers · live scraping
        </div>
        <h1>
          One search.<br />
          <em>Every</em> retailer.
        </h1>
        <p className="tagline">
          Side-by-side prices, ratings, and availability — pulled live from
          Amazon, Best Buy, Walmart, and Newegg using four different scraping
          strategies.
        </p>
      </section>

      {/* ── Search bar ───────────────────────────────────────────────── */}
      <section className="search">
        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query || "Sony WH-1000XM5");
          }}
          autoComplete="off"
        >
          <div className="search-input-wrap">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a product (e.g. Sony WH-1000XM5)"
              disabled={loading}
            />
          </div>
          <span className="search-meta">/scan</span>
          <button type="submit" disabled={loading}>
            <span>{loading ? "Searching…" : "Search"}</span>
            {!loading && (
              <svg
                width="14" height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            )}
          </button>
        </form>

        {/* Quick-search chips with numbered tags */}
        <div className="quick-row">
          {QUICK_CHIPS.map((chip, i) => (
            <button
              key={chip}
              type="button"
              className="chip"
              disabled={loading}
              onClick={() => { setQuery(chip); runSearch(chip); }}
            >
              <span className="chip-tag">{String(i + 1).padStart(2, "0")}</span>
              {chip}
            </button>
          ))}
        </div>
      </section>

      {/* ── Query-rejection error ─────────────────────────────────────── */}
      {queryError && !loading && (
        <div className="error-banner">
          <strong>Query rejected:</strong> {queryError}
        </div>
      )}

      {/* ── Network / backend error ───────────────────────────────────── */}
      {fetchError && !loading && (
        <div className="error-banner">
          <strong>Connection error:</strong> {fetchError}
        </div>
      )}

      {/* ── Scan status panel ─────────────────────────────────────────── */}
      {showResults && (
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
      )}

      {/* ── Results meta + sort tabs ──────────────────────────────────── */}
      {showResults && (
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
      )}

      {/* ── Cards grid ───────────────────────────────────────────────── */}
      {showResults && (
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
      )}

      {/* ── Complementary suggestions ─────────────────────────────────── */}
      {suggestions.length > 0 && (
        <div className="suggestions">
          <div className="suggestions-label">💡 You might also like:</div>
          <div className="suggestions-row">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className="suggestion-chip"
                disabled={loading}
                onClick={() => { setQuery(s.suggestion); runSearch(s.suggestion); }}
              >
                <span className="s-text">{s.suggestion}</span>
                <span className="s-reason">— {s.reason}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="footer">
        <div className="legend">
          <span><i className="l-basic" />Basic HTTP</span>
          <span><i className="l-browser" />Headless Browser</span>
          <span><i className="l-llm" />LLM extract</span>
          <span><i className="l-firecrawl" />Firecrawl</span>
        </div>
        <div>© 2026 ShopScan · Built for comparison shoppers</div>
      </footer>
    </div>
  );
}
