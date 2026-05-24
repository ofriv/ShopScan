"use client";

/**
 * Main page — search bar, loading skeleton, and results grid.
 *
 * Flow:
 *   1. User types a query and submits (or clicks a quick chip).
 *   2. POST /search → FastAPI backend on localhost:8000.
 *   3. While waiting: show 4 skeleton cards.
 *   4. On response:
 *      - If backend rejected the query (error field): show error banner.
 *      - Otherwise: render 4 ProductCards (one per site, some may be Failed).
 */

import { useState } from "react";
import type { ProductResult, SearchResponse } from "@/types";
import ProductCard from "@/components/ProductCard";
import SkeletonCard from "@/components/SkeletonCard";

// Quick-search suggestion chips shown below the search bar
const QUICK_CHIPS = [
  "Sony WH-1000XM5",
  "iPad Air M3",
  'LG C4 65"',
  "Dyson V15 Detect",
  "RTX 5080",
];

const BACKEND_URL = "http://localhost:8000";

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProductResult[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null); // rejected query
  const [fetchError, setFetchError] = useState<string | null>(null); // network error
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchTime, setSearchTime] = useState<number | null>(null);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setResults(null);
    setQueryError(null);
    setFetchError(null);
    setSearchedQuery(trimmed);
    const start = performance.now();

    try {
      const res = await fetch(`${BACKEND_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!res.ok) {
        throw new Error(`Backend returned HTTP ${res.status}`);
      }

      const data: SearchResponse = await res.json();
      setSearchTime((performance.now() - start) / 1000);

      if (data.error) {
        // The query was rejected before scraping (e.g. "not a product")
        setQueryError(data.error);
        setResults([]);
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setFetchError(
        err instanceof Error
          ? err.message
          : "Could not connect to the backend. Make sure it is running on port 8000."
      );
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // Count how many sites returned a successful result
  const successCount = results?.filter((r) => r.status === "Success").length ?? 0;
  const showResults = loading || results !== null;

  return (
    <div className="page">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
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

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="eyebrow">
          <span className="dot" />
          4 retailers · live scraping
        </div>
        <h1>
          Compare prices across{" "}
          <span className="accent">top retailers</span> instantly.
        </h1>
        <p className="tagline">
          One search. Four scrapers. Side-by-side prices, ratings, and
          availability from Amazon, Best Buy, Walmart, and Newegg.
        </p>
      </section>

      {/* ── Search bar ──────────────────────────────────────────────── */}
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
            {/* Search icon */}
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
          <button type="submit" disabled={loading}>
            <span>{loading ? "Searching…" : "Search"}</span>
            {!loading && (
              <svg
                width="14"
                height="14"
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

        {/* Quick-search chips */}
        <div className="quick-row">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className="chip"
              disabled={loading}
              onClick={() => {
                setQuery(chip);
                runSearch(chip);
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      {/* ── Query-rejection error banner ─────────────────────────────── */}
      {queryError && !loading && (
        <div className="error-banner">
          <strong>Query rejected:</strong> {queryError}
        </div>
      )}

      {/* ── Network / backend error banner ───────────────────────────── */}
      {fetchError && !loading && (
        <div className="error-banner">
          <strong>Connection error:</strong> {fetchError}
        </div>
      )}

      {/* ── Results section ──────────────────────────────────────────── */}
      {showResults && (
        <>
          <div className="results-meta">
            <div className="results-title">
              Results for <span>&ldquo;{searchedQuery}&rdquo;</span>
            </div>
            <div className="results-stats">
              {loading
                ? "scanning retailers…"
                : `${successCount} of 4 retailers · ${searchTime?.toFixed(2)}s`}
            </div>
          </div>

          <div className="grid">
            {loading
              ? Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
              : results?.map((result) => (
                  <ProductCard key={result.website} result={result} />
                ))}
          </div>
        </>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="footer">
        <div>© 2026 ShopScan · Built for comparison shoppers</div>
        <div className="legend">
          <span>
            <i className="l-basic" />
            Basic HTTP
          </span>
          <span>
            <i className="l-browser" />
            Headless Browser
          </span>
          <span>
            <i className="l-llm" />
            LLM extract
          </span>
          <span>
            <i className="l-firecrawl" />
            Firecrawl
          </span>
        </div>
      </footer>
    </div>
  );
}
