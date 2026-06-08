# Marketing Automation

## Goal

Use the existing cached market data to create content ideas and exportable graphics without spending Scrydex credits per visitor or per admin page load.

## Data Flow

1. `snapshot-prices` crawls Scrydex by set and writes `price_snapshots`.
2. `refresh_latest_card_prices()` rebuilds the read cache.
3. `refresh_set_index()` snapshots aggregate set values for the heatmap.
4. `generate_marketing_content_signals()` creates draft content rows from cached data.
5. `/admin/content-signals` reviews, edits, approves, and exports PNG graphics.

No public page calls Scrydex. The content queue reads Supabase only.

## Public Pages

- `/heatmap`: set-level heatmap using `get_set_index_overview()`.
- `/indexes`: alias for `/heatmap`, kept for earlier draft links.

## Admin Page

- `/admin/content-signals`
- Generate new signals manually.
- Filter by `draft`, `approved`, `scheduled`, `posted`, `archived`, or `all`.
- Edit captions.
- Export PNG graphics from the selected template.
- Mark signals approved, queued, or archived.

## Database Objects

- `set_index_snapshots`
- `refresh_set_index()`
- `get_set_index_overview()`
- `get_set_index_history(set_id, days)`
- `marketing_content_signals`
- `generate_marketing_content_signals(date)`

## Edge Function

- `generate-content-signals`
- Auth: admin JWT or `x-cron-secret`.
- Calls `generate_marketing_content_signals()`.
- Does not post to X, Instagram, TikTok, Discord, or any other public channel.

## Cron

Configured in `docs/PER_SET_PIPELINE_DEPLOY.sql`:

- `refresh-set-index-intraday`: runs after each price cache refresh.
- `generate-content-signals-daily`: creates daily draft rows.

## Future Posting Layer

Keep posting separate from signal generation. The next layer should:

1. Read only `approved` or `scheduled` rows.
2. Generate and store final PNGs in Supabase Storage.
3. Post through platform APIs using server-side credentials only.
4. Write `posted_at` and `posted_url`.
5. Never auto-post rows still in `draft`.
