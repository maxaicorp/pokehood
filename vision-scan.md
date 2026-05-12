# Vision Scan — Mobile Card Scanner

**Status**: Design doc. Not started.
**Target**: Pro-tier feature. Free tier gets a small monthly quota as a teaser.
**Platform**: Mobile-only (phone camera). Hidden on desktop.
**Effort estimate**: 2–3 days of focused work to MVP.

---

## Why mobile-only

Card scanning is inherently a "I have the physical card in my hand right now" flow. That's a phone. Desktop users with a webcam are <1% of the use case, and webcam-from-laptop produces blurry top-down shots that ruin recognition accuracy. Skipping desktop:

- Cuts UI scope in half
- Avoids the worst recognition cases
- Lets us use the mobile-only `<input type="file" accept="image/*" capture="environment">` flow, which on iOS/Android opens the camera directly with no app permission dialog beyond what the browser already handles
- Means we don't have to think about webcam streaming, getUserMedia permissions, or video frame capture

Detection: use `useIsMobile` hook (already in `src/hooks/`) to hide the scan button on desktop entirely. Add a small "📱 Available on mobile" hint where the button would have lived.

---

## Architecture

```
Phone camera capture
        ↓
   <img file>
        ↓
   POST to scan-card edge function
        ↓
   Claude/Gemini vision API
        ↓
   { name, setName, number, variant, confidence }
        ↓
   Match against all-cards.json on client
        ↓
   Confirm UI — user accepts or corrects
        ↓
   addToCollection(card, condition, quantity)
```

### Pieces

| Component | Where | Responsibility |
|---|---|---|
| Scan button | New floating action button on `/dashboard` Collection tab (mobile only) | Triggers file picker with `capture="environment"` |
| `<ScanReviewSheet>` | New component, mobile drawer | Shows preview, parsed result, accept/edit/reject |
| `scan-card` edge function | New `supabase/functions/scan-card/` | Auth check, tier-quota check, vision API call, returns structured card data |
| `scan_usage` table | New migration | Tracks `(user_id, year_month, count)` for tier quotas |
| Match logic | Client (`src/lib/scan-match.ts`) | Fuzzy-match vision output against `all-cards.json` to get canonical Scrydex ID |

---

## Vision API choice

**Recommendation: Claude Haiku 4.5 vision via Anthropic API.**

Why:
- ~$0.001 per typical card image input (1024×1024 at standard tier) — cheapest of the major vision models
- Fast (1–2s) — good for "scan & confirm" UX flow
- Trained on enough Pokemon card data to handle modern + vintage with one prompt
- Structured output via tool use → no JSON parsing headaches

Alternative if Haiku accuracy is rough: upgrade to Sonnet 4.6 (~$0.005/image, near-perfect identification).

**Don't use OCR-only** at this scale. Pokemon cards have stylized fonts, foil glare, and set symbols that need visual understanding. Pure OCR (Google Vision, Tesseract) fails on Mega/SIR/full-art cards where the name might be small or stylized.

---

## Prompt sketch

```
You are identifying a Pokémon TCG card from a photo.

Return JSON in this exact shape:
{
  "name": "<card name, including any 'ex'/'V'/'VMAX' suffix>",
  "setName": "<expansion name, e.g. 'Ascended Heroes'>",
  "number": "<collector number, e.g. '225/217' or just '225'>",
  "variant": "<one of: normal, holofoil, reverseHolofoil, 1stEdition, unlimited>",
  "supertype": "<Pokémon | Trainer | Energy>",
  "confidence": <0.0 to 1.0>
}

If the photo is too blurry, glared, or partially obscured to identify the
card with > 0.6 confidence, return {"confidence": 0.0} with empty strings.

Look at: card name (top of card), set symbol (bottom right of art), and
collector number (bottom of card). The set symbol is the most reliable
indicator — names repeat across sets (e.g. multiple "Charizard ex" cards).
```

Use Claude's tool-use mode with a typed schema instead of asking for raw JSON — eliminates parsing failures.

---

## Match logic

The vision model returns text like `"setName: 'Ascended Heroes', number: '225'"`. We need to convert that to a canonical `id` like `me2pt5-225`.

Algorithm:

1. **Exact set name match**: lowercase compare against `all-cards.json` `sets[*].name`. Hit → use that `setId`.
2. **Fuzzy set name fallback**: Levenshtein distance ≤ 3, or substring match. Hit → use that.
3. **Number match**: filter cards in that set by `localId === number` (strip `/total` suffix).
4. **Name verification**: if filter returns multiple cards (rare — variant rows), prefer name match.
5. **Confidence threshold**: if no exact or close match, surface to user with "We couldn't auto-identify this card — pick from these candidates" + 5 closest matches.

Critical UX rule: **never auto-add without user confirmation.** Always show the matched card in a sheet, let user accept/correct/cancel. Vision LLMs hallucinate. A wrong card added silently breaks user trust.

---

## Tier model

| Tier | Scans / month | Notes |
|---|---|---|
| Free | 5 | Teaser. Enough to try, not enough to load a full binder. |
| Pro | 500 | Soft limit, hard limit on per-day basis (say 200/day) to bound abuse. |

500 scans × $0.001 = $0.50/user/month cost on Pro at $20/yr (~$1.67/mo). Margin is fine.

Hard daily cap is critical — without it a malicious or buggy user can spam the API and burn $50 of credits overnight.

---

## Database

New migration:

```sql
CREATE TABLE IF NOT EXISTS public.scan_usage (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year_month   TEXT NOT NULL,  -- '2026-05'
  scan_count   INT  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year_month)
);

ALTER TABLE public.scan_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own usage" ON public.scan_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Only the edge function (service role) writes.
```

Edge function uses service role to upsert + check before calling the vision API.

---

## Build order (2–3 days)

### Day 1 — Backend + plumbing
- [ ] Migration: `scan_usage` table + RLS
- [ ] Edge function `scan-card`:
  - [ ] Auth check
  - [ ] Tier-aware quota check (read user's `is_pro` from `subscribers` table)
  - [ ] Anthropic API call with image + structured-output tool
  - [ ] Increment `scan_usage`
  - [ ] Return parsed result
- [ ] Secret: `ANTHROPIC_API_KEY` added to Supabase
- [ ] `src/lib/scan-match.ts` — match-against-`all-cards.json` logic + tests

### Day 2 — UI
- [ ] Floating "Scan Card" FAB on Dashboard Collection tab, mobile-only
- [ ] `<ScanReviewSheet>` Drawer component:
  - [ ] Image preview
  - [ ] Identified card display
  - [ ] Confidence indicator
  - [ ] "Looks right? Add to collection" + "Pick a different match" + "Cancel"
  - [ ] Condition selector (default NM)
  - [ ] Quantity stepper
- [ ] Wire to `addToCollection`
- [ ] Loading / error states

### Day 3 — Polish + ship
- [ ] Tier limit UI ("3 / 5 scans left this month, upgrade for 500")
- [ ] Bad-photo error handling (glare, blur, no card detected)
- [ ] Multi-candidate picker for low-confidence matches
- [ ] Track usage in Analytics tab
- [ ] Test on a real iPhone + Android device

---

## Things that will trip us up

1. **Holo glare** — foil cards reflect light. Tell users to angle the camera; detect glare client-side via brightness check and prompt re-shoot before sending to API (saves credits).
2. **Variant ambiguity** — distinguishing regular vs reverse holo vs 1st edition from a single photo is genuinely hard. The confirm UI must let users override the variant easily.
3. **Sleeves / penny sleeves** — many collectors photograph cards in sleeves. Test that the model handles it.
4. **Vertical vs horizontal cards** — Pokemon cards are vertical 99% of the time but the camera UI shouldn't force orientation.
5. **Cost runaway** — without daily cap, one user could burn $50/day. Hard cap at 200 scans/day per user.
6. **Set symbol vs printed total** — Scrydex uses set IDs like `me2pt5`, the printed card just shows a symbol. Vision model returns the human-readable set name; we map to ID via `all-cards.json`. If the set name is wrong, the match fails. Confidence threshold + multi-candidate fallback handles this.
7. **Newly-released sets** — if a set drops the day before someone scans a card from it, the model won't recognize it. Acceptable failure; user can manually search.

---

## Future enhancements (not MVP)

- **Batch mode**: photo of multiple cards laid out → segment → identify each
- **Video stream mode**: hold the camera over cards in sequence; auto-capture on confidence threshold
- **Trade verification**: scan two cards and a price diff → suggest a fair trade
- **Condition assessment**: use vision to grade NM / LP / MP / HP / DMG automatically
- **Card-back scanning**: harder but useful for fakes detection

These all sit on top of the same scan-card primitive.
