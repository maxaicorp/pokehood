# Collectiblez — active fix list

Living checklist. Grouped so blocked/decision items don't stall shippable ones.

---

## ✅ Shipped 6/4 (this session)
- Graded tiles moved directly under the raw price (was buried at page bottom on mobile).
- Set pages default to **Card Number High→Low**.
- **Dashboard** link added to the profile avatar dropdown (mobile reachability).
- **Most Visited 24h/7d/30d dropdown** — built `card_view_events` log + `get_most_viewed_windowed` RPC + UI. ⚠️ **RUN migration `20260604140000_card_view_events.sql`** in the SQL editor (windows fill from then on; All-time works now).

## ✅ Artist filter (#3) — SHIPPED + live
Searchable **Artist** combobox on Explore only (Popover+Command typeahead, with per-artist counts). `artist` column added to `cards`, captured by `sync-cards-catalog` (v `2026-06-04-artist`), surfaced via `get_card_catalog` + new `get_card_artists()` RPC. **Live: 406 artists populated** after the migration + redeploy + resync (6/4). Filter auto-hides if the catalog has no artist data.

---

## ▶ RESUME HERE (6/4) — start at the top

### 1. 🔴 Search-bar freeze (TOP PRIORITY) — DIAGNOSED, fix needs a decision (see #2)
Explore first-load → main-thread block (9.9 MB `all-cards.json` parse + ~22k price-row seed).
- **Header bar is fine:** GlobalSearch uses the fast `search_catalog` RPC (deployed); it only falls back to the 9.9 MB client path if that RPC returns null. Freeze is the **Explore page** path (`searchCardsAdvanced → loadCardIndex`), which the artist filter also rides.
- **Why populating `cards` did NOT fix it:** `loadCardIndex` loads the static 9.9 MB file *first* (completeness floor), THEN checks the live table. The live catalog only takes over if `live.cards.length >= static count`. Static = **23,572** (incl. **3,003 TCG Pocket** cards the sync excludes); live = **17,805**. So the gate **never passes** → 9.9 MB always loads. The live-catalog path has, in effect, never engaged.
- **The real fix (gated on a decision, see #2):** make `loadCardIndex` try the live DB **first** and skip the 9.9 MB entirely. Blocker = the live `cards` table is not a superset of static (no Pocket; ~2.7k physical cards short), so switching now would DROP those cards. Must first make `cards` complete.

### 2. ✅ `cards` table sync writes 0 — RESOLVED (was duplicate ids, not schema)
Root cause was NOT a schema mismatch — it was **duplicate ids inside one upsert batch** ("ON CONFLICT cannot affect row a second time" rejected the whole batch). Fixed in `sync-cards-catalog` with an in-run `seen` Set + background `EdgeRuntime.waitUntil`. Table now holds **17,805 EN cards (99% with artist)**. Unblocked the artist filter.
- **➜ OPEN follow-up (unblocks #1 + the search freeze):** the live table is still **smaller than static** because the sync excludes Pocket/online-only (and is ~2.7k physical short). To let the live path engage and **drop the 9.9 MB file**, the `cards` table must become a superset of static. Decision for the user: (a) **include Pocket in the sync** (remove the `pokémon tcg pocket` skip in `sync-cards-catalog`) + resync, then loadCardIndex can go live-first; or (b) ship a small `pocket-cards.json` (~3k) and load only that + live, never the 9.9 MB. Either is another redeploy/resync.

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
