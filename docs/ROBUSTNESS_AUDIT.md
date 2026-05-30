# Robustness audit (2026-05-30)

Cross-cutting pass over error handling, null/NaN safety, storage access,
realtime load, race conditions, and abuse vectors — after the per-URL bug
audit and the fix queue.

## ✅ Fixed
- **`formatPrice` NaN/undefined** → guarded `null`, `undefined`, `NaN`, `Infinity` (was only `null`); a malformed price could render "$NaN" anywhere. Widened the type too.
- **`analytics-themes` localStorage** → get/set wrapped in try/catch; storage-disabled browsers no longer crash the Pro Analytics view.

## ✅ Verified solid (no change needed)
- **ErrorBoundary** wraps all routes (added earlier) — a render throw shows a recoverable fallback, not a blank page.
- **card-stats writes** — fire-and-forget, error-swallowed, 5s client dedupe, map size-capped. Won't break the UI.
- **cache-invalidation** (global) — resetters individually try/caught; storage listener reads `e.key` only (no throwing localStorage read).
- **Profile view tracking** — localStorage now try/caught + per-day dedupe (fixed in mega-audit pass).
- **Vote / portfolio / Market sort / search** races — all addressed (applyVote helper, repriceLive, full-set sort, latestQuery guard).
- **pct math** — divide-by-zero guarded (`!== 0`), `formatPct` clamps Infinity / sanity-limit; `pct.toFixed` calls sit behind `!= null` guards.
- **searchCatalog** — returns null on RPC error → GlobalSearch falls back to client search (no blank box pre-migration).
- **getLatestPricesByIds / repriceLive** — chunked to 200 ids (PostgREST URL limit), failures caught → rows render "—".

## ⚠️ Documented (backend / deploy-gated — not fixed here)
- **Realtime flood (Market).** Subscribes to every `price_snapshots` INSERT; a cron run streams thousands of change events to every open tab. The 3s debounce collapses the *refetch* to one, so it's correct, but the websocket event volume is a scaling/cost concern. **Proper fix (backend):** have the cron write one row to a `snapshot_runs` signal table at completion and subscribe to THAT (1 event/run instead of thousands), or use a broadcast channel. Deploy-gated (edge-fn/cron change).
- **`increment_card_stat` is anon-callable + SECURITY DEFINER.** View/search counters (and "Most Visited") can be inflated by anyone scripting the RPC. Low severity (vanity metrics, no money). **If Most-Visited ever gates value/prizes:** add per-session/IP rate-limiting or move counting server-side. (No `REVOKE`/grant scoping today.)

## 🧹 Cleanup noted
- `src/components/ThemeToggle.tsx` is dead code — unused (app uses next-themes); its unguarded localStorage is harmless because it never renders. Delete in a cleanup pass.
