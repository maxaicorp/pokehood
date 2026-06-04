# Collectiblez — active fix list

Living checklist. Grouped so blocked/decision items don't stall shippable ones.

---

## ▶ RESUME HERE (6/4) — start at the top

### 1. 🔴 Search-bar freeze (TOP PRIORITY)
Clicking the search → ~1 minute unresponsive.
- **Diagnosis:** the client search index (`searchCardsAdvanced` → `loadCardIndex`) loads the **9.9 MB `all-cards.json`** + seeds **~22k price rows on the main thread** the first time it runs. Hits the **Explore page** and the **header bar's fallback** (when `search_catalog` RPC returns null). The header dropdown itself uses the fast DB RPC.
- **Ties to #2:** `loadCardIndex` *should* read the lightweight DB `cards` table, but it's empty → always falls back to the 9.9 MB file. **Populating `cards` removes the 9.9 MB load = fixes the freeze.**
- **Need from user:** (a) does it freeze on the **header bar** or the **Explore page**? (b) does the dropdown eventually show results?
- **Quick safe fix available now:** make the header search **never** fall back to the 9.9 MB client path.

### 2. 🔴 `cards` table sync writes 0 (KEYSTONE — unblocks a lot)
`sync-cards-catalog` runs but writes 0 rows (schema mismatch; PK exists). **Need user to paste the `cards` column list:**
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='cards' ORDER BY ordinal_position;
```
Likely a `number`/`hp` column typed `integer` instead of `text`. **Unblocks:** Explore listing vintage, header-dropdown rarity search (#3), AND removes the 9.9 MB search-index load (#1).

### 3. 🟡 Header-dropdown rarity search — gated on #2
The top-bar `search_catalog` RPC matches card **name only**. Add a JOIN to `cards` for rarity/alias matching once #2 is populated. (Explore-page search already does rarity/type/aliases — Tier 1, shipped.)

### 4. 🟡 Verify `snapshot-prices` redeploy
User told Lovable to redeploy it. Confirm version reads `2026-06-03-nm-only-canonical-dedup` (e.g. /admin/functions). Until then the daily cron can still write bad fills (overrides protect pinned cards).

### 5. Continue the broader pass: **Explore → search → user features**
Audit Explore (filters, the separate wishlist heart now that the panel has it, empty/loading states), then dashboard/profile/collection/wishlist/auth.

---

## ✅ Done this session
- Admin price override (`/admin/prices`) + audit; NM-only extractor + canonical dedup (committed; **edge fn needs Lovable redeploy = #4**)
- Graded: un-capped tiles RPC + graded override (table/RPCs/refresh + editor) — migration run
- Vintage 404 fix + variant-URL fix (`setSlug` strips virtual-variant suffix)
- Tier 1 Explore search (rarity/type/aliases) + `buyQueryForCard`
- Most Visited: 500 cap, restyle to match tables, views on own row + enlarged, `+` panel
- Panels (`RowActions`) wired into Market / Explore / SetDetail / **Sealed (list)** — `+` opens bottom-sheet/side-panel, plus-icon only, stays open after action
- Buy rows: brand logos + "Buy {brand}" CTA
- CC promo rainbow "· promoted" button
- Bottom-nav: modern icons (Blocks/Compass) + active-state polish
- Scroll-to-top on route change
- Sealed mobile header layout fix
- `card_stats` timestamp-column fix (Most Visited counting was silently dead)

## 🟠 Smaller / consistency
- [ ] **Sealed GRID view** (`SealedGridView`) — panel wired in list mode only; grid `+` not wired yet.
- [ ] **Bottom-nav / buy logos** — swap to nicer versions if desired (current ones fine).

## 🔴 Decision / data-gated
- [ ] **Most Visited 24h/7d/30d dropdown** — needs a `card_view_events` table (cumulative counter can't be windowed). User decision: build the event-log? (Windows fill from "now" forward; "All time" works immediately.)

## 🌐 Multi-TCG expansion (planning — 6/4+)
Goal: support TCGs beyond Pokémon-EN. Budget ≈ **7,500 credits/TCG/month** at a daily ping → **3–4 TCGs comfortably** on the current plan (with mistake headroom).

- **Launch order (user):** Pokémon EN (live) → **Pokémon JA → Gundam** → One Piece (+ Lorcana / Riftbound) → **MTG last** (100,724 cards — biggest, most work).
- ✅ **MTG IS on Scrydex** — slug is **`magicthegathering`** (not `magic`/`mtg`). Scrydex games (2026-06-04): `pokemon` (EN + `ja` lang), `magicthegathering`, `lorcana`, `onepiece`, `gundam`, `riftbound`.
- **Banked catalogs** (catalog-only, gzipped, in **gitignored** `/data-bank/`, never deployed): `pokemon-ja`, `gundam`, `onepiece`, `lorcana`, `riftbound` (27,745 cards). **MTG not banked** (save for last) — pull on demand: `SCRYDEX_GAMES="magicthegathering:en" python scripts/scrydex-tools/bank_catalogs.py`.
- **Work to actually ship a TCG:**
  - Generalize the pipeline — `sync-cards-catalog` + `snapshot-prices` are hardcoded `/pokemon/v1/en` + `language_code==='EN'`. Make **game + language** params.
  - Per-game **catalog** (`cards` needs a game/lang column, or per-game tables) + per-game **price** snapshot/latest tables.
  - **Frontend:** game/language switcher + per-game routes / sets / market.
  - Seed metadata from the banked catalogs (gunzip → import).

## ⚫ Deferred (by user)
- [ ] **SEO link previews** — Cloudflare Worker in front of Lovable (UA-prerender OG tags) + per-card OG image. Needs DNS move to Cloudflare. Google indexing/sitemaps already work.
- [ ] **Tier 2/3 search** (vintage finishes, "cosmos holo") — needs variant finish names stored in the pipeline.
- [ ] **verify-and-heal + write-time sanity gate** — robustness; a `verify-and-heal` fn file exists, state TBD.
