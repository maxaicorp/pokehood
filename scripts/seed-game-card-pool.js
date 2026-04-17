/**
 * Seed game_card_pool with ~300 cards that have good art.
 *
 * Usage:
 *   node scripts/seed-game-card-pool.js
 *
 * Requires env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const TARGET_COUNT = 300;

// Rarities that typically have nicer art
const GOOD_RARITIES = new Set([
  "Rare",
  "Rare Holo",
  "Rare Holo EX",
  "Rare Holo GX",
  "Rare Holo V",
  "Rare Holo VMAX",
  "Rare Holo VSTAR",
  "Rare Ultra",
  "Rare Secret",
  "Rare Rainbow",
  "Rare Shiny",
  "Rare Shiny GX",
  "Illustration Rare",
  "Special Illustration Rare",
  "Hyper Rare",
  "Ultra Rare",
  "Amazing Rare",
  "Radiant Rare",
]);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const cardsPath = path.join(__dirname, "..", "public", "data", "all-cards.json");
  const json = JSON.parse(fs.readFileSync(cardsPath, "utf8"));
  const cards = Array.isArray(json) ? json : json.cards || json.data || [];
  console.log(`Loaded ${cards.length} cards from all-cards.json`);

  const eligible = cards.filter(
    (c) =>
      c.id &&
      c.name &&
      c.images?.small &&
      GOOD_RARITIES.has(c.rarity)
  );
  console.log(`${eligible.length} cards match good-rarity filter`);

  const pool = shuffle([...eligible])
    .slice(0, TARGET_COUNT)
    .map((c) => ({
      card_id: c.id,
      name: c.name,
      image_small: c.images.small,
    }));
  console.log(`Seeding ${pool.length} cards`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Truncate first (optional; upsert also works)
  await supabase.from("game_card_pool").delete().neq("card_id", "__never__");

  // Insert in batches of 100
  for (let i = 0; i < pool.length; i += 100) {
    const batch = pool.slice(i, i + 100);
    const { error } = await supabase.from("game_card_pool").upsert(batch);
    if (error) {
      console.error("Insert error:", error);
      process.exit(1);
    }
    console.log(`Inserted ${i + batch.length}/${pool.length}`);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
