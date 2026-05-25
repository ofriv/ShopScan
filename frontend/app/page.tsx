"use client";

/**
 * Main page — search bar, two search slots, and suggestion chip.
 *
 * Flow:
 *   1. User submits a query (or clicks a quick chip).
 *      → primary slot runs; secondary slot + suggestions are cleared.
 *   2. On "done": a single suggestion chip appears below the primary results.
 *   3. User clicks the suggestion chip.
 *      → chip disappears; secondary slot runs BELOW the primary results.
 *      → no further suggestions after this.
 *   4. User submits a new manual search → everything clears and restarts.
 */

import { useState } from "react";
import type { SuggestResponse } from "@/types";
import SearchResultsSection from "@/components/SearchResultsSection";
import { useSearchSlot } from "@/hooks/useSearchSlot";

const QUICK_CHIPS = [
  "Sony WH-1000XM5",
  "iPad Air M3",
  'LG C4 65"',
  "Dyson V15 Detect",
  "RTX 5080",
];

const BACKEND_URL = "http://localhost:8000";

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [query, setQuery]           = useState("");
  const [suggestions, setSuggestions] = useState<SuggestResponse[]>([]);

  // Two independent search slots
  const primary   = useSearchSlot();
  const secondary = useSearchSlot();

  // ── Suggestion fetch (non-blocking, only called after primary search) ─────

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
        setSuggestions((prev) =>
          prev.some((s) => s.suggestion === data.suggestion) ? prev : [...prev, data]
        );
      }
    } catch {
      // Suggestions are non-critical — silently ignore errors
    }
  }

  // ── Manual search (search bar + quick chips) ──────────────────────────────

  function handleSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed || primary.loading) return;

    // Always start fresh: wipe secondary slot and any pending suggestions
    secondary.reset();
    setSuggestions([]);

    // Run primary; once done, fetch one suggestion (no onDone for secondary)
    primary.run(trimmed, (results) => {
      if (results.length > 0) fetchSuggestion(trimmed);
    });
  }

  // ── Suggestion click ──────────────────────────────────────────────────────

  function handleSuggestion(s: SuggestResponse) {
    // Remove the chips immediately (no further suggestions after this)
    setSuggestions([]);
    // Run secondary slot — no onDone callback, so no new suggestions
    secondary.run(s.suggestion);
  }

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
            handleSearch(query || "Sony WH-1000XM5");
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
              disabled={primary.loading}
            />
          </div>
          <span className="search-meta">/scan</span>
          <button type="submit" disabled={primary.loading}>
            <span>{primary.loading ? "Searching…" : "Search"}</span>
            {!primary.loading && (
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
              disabled={primary.loading}
              onClick={() => { setQuery(chip); handleSearch(chip); }}
            >
              <span className="chip-tag">{String(i + 1).padStart(2, "0")}</span>
              {chip}
            </button>
          ))}
        </div>
      </section>

      {/* ── Primary search results ────────────────────────────────────── */}
      {primary.showResults && (
        <SearchResultsSection
          loading={primary.loading}
          results={primary.results}
          fetchError={primary.fetchError}
          queryError={primary.queryError}
          searchedQuery={primary.searchedQuery}
          searchTime={primary.searchTime}
          siteStates={primary.siteStates}
          sortBy={primary.sortBy}
          setSortBy={primary.setSortBy}
          sortedResults={primary.sortedResults}
          bestPriceWebsite={primary.bestPriceWebsite}
          lowestPrice={primary.lowestPrice}
          successCount={primary.successCount}
        />
      )}

      {/* ── Suggestion chip (only between primary and secondary) ──────── */}
      {suggestions.length > 0 && !primary.loading && !secondary.showResults && (
        <div className="suggestions">
          <div className="suggestions-label">💡 You might also like:</div>
          <div className="suggestions-row">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className="suggestion-chip"
                disabled={primary.loading}
                onClick={() => handleSuggestion(s)}
              >
                <span className="s-text">{s.suggestion}</span>
                <span className="s-reason">— {s.reason}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Section divider + secondary search results ────────────────── */}
      {secondary.showResults && (
        <>
          <div className="section-divider">
            <span className="section-divider-label">
              Also comparing &ldquo;{secondary.searchedQuery}&rdquo;
            </span>
          </div>
          <SearchResultsSection
            loading={secondary.loading}
            results={secondary.results}
            fetchError={secondary.fetchError}
            queryError={secondary.queryError}
            searchedQuery={secondary.searchedQuery}
            searchTime={secondary.searchTime}
            siteStates={secondary.siteStates}
            sortBy={secondary.sortBy}
            setSortBy={secondary.setSortBy}
            sortedResults={secondary.sortedResults}
            bestPriceWebsite={secondary.bestPriceWebsite}
            lowestPrice={secondary.lowestPrice}
            successCount={secondary.successCount}
          />
        </>
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
