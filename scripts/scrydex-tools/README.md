# Scrydex price tools

Utilities for auditing the site's stored card prices against **live Scrydex** and
fixing the wrong ones. Built after the recurring chase-card mispricing
(Mega Gengar ex `me2pt5-284`): the deployed snapshot cron sometimes writes a
played-grade fallback, a stale value, or a padded-twin clobber. These tools let
you spot exactly which cards are off and pin the correct price.

## Files
| File | What it does |
|------|--------------|
| `dump_modern_top.sql` | Top 150 Modern-Era cards (SV + Mega Evolution) by price — the Market "TOP / Modern Era" list. |
| `dump_all_top.sql` | Top 200 across all sets (incl. vintage). |
| `validate_prices.py` | Pulls live Scrydex NM price + 1d/7d/30d trends for each card, diffs vs the stored values, prints which are off, and emits override SQL for them. |
| `set_override.sql` | Manually pin one (or more) card's price + deltas. |

## How a price audit works
1. **Dump** the list — run `dump_modern_top.sql` (or `dump_all_top.sql`) in the
   Supabase SQL editor.
2. **Save** the result grid (keep the header row) to a text file, e.g. `stored.txt`.
3. **Validate** against Scrydex:
   ```bash
   SCRYDEX_KEY=<your-key> python validate_prices.py stored.txt
   ```
   Optional env: `SCRYDEX_TEAM` (default `collectiblez`), `THRESHOLD` (default `3` %).
   Costs ~1 Scrydex credit per unique card.
4. **Review** the diff table. It prints an `INSERT … ON CONFLICT` override block
   for the flagged cards (correct price + Scrydex-derived deltas).
5. **Apply** only the ones you actually want to pin — run that SQL in the editor.
   It ends with `SELECT public.refresh_latest_card_prices();` so the homepage
   updates immediately.

## When to override vs. leave it
- **Override** catastrophic errors (15 %+ off, or a price that matches no real
  condition — the fallback/twin bug). Pins survive every cron run forever.
- **Leave** minor drift (a few %) — that's normal staleness the daily cron
  self-corrects once the `snapshot-prices` edge-fn fix is deployed. Pinning
  *freezes* a card, so don't pin ones that should keep moving.
- To unpin later: `DELETE FROM card_price_overrides WHERE card_id='…';` then
  `SELECT public.refresh_latest_card_prices();`

## Security
The API key is read from the `SCRYDEX_KEY` environment variable only. **Never**
hard-code it in these files or commit it. Rotate the key in the Scrydex
dashboard after a manual session.

## Requirements
`python` 3 and `curl` on PATH. (We shell out to `curl` because Scrydex's edge
rejects Python-urllib's default User-Agent.)
