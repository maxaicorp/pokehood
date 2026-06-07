# Scrydex Canonical Price Fix Handoff

Date: 2026-06-06 / 2026-06-07

This document captures the Scrydex pricing bug investigation, the proof we gathered, and the code changes that should be implemented when Lovable credits reset.

No secrets are included here. The temporary Scrydex key used during testing was rotated.

## Short Version

The pricing bug is upstream of SQL.

Scrydex returns the correct price when called through the canonical endpoint:

```text
GET https://api.scrydex.com/pokemon/v1/cards/me4-116?include=prices,pop_reports
```

But the deployed code was using locale paths like:

```text
/pokemon/v1/en/cards/...
```

For pricing, Scrydex's working API response is on:

```text
/pokemon/v1/cards/...
```

The correct model is:

1. Fetch from canonical Scrydex Pokemon card endpoints.
2. Filter returned cards in our code to English, physical, non-Pocket TCG.
3. Extract raw USD NM market prices only.
4. Write those rows to `price_snapshots`.
5. Run `refresh_latest_card_prices()` so the frontend cache updates.

## What We Proved

### 1. Live Scrydex Has The Correct Price

We ran a live Scrydex request for:

```text
me4-116 - Mega Greninja ex
```

The canonical endpoint returned:

```json
{
  "id": "me4-116",
  "name": "Mega Greninja ex",
  "language_code": "EN",
  "expansion_id": "me4",
  "expansion_name": "Chaos Rising",
  "expansion_language": "EN",
  "expansion_series": "Mega Evolution",
  "expansion_is_online_only": false,
  "raw_nm_usd_market": 372.71,
  "raw_nm_usd_low": 329.33,
  "raw_rows": [
    {
      "variant": "holofoil",
      "condition": "NM",
      "currency": "USD",
      "market": 372.71,
      "low": 329.33
    },
    {
      "variant": "holofoil",
      "condition": "LP",
      "currency": "USD",
      "market": 392.20,
      "low": 390.00
    }
  ]
}
```

This proves Scrydex is not the source of the bad `$430.37` value for this card.

### 2. SQL Can Display The Correct Price

We tested the DB/cache path by inserting the correct price into `price_snapshots` on the source date trusted by `refresh_latest_card_prices()`.

After running:

```sql
SELECT public.refresh_latest_card_prices();
```

`latest_card_prices` showed:

```text
card_id  card_name          price   recorded_at  set_name      updated_at
me4-116  Mega Greninja ex   372.71  2026-06-06   Chaos Rising  2026-06-07 04:43:19.209553+00
```

This proves `latest_card_prices` can show the right value if `price_snapshots` receives the right value.

### 3. Therefore The Broken Piece Is The Fetch/Write Code

The old deployed pipeline was not reliably putting the correct Scrydex NM price into `price_snapshots`.

The likely root cause is endpoint choice:

```text
Wrong for pricing pipeline:
/pokemon/v1/en/cards...

Correct for pricing pipeline:
/pokemon/v1/cards...
```

## Required Code Changes

### 1. `supabase/functions/snapshot-prices/index.ts`

Use canonical card endpoints.

Change global page fetches from:

```ts
const endpoint = `/pokemon/v1/en/cards?page=${page}&page_size=${PAGE_SIZE}&include=prices&orderBy=${orderBy}`;
```

To:

```ts
const endpoint = `/pokemon/v1/cards?page=${page}&page_size=${PAGE_SIZE}&include=prices&orderBy=${orderBy}`;
```

Change set backfill fetches from:

```ts
const endpoint =
  `/pokemon/v1/en/cards?q=${encodeURIComponent(`expansion.id:${setId}`)}` +
  `&page=${page}&page_size=${pageSize}&include=prices`;
```

To:

```ts
const endpoint =
  `/pokemon/v1/cards?q=${encodeURIComponent(`expansion.id:${setId}`)}` +
  `&page=${page}&page_size=${pageSize}&include=prices`;
```

Add `language_code` to the card type:

```ts
interface ScrydexCard {
  id: string;
  name: string;
  language_code?: string;
  expansion?: {
    id: string;
    name: string;
    series?: string;
    release_date?: string;
    language_code?: string;
    is_online_only?: boolean;
  };
  variants?: ScrydexVariant[];
}
```

Filter after the fetch, before extraction/writes:

```ts
// English physical TCG only.
if (card.language_code && card.language_code !== "EN") continue;
if (card.expansion?.language_code !== "EN") continue;
if (card.expansion?.is_online_only) continue;
const series = (card.expansion?.series ?? "").toLowerCase();
if (series.includes("pocket")) continue;
```

Keep the existing raw NM extraction policy:

```ts
const price = v.prices?.find(
  (x) => x.condition === "NM" && x.type === "raw" && x.currency === "USD" && x.market > 0,
)?.market;
```

Do not fall back to LP/MP/HP/DMG. If no NM exists, write nothing.

### 2. `supabase/functions/scrydex-proxy/index.ts`

The proxy currently allowed only:

```ts
const ALLOWED_PREFIXES = ["/pokemon/v1/en/"];
```

Replace that with canonical-safe catalog endpoint bases:

```ts
const ALLOWED_ENDPOINT_BASES = [
  "/pokemon/v1/cards",
  "/pokemon/v1/expansions",
  "/pokemon/v1/sealed",
  "/pokemon/v1/en/cards",
  "/pokemon/v1/en/expansions",
  "/pokemon/v1/en/sealed",
];

function endpointAllowed(endpoint: string): boolean {
  return ALLOWED_ENDPOINT_BASES.some(
    (base) => endpoint === base || endpoint.startsWith(`${base}/`) || endpoint.startsWith(`${base}?`)
  );
}
```

Then replace the old allowlist check with:

```ts
if (!endpointAllowed(endpoint)) {
  return new Response(
    JSON.stringify({ error: "Endpoint not allowed" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
  );
}
```

### 3. `src/lib/scrydex-api.ts`

Frontend/admin Scrydex calls should try canonical first and only fall back to `/en/`.

Add a helper:

```ts
async function proxyFetchFirst(endpoints: string[]) {
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      return await proxyFetch(endpoint);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Scrydex API error");
}
```

Update single-card fetch:

```ts
export async function getScrydexCard(id: string): Promise<ScrydexCard | null> {
  try {
    const data = await proxyFetchFirst([
      `/pokemon/v1/cards/${id}?include=prices`,
      `/pokemon/v1/en/cards/${id}?include=prices`,
    ]);
    return data as ScrydexCard;
  } catch {
    return null;
  }
}
```

Update card list fetches similarly:

```ts
const data = await proxyFetchFirst([
  `/pokemon/v1/cards?${params.toString()}`,
  `/pokemon/v1/en/cards?${params.toString()}`,
]);
```

For expansion cards:

```ts
let basePath = `/pokemon/v1/expansions/${expansionId}/cards`;
const endpoint = (page: number) => `${basePath}?page=${page}&page_size=${PAGE_SIZE}&include=prices`;
let first;
try {
  first = await proxyFetch(endpoint(1));
} catch {
  basePath = `/pokemon/v1/en/expansions/${expansionId}/cards`;
  first = await proxyFetch(endpoint(1));
}
```

### 4. Optional Admin Tool

The existing manual override UI was confusing because it could say:

```text
No latest_card_prices row for that id.
```

Even when history existed or when the input was a full Collectiblez URL.

Add an admin tool that:

1. Accepts either a Collectiblez URL or raw Scrydex card id.
2. Resolves URLs to ids, for example `me4-116`.
3. Queries `latest_card_prices`.
4. Falls back to latest `price_snapshots` if no latest row exists.
5. Fetches live Scrydex canonical card data.
6. Shows raw Scrydex rows by variant and condition.
7. Lets admin pin live NM, pin typed price, or queue history backfill.

This is not required for the daily pipeline fix, but it makes debugging much clearer.

## SQL Verification Query

Use this to check a card across history, cache, and overrides:

```sql
SELECT card_id, price, recorded_at
FROM public.price_snapshots
WHERE card_id = 'me4-116'
ORDER BY recorded_at DESC
LIMIT 20;

SELECT card_id, price, recorded_at, updated_at
FROM public.latest_card_prices
WHERE card_id = 'me4-116';

SELECT *
FROM public.card_price_overrides
WHERE card_id = 'me4-116';
```

Use this to prove the cache can display the correct price without permanently changing data:

```sql
BEGIN;

WITH source_date AS (
  SELECT ps.recorded_at
  FROM public.price_snapshots ps
  WHERE ps.card_id NOT LIKE 'sealed-%'
    AND ps.price IS NOT NULL
    AND ps.price > 0
  GROUP BY ps.recorded_at
  HAVING count(DISTINCT ps.card_id) >= 17000
  ORDER BY ps.recorded_at DESC
  LIMIT 1
)
SELECT * FROM source_date;

SELECT *
FROM public.card_price_overrides
WHERE card_id = 'me4-116';

DELETE FROM public.card_price_overrides
WHERE card_id = 'me4-116';

WITH source_date AS (
  SELECT ps.recorded_at
  FROM public.price_snapshots ps
  WHERE ps.card_id NOT LIKE 'sealed-%'
    AND ps.price IS NOT NULL
    AND ps.price > 0
  GROUP BY ps.recorded_at
  HAVING count(DISTINCT ps.card_id) >= 17000
  ORDER BY ps.recorded_at DESC
  LIMIT 1
)
INSERT INTO public.price_snapshots (card_id, card_name, set_name, price, recorded_at)
SELECT 'me4-116', 'Mega Greninja ex', 'Chaos Rising', 372.71, recorded_at
FROM source_date
ON CONFLICT (card_id, recorded_at) DO UPDATE
SET price = EXCLUDED.price,
    card_name = EXCLUDED.card_name,
    set_name = EXCLUDED.set_name;

SELECT public.refresh_latest_card_prices();

SELECT card_id, card_name, set_name, price, recorded_at, updated_at
FROM public.latest_card_prices
WHERE card_id = 'me4-116';

ROLLBACK;
```

Expected result before rollback:

```text
me4-116 | Mega Greninja ex | Chaos Rising | 372.71
```

## Deployment Steps

When Lovable credits reset:

1. Implement the code changes above.
2. Deploy frontend/admin code.
3. Deploy Supabase Edge Function `scrydex-proxy`.
4. Deploy Supabase Edge Function `snapshot-prices`.
5. Run a targeted backfill for Chaos Rising, or wait for the next snapshot run.
6. Run or confirm `refresh_latest_card_prices()`.
7. Check `me4-116` in SQL and on the card page.

Targeted backfill mode already exists in `snapshot-prices`:

```json
{
  "mode": "sets",
  "setIds": ["me4"],
  "force": true
}
```

## Local Tests Already Run

These passed locally after implementing the changes:

```bash
npm run typecheck
npm test
npm run build
```

Test coverage added during the session:

```text
src/lib/scrydex-api.test.ts
```

The tests verify:

1. The NM extractor accepts a `holofoil` raw NM USD market of `372.71`.
2. The extractor does not fabricate NM when Scrydex only returns LP.

## No-Deploy Temporary Backfill Option

If edge functions cannot be deployed but SQL can be run manually, use a local script approach:

1. Call Scrydex locally with a rotatable API key.
2. Apply the same filters:
   - card language EN
   - expansion language EN
   - not online only
   - series does not include Pocket
   - raw USD NM market only
3. Generate `INSERT INTO public.price_snapshots ... ON CONFLICT ... DO UPDATE` SQL.
4. Run `SELECT public.refresh_latest_card_prices();`.

This patches data but does not permanently fix the deployed cron. The permanent fix is still the endpoint/filter code change in `snapshot-prices`.

## Key Takeaway

The bug was not that Scrydex lacked the price.

The bug was not that SQL could not display the price.

The bug was the app's Scrydex fetch path and filtering strategy:

```text
Use canonical Scrydex endpoints.
Filter English/non-Pocket physical TCG in code.
Write raw USD NM market only.
Refresh latest_card_prices.
```
