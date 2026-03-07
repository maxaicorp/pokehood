import fs from "fs";
import path from "path";

const BASE_URL = "https://api.tcgdex.net/v2/en";
const DATA_DIR = path.join(process.cwd(), "public", "data", "sets");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "PokeVault/1.0",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Step 1: Fetch all sets
  console.log("Fetching all available sets from TCGdex...");
  const sets: any[] = await fetchJSON(`${BASE_URL}/sets`);
  console.log(`Found ${sets.length} sets!\n`);

  // Save master set list
  fs.writeFileSync(
    path.join(process.cwd(), "public", "data", "sets-list.json"),
    JSON.stringify(sets, null, 2)
  );

  // Step 2: Download each set's cards
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const set of sets) {
    const setFilePath = path.join(DATA_DIR, `${set.id}.json`);

    // Skip if already downloaded
    if (fs.existsSync(setFilePath)) {
      skipped++;
      continue;
    }

    try {
      const setData = await fetchJSON(`${BASE_URL}/sets/${set.id}`);
      const cards = setData.cards || [];
      fs.writeFileSync(setFilePath, JSON.stringify({ ...setData, cards }, null, 2));
      downloaded++;
      console.log(`[${downloaded}/${sets.length}] ${set.name} — ${cards.length} cards`);

      // Small delay to be respectful
      await sleep(100);
    } catch (err: any) {
      failed++;
      console.log(`[FAIL] ${set.name}: ${err.message}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`Done! Downloaded: ${downloaded} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`Total sets available: ${sets.length}`);
}

main().catch(console.error);
