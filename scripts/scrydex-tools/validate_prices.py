#!/usr/bin/env python3
"""
validate_prices.py — compare the site's stored prices against LIVE Scrydex,
flag the wrong ones, and emit ready-to-run override SQL.

WHY: the deployed snapshot cron occasionally writes a wrong price (a played-grade
fallback, a stale value, or a padded-twin clobber). This tool pulls the true
NM-raw-USD market + Scrydex's own 1d/7d/30d trend deltas for each card and shows
exactly which stored rows are off, so you can pin the bad ones via the override
table (see card_price_overrides / admin_set_card_price).

USAGE
  1. In the Supabase SQL editor, run one of the dump_*.sql files in this folder.
  2. Save the result grid (incl. the header row) to a text file, e.g. stored.txt.
  3. Run:
        SCRYDEX_KEY=xxxxx python validate_prices.py stored.txt
     (team defaults to "collectiblez"; override with SCRYDEX_TEAM=...)
     (flag threshold defaults to 3%; override with THRESHOLD=5)

  The script auto-detects column order from the header row, so it works with
  whatever order the SQL editor prints (card_id / price / price_1d / price_7d /
  price_30d, in any arrangement). NULL cells are fine.

SECURITY: the API key is read from the environment only — never hard-code it
here or commit it. Rotate the key in the Scrydex dashboard after a session.

OUTPUT: a per-card diff table, then an INSERT ... ON CONFLICT block for the
flagged cards (price + Scrydex-derived deltas) ending in a refresh call.
"""
import os, sys, json, time, subprocess

KEY = os.environ.get("SCRYDEX_KEY")
TEAM = os.environ.get("SCRYDEX_TEAM", "collectiblez")
THRESHOLD = float(os.environ.get("THRESHOLD", "3"))

if not KEY:
    sys.exit("Set SCRYDEX_KEY env var (and optionally SCRYDEX_TEAM).")
if len(sys.argv) < 2:
    sys.exit("Usage: SCRYDEX_KEY=xxx python validate_prices.py <stored.txt>")

PRIORITY = ["normal", "holofoil", "reverseHolofoil"]


def num(s):
    s = s.strip()
    return None if s.upper() == "NULL" or s == "" else float(s)


def parse_file(path):
    """Return list of dicts {card_id, price, price_1d, price_7d, price_30d}.
    Detects column positions from a header line containing 'card_id'."""
    lines = [l for l in open(path, encoding="utf-8").read().splitlines() if l.strip()]
    colmap = None
    rows = []
    for l in lines:
        parts = l.split()
        if "card_id" in parts:  # header row (may repeat across paged output)
            colmap = {name: i for i, name in enumerate(parts)}
            continue
        if colmap is None:
            # No header seen yet — assume canonical order.
            colmap = {"card_id": 0, "price": 1, "price_1d": 2, "price_30d": 3, "price_7d": 4}
        def get(name):
            i = colmap.get(name)
            return parts[i] if i is not None and i < len(parts) else "NULL"
        try:
            rows.append({
                "card_id": get("card_id"),
                "price": num(get("price")),
                "price_1d": num(get("price_1d")),
                "price_7d": num(get("price_7d")),
                "price_30d": num(get("price_30d")),
            })
        except (ValueError, IndexError):
            continue  # junk / mis-split line
    return rows


cache = {}
def fetch(base):
    if base in cache:
        return cache[base]
    url = f"https://api.scrydex.com/pokemon/v1/cards/{base}?include=prices"
    try:
        out = subprocess.run(
            ["curl", "-s", url, "-H", f"X-Api-Key: {KEY}", "-H", f"X-Team-ID: {TEAM}"],
            capture_output=True, text=True, timeout=25,
        ).stdout
        d = json.loads(out).get("data")
    except Exception as e:
        d = {"_err": str(e)}
    cache[base] = d
    time.sleep(0.1)
    return d


def nm_entry(variant):
    for pr in variant.get("prices", []):
        if (pr.get("type") == "raw" and pr.get("condition") == "NM"
                and pr.get("currency") == "USD" and pr.get("market", 0) > 0):
            return pr
    return None


def pick(card, want):
    vs = card.get("variants", [])
    if want:
        for v in vs:
            if v.get("name") == want:
                return v.get("name"), nm_entry(v)
        return want, None
    ordered = sorted(vs, key=lambda v: PRIORITY.index(v["name"]) if v.get("name") in PRIORITY else 99)
    for v in ordered:
        e = nm_entry(v)
        if e:
            return v.get("name"), e
    return None, None


def back(market, trends, key):
    c = trends.get(key, {}).get("price_change")
    return round(market - c, 2) if c is not None else None


def main():
    rows = parse_file(sys.argv[1])
    print(f"Validating {len(rows)} cards against Scrydex (threshold {THRESHOLD}%)\n")
    print(f"{'card_id':18} {'stored':>9} {'scrydex':>9} {'diff%':>7}  flag")
    print("-" * 62)
    flagged = []
    for r in rows:
        cid = r["card_id"]
        base, _, want = cid.partition("::")
        card = fetch(base)
        if not card or card.get("_err"):
            print(f"{cid:18} {str(r['price']):>9} {'ERR':>9}")
            continue
        vname, e = pick(card, want or None)
        name = card.get("name", "")
        setn = card.get("expansion", {}).get("name", "")
        if not e:
            print(f"{cid:18} {str(r['price']):>9} {'no NM':>9}        <== no NM raw USD")
            continue
        m = e["market"]; t = e.get("trends", {})
        s1, s7, s30 = back(m, t, "days_1"), back(m, t, "days_7"), back(m, t, "days_30")
        price = r["price"]
        diff = (price - m) / m * 100 if price else None
        flag = ""
        if diff is None or abs(diff) > THRESHOLD:
            flag = "  <== OFF"
            flagged.append((cid, m, s1, s7, s30, name, setn))
        ds = ("%+.1f" % diff) if diff is not None else "n/a"
        ps = ("%.2f" % price) if price else "NULL"
        print(f"{cid:18} {ps:>9} {m:>9.2f} {ds:>7}{flag}")

    print(f"\n\n===== {len(flagged)} flagged (>{THRESHOLD}% off) — OVERRIDE SQL =====\n")
    if not flagged:
        print("-- none")
        return
    q = lambda s: s.replace("'", "''")
    sv = lambda v: "NULL" if v is None else f"{v}"
    print("INSERT INTO public.card_price_overrides")
    print("  (card_id, price, price_1d, price_7d, price_30d, card_name, set_name, note, set_at)")
    print("VALUES")
    print(",\n".join(
        f"  ('{cid}', {m}, {sv(s1)}, {sv(s7)}, {sv(s30)}, '{q(n)}', '{q(sn)}', 'Scrydex NM sync', now())"
        for cid, m, s1, s7, s30, n, sn in flagged
    ))
    print("""ON CONFLICT (card_id) DO UPDATE SET
  price=EXCLUDED.price, price_1d=EXCLUDED.price_1d, price_7d=EXCLUDED.price_7d,
  price_30d=EXCLUDED.price_30d, card_name=EXCLUDED.card_name, set_name=EXCLUDED.set_name,
  note=EXCLUDED.note, set_at=now();
SELECT public.refresh_latest_card_prices();""")


if __name__ == "__main__":
    main()
