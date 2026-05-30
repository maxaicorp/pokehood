/**
 * Split the monolithic all-cards.json (~10 MB) into per-set files so the
 * set-scoped pages (card detail, set detail, set-filtered explore) load only
 * the ~50-200 KB they actually need instead of the whole catalog.
 *
 *   node scripts/split-cards-by-set.js
 *
 * Reads  public/data/all-cards.json   ({ sets: {...}, cards: [...] })
 * Writes public/data/cards/<setId>.json  ({ set: {...}, cards: [...] })
 *
 * Run this whenever all-cards.json is rebuilt (add it after build-card-index).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "public", "data");
const OUT = path.join(DATA, "cards");

const index = JSON.parse(fs.readFileSync(path.join(DATA, "all-cards.json"), "utf8"));
const sets = index.sets || {};
const cards = index.cards || [];

fs.mkdirSync(OUT, { recursive: true });

// Group cards by setId
const bySet = new Map();
for (const c of cards) {
  if (!c.setId) continue;
  if (!bySet.has(c.setId)) bySet.set(c.setId, []);
  bySet.get(c.setId).push(c);
}

let written = 0;
for (const [setId, setCards] of bySet) {
  const file = path.join(OUT, `${setId}.json`);
  fs.writeFileSync(file, JSON.stringify({ set: { id: setId, ...(sets[setId] || {}) }, cards: setCards }));
  written++;
}

console.log(`Split ${cards.length} cards across ${written} set files in public/data/cards/`);
