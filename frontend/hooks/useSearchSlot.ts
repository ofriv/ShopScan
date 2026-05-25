"use client";

/**
 * useSearchSlot — encapsulates all state + SSE streaming logic for one search.
 *
 * By instantiating this hook twice (primary + secondary) in page.tsx we can run
 * two independent searches without any shared state getting tangled.
 *
 * Exports:
 *   run(q, onDone?)  — kick off a search; onDone is called with final results
 *   reset()          — wipe all state back to initial (called when a new manual
 *                      search clears the secondary slot)
 *   ...all display state (loading, results, siteStates, sortedResults, etc.)
 */

import { useState, useRef } from "react";
import type { ProductResult, ProgressEvent } from "@/types";

const BACKEND_URL = "http://localhost:8000";

// ── Shared constants (also imported by SearchResultsSection) ──────────────────

export const SITE_DISPLAY: Record<string, string> = {
  "Amazon.com":  "Amazon",
  "BestBuy.com": "Best Buy",
  "Walmart.com": "Walmart",
  "Newegg.com":  "Newegg",
};

export type SiteStateValue = "idle" | "run" | "ok" | "warn" | "fail";

export interface SiteState {
  state: SiteStateValue;
  method: string;   // last method tried or succeeded
  elapsed: string;  // "1.23s" after site_done / site_failed
}

export const INITIAL_SITE_STATES: Record<string, SiteState> = Object.fromEntries(
  Object.keys(SITE_DISPLAY).map((k) => [k, { state: "idle", method: "—", elapsed: "" }])
);

export type SortKey = "price" | "rating" | "speed";

export const METHOD_SPEED: Record<string, number> = {
  Basic: 1, Browser: 2, LLM: 3, Firecrawl: 4, "N/A": 5,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSearchSlot() {
  const [loading, setLoading]             = useState(false);
  const [results, setResults]             = useState<ProductResult[] | null>(null);
  const [fetchError, setFetchError]       = useState<string | null>(null);
  const [queryError, setQueryError]       = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchTime, setSearchTime]       = useState<number | null>(null);
  const [siteStates, setSiteStates]       = useState<Record<string, SiteState>>(INITIAL_SITE_STATES);
  const [sortBy, setSortBy]               = useState<SortKey>("price");

  const siteStartTimesRef = useRef<Record<string, number>>({});
  const searchStartRef    = useRef<number>(0);

  // ── Internal helpers ────────────────────────────────────────────────────────

  function updateSite(site: string, patch: Partial<SiteState>) {
    setSiteStates((prev) => ({ ...prev, [site]: { ...prev[site], ...patch } }));
  }

  function elapsed(site: string): string {
    const t = siteStartTimesRef.current[site];
    return t ? `${((Date.now() - t) / 1000).toFixed(2)}s` : "";
  }

  // ── Public: reset to blank state ────────────────────────────────────────────

  function reset() {
    setLoading(false);
    setResults(null);
    setFetchError(null);
    setQueryError(null);
    setSearchedQuery("");
    setSearchTime(null);
    setSiteStates(INITIAL_SITE_STATES);
    setSortBy("price");
    siteStartTimesRef.current = {};
  }

  // ── Public: run a search ────────────────────────────────────────────────────

  async function run(q: string, onDone?: (results: ProductResult[]) => void) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    // Reset all state for this slot before starting
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

          switch (event.type) {

            case "method_try":
              if (event.site && event.method) {
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
              // Promote price_warning sites to "warn" state
              finalResults.forEach((r) => {
                if (r.price_warning && r.status === "Success") {
                  updateSite(r.website, { state: "warn" });
                }
              });
              onDone?.(finalResults);
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

  const bestResult =
    results
      ?.filter((r) => r.status === "Success" && r.price !== null)
      .reduce<ProductResult | null>(
        (best, r) => (!best || r.price! < best.price!) ? r : best,
        null,
      ) ?? null;

  const bestPriceWebsite = bestResult?.website ?? null;
  const lowestPrice      = bestResult?.price ?? null;
  const successCount     = results?.filter((r) => r.status === "Success").length ?? 0;
  const showResults      = loading || results !== null;

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

  return {
    // Raw state
    loading, results, fetchError, queryError, searchedQuery, searchTime,
    siteStates, sortBy, setSortBy,
    // Derived
    showResults, sortedResults, bestPriceWebsite, lowestPrice, successCount,
    // Actions
    run, reset,
  };
}
