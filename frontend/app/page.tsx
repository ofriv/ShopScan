"use client";

/**
 * Main page — search bar, live progress log, results grid, and suggestions.
 *
 * Flow:
 *   1. User types a query and submits (or clicks a quick chip / suggestion chip).
 *   2. POST /search/stream → SSE stream from FastAPI on localhost:8000.
 *   3. While streaming: show skeleton cards + live progress log below the grid.
 *   4. On "done" event: render 4 ProductCards, hide log, fetch suggestion in background.
 *   5. On "error" event: show error banner, keep log visible.
 *   6. Suggestion chips accumulate below the grid — clicking one runs a new search.
 */

import { useState, useRef, useEffect } from "react";
import type { ProductResult, ProgressEvent, SuggestResponse } from "@/types";
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

// ── Log line type ────────────────────────────────────────────────────────────
interface LogLine {
  text: string;
  cls: "log-info" | "log-success" | "log-fail" | "log-dim";
}

export default function Home() {
  const [query, setQuery]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [results, setResults]           = useState<ProductResult[] | null>(null);
  const [queryError, setQueryError]     = useState<string | null>(null);
  const [fetchError, setFetchError]     = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchTime, setSearchTime]     = useState<number | null>(null);

  // Live progress log — fills during streaming, hides when cards appear
  const [progressLog, setProgressLog]   = useState<LogLine[]>([]);

  // Complementary suggestions — accumulate across searches, never cleared
  const [suggestions, setSuggestions]   = useState<SuggestResponse[]>([]);

  // Ref used to auto-scroll the log to the latest entry
  const logEndRef = useRef<HTMLDivElement>(null);

  // Scroll the progress log to bottom whenever a new line is added
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressLog]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  function addLog(text: string, cls: LogLine["cls"] = "log-info") {
    setProgressLog(prev => [...prev, { text, cls }]);
  }

  function addLogs(lines: LogLine[]) {
    setProgressLog(prev => [...prev, ...lines]);
  }

  // ── Suggestion fetch (non-blocking, called after results arrive) ─────────

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
        setSuggestions(prev => [...prev, data]);
      }
    } catch {
      // Suggestions are non-critical — silently ignore any errors
    }
  }

  // ── Main search function ─────────────────────────────────────────────────

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setResults(null);
    setQueryError(null);
    setFetchError(null);
    setSearchedQuery(trimmed);
    setProgressLog([]);
    const start = performance.now();

    try {
      const res = await fetch(`${BACKEND_URL}/search/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!res.ok) {
        throw new Error(`Backend returned HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Accumulate text and split on SSE double-newline boundaries
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // keep any incomplete tail for next chunk

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;

          let event: ProgressEvent;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue; // skip malformed lines
          }

          // ── Handle each SSE event type ──────────────────────────────────
          switch (event.type) {

            case "query_processing":
              addLog("🔍 Validating query with AI...", "log-info");
              break;

            case "query_done":
              if (event.queries) {
                addLogs([
                  { text: "✅ Query optimized:", cls: "log-success" },
                  ...Object.entries(event.queries).map(([site, sq]) => ({
                    text: `   ${site.padEnd(13)} → "${sq}"`,
                    cls: "log-dim" as const,
                  })),
                ]);
              }
              break;

            case "method_try":
              addLog(
                `   ⏳ ${event.site}  ·  Trying ${event.method}...`,
                "log-dim",
              );
              break;

            case "method_failed":
              addLog(
                `   ❌ ${event.site}  ·  ${event.method} failed — ${event.error}`,
                "log-fail",
              );
              break;

            case "site_done":
              addLog(
                `   ✅ ${event.site}  ·  ${event.method} succeeded!`,
                "log-success",
              );
              break;

            case "site_failed":
              addLog(
                `   ✗  ${event.site}  ·  All methods failed`,
                "log-fail",
              );
              break;

            case "done": {
              const finalResults = event.results ?? [];
              setSearchTime((performance.now() - start) / 1000);
              setResults(finalResults);
              // Fire-and-forget suggestion fetch — never blocks the UI
              if (finalResults.length > 0) {
                fetchSuggestion(trimmed);
              }
              break;
            }

            case "error":
              setQueryError(event.message ?? "Unknown error");
              setResults([]);
              addLog(`⚠  ${event.message}`, "log-fail");
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

  // ── Derived state ────────────────────────────────────────────────────────

  // Website of the cheapest successful result (for the Best Price badge)
  const bestPriceWebsite =
    results
      ?.filter(r => r.status === "Success" && r.price !== null)
      .reduce<ProductResult | null>(
        (best, r) => (!best || r.price! < best.price!) ? r : best,
        null,
      )?.website ?? null;

  const successCount = results?.filter(r => r.status === "Success").length ?? 0;
  const showResults  = loading || results !== null;

  // Show the log while loading, or after a search that returned no cards
  const showLog =
    loading ||
    (progressLog.length > 0 && (!results || results.length === 0));

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
                  <ProductCard
                    key={result.website}
                    result={result}
                    isBestPrice={result.website === bestPriceWebsite}
                  />
                ))}
          </div>
        </>
      )}

      {/* ── Live progress log ────────────────────────────────────────── */}
      {showLog && progressLog.length > 0 && (
        <div className="progress-log" role="log" aria-live="polite">
          {progressLog.map((line, i) => (
            <div key={i} className={`log-line ${line.cls}`}>
              {line.text}
            </div>
          ))}
          {/* Invisible anchor that we scroll into view when new lines arrive */}
          <div ref={logEndRef} />
        </div>
      )}

      {/* ── Complementary suggestions ────────────────────────────────── */}
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
                onClick={() => {
                  setQuery(s.suggestion);
                  runSearch(s.suggestion);
                }}
              >
                <span className="s-text">{s.suggestion}</span>
                <span className="s-reason">— {s.reason}</span>
              </button>
            ))}
          </div>
        </div>
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
