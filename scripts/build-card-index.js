/**
 * Merges all /public/data/sets/*.json files into a single
 * /public/data/all-cards.json for fast single-request loading.
 *
 * Run with: node scripts/build-card-index.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, "../public/data");
const SETS_DIR = path.join(DATA_DIR, "sets");
const OUT_FILE = path.join(DATA_DIR, "all-cards.json");

const setFiles = fs.readdirSync(SETS_DIR).filter((f) => f.endsWith(".json"));

const sets = {};
const cards = [];

for (const file of setFiles) {
  const setData = JSON.parse(fs.readFileSync(path.join(SETS_DIR, file), "utf8"));

  const setId = setData.id;
  if (!setId) continue;

  // Store set metadata once
  sets[setId] = {
    name: setData.name,
    logo: setData.logo || "",
    symbol: setData.symbol || "",
    releaseDate: setData.releaseDate || "2000-01-01",
    series: setData.serie?.name || "Unknown",
    serieId: setData.serie?.id || "",
    printedTotal: setData.cardCount?.official || 0,
    total: setData.cardCount?.total || 0,
  };

  // Store each card with just its setId as a reference
  for (const card of setData.cards || []) {
    cards.push({
      id: card.id,
      name: card.name,
      image: card.image,
      localId: card.localId,
      setId,
    });
  }
}

const output = { sets, cards };
fs.writeFileSync(OUT_FILE, JSON.stringify(output));

const sizeKB = Math.round(fs.statSync(OUT_FILE).size / 1024);
console.log(`✓ Built all-cards.json`);
console.log(`  ${Object.keys(sets).length} sets, ${cards.length} cards`);
console.log(`  File size: ${sizeKB} KB uncompressed`);
