#!/usr/bin/env python3
"""
bank_catalogs.py — one-time pull of Scrydex card CATALOGS (metadata only, no
prices — prices go stale, metadata doesn't) for the non-Pokémon-EN games, saved
as local JSON for a future multi-TCG expansion. English Pokémon is skipped (it's
already in public/data/all-cards.json).

Usage:  SCRYDEX_KEY=xxxxx python bank_catalogs.py
Writes: data-bank/{game}-{lang}.json  (NOT under public/ — banked data must not
        ship to the live site; gzip the files after for the repo).
"""
import os, json, time, subprocess, pathlib

KEY = os.environ["SCRYDEX_KEY"]
TEAM = os.environ.get("SCRYDEX_TEAM", "collectiblez")

# (game, language). Confirmed live on Scrydex 2026-06-04.
GAMES = [
    ("lorcana", "en"),
    ("onepiece", "en"),
    ("gundam", "en"),
    ("riftbound", "en"),
    ("pokemon", "ja"),   # Japanese Pokémon
]

OUT = pathlib.Path("data-bank")
OUT.mkdir(parents=True, exist_ok=True)


def fetch(url):
    # Capture BYTES and decode UTF-8 ourselves — Windows' default cp1252 decode
    # crashes on Japanese/accented card data.
    out = subprocess.run(
        ["curl", "-s", url, "-H", f"X-Api-Key: {KEY}", "-H", f"X-Team-ID: {TEAM}"],
        capture_output=True, timeout=30,
    ).stdout
    return json.loads(out.decode("utf-8", "replace"))


def bank(game, lang):
    cards, page = [], 1
    while True:
        url = f"https://api.scrydex.com/{game}/v1/{lang}/cards?page={page}&page_size=100"
        try:
            d = fetch(url)
        except Exception as e:
            print(f"  {game}/{lang} page {page} ERROR: {e} — stopping this game")
            break
        batch = d.get("data") or []
        if not batch:
            break
        cards.extend(batch)
        total = d.get("total_count", 0)
        if page == 1 or page % 10 == 0 or len(batch) < 100:
            print(f"  {game}/{lang}: {len(cards)}/{total}")
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.1)
    fn = OUT / f"{game}-{lang}.json"
    json.dump(
        {"game": game, "language": lang, "count": len(cards),
         "fetched_at": time.strftime("%Y-%m-%d"), "cards": cards},
        open(fn, "w", encoding="utf-8"), ensure_ascii=False,
    )
    print(f"  -> {fn}  ({len(cards)} cards, {fn.stat().st_size // 1024} KB)\n")
    return len(cards)


def main():
    print(f"Banking {len(GAMES)} catalogs to {OUT}/\n")
    grand = 0
    for game, lang in GAMES:
        print(f"== {game}/{lang} ==")
        grand += bank(game, lang)
    print(f"DONE — {grand} cards banked across {len(GAMES)} datasets.")


if __name__ == "__main__":
    main()
