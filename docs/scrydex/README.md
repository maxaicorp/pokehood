# Scrydex docs (pasted reference)

Drop the Scrydex documentation here so it can be referenced anytime instead of
guessing/probing the live API. One file per topic. Paste raw — markdown, JSON
samples, curl examples, whatever you copy.

Suggested files (create as you paste):
- `api-reference.md` — endpoints, params, auth headers, rate limits
- `cards.md` — card object shape, `include=prices`, the `prices[]` + `trends` structure
- `price-history.md` — the `/price_history` endpoint, `days` param, data depth
- `webhooks.md` — events, payload shape, HMAC-SHA256 signature verification
- `pricing.md` / `credits.md` — credit costs per endpoint
- `pop-reports.md` — population report data

## Known so far (verified live, 2026-06-06)
- Auth headers: `X-Api-Key`, `X-Team-ID` (team ID is the dashboard ID, NOT the name "Collectiblez").
- `/pokemon/v1/cards/{id}/price_history?days=N` → daily series, but only ~20 days deep (floor 2026-05-17). 1 credit/card.
- `/pokemon/v1/cards/{id}?include=prices` → `prices[].trends` has `days_1/7/14/30/90/180` % change → 6-month anchors.
- **Webhooks exist** (`<game>.expansions.prices.raw_updated` / `.graded_updated` / `.pop_reports.updated`), HMAC-SHA256 signed via `X-Scrydex-Signature` (secret `whsec_...`). Could replace the credit-burning snapshot polling with real-time push. ← design the receiver once the payload docs are pasted here.
