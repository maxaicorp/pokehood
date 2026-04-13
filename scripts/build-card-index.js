/**
 * Safely rebuilds /public/data/all-cards.json from legacy /public/data/sets/*.json
 * without destroying richer Scrydex-enriched card metadata already stored in
 * all-cards.json.
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

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function mergeSet(existing = {}, legacy = {}) {
  return {
    name: existing.name || legacy.name || "",
    logo: existing.logo || legacy.logo || "",
    symbol: existing.symbol || legacy.symbol || "",
    releaseDate: existing.releaseDate || legacy.releaseDate || "2000-01-01",
    series: existing.series || legacy.serie?.name || "Unknown",
    serieId: existing.serieId || legacy.serie?.id || "",
    isOnlineOnly: existing.isOnlineOnly ?? false,
    printedTotal: Math.max(existing.printedTotal ?? 0, legacy.cardCount?.official ?? 0),
    total: Math.max(existing.total ?? 0, legacy.cardCount?.total ?? 0),
  };
}

function mergeCard(existing, legacy, setId) {
  return {
    id: legacy.id,
    name: legacy.name || existing?.name || "",
    image: legacy.image || existing?.image,
    localId: legacy.localId || existing?.localId || "",
    setId,
    ...existing,
    id: existing?.id || legacy.id,
    name: existing?.name || legacy.name || "",
    localId: existing?.localId || legacy.localId || "",
    setId: existing?.setId || setId,
  };
}

const setFiles = fs.readdirSync(SETS_DIR).filter((f) => f.endsWith(".json"));
const existingIndex = readJson(OUT_FILE, { sets: {}, cards: [] });
const existingSets = existingIndex.sets ?? {};
const existingCardsById = new Map((existingIndex.cards ?? []).map((card) => [card.id, card]));

const sets = {};
const cards = [];
const seenCardIds = new Set();
const hasRichIndex = (existingIndex.cards ?? []).some((card) => card?.imageSmall || card?.imageLarge);

for (const file of setFiles) {
  const setData = readJson(path.join(SETS_DIR, file), {});
  const setId = setData.id;
  if (!setId) continue;

  sets[setId] = mergeSet(existingSets[setId], setData);

  for (const legacyCard of setData.cards || []) {
    if (!legacyCard?.id || seenCardIds.has(legacyCard.id)) continue;

    const existingCard = existingCardsById.get(legacyCard.id);
    if (hasRichIndex && !existingCard) continue;

    seenCardIds.add(legacyCard.id);
    cards.push(mergeCard(existingCard, legacyCard, setId));
  }
}

for (const [setId, setMeta] of Object.entries(existingSets)) {
  if (!sets[setId]) sets[setId] = setMeta;
}

for (const existingCard of existingIndex.cards ?? []) {
  if (!existingCard?.id || seenCardIds.has(existingCard.id)) continue;
  seenCardIds.add(existingCard.id);
  cards.push(existingCard);
}

const output = { sets, cards };
fs.writeFileSync(OUT_FILE, JSON.stringify(output));

const sizeKB = Math.round(fs.statSync(OUT_FILE).size / 1024);
console.log(`✓ Built all-cards.json safely`);
console.log(`  ${Object.keys(sets).length} sets, ${cards.length} cards`);
console.log(`  Preserved rich Scrydex metadata for existing cards when available`);
console.log(`  File size: ${sizeKB} KB uncompressed`);
