import fs from "fs";
import path from "path";

const BASE_URL = "https://api.pokemontcg.io/v2";
const DATA_DIR = path.join(process.cwd(), "public", "data", "sets"); // Reverted to sets

// API Key (from env)
const API_KEY = process.env.POKEMONTCG_API_KEY || "";

// Delay helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json"
  };
  if (API_KEY) headers["X-Api-Key"] = API_KEY;

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers });
      
      if (res.status === 429) {
        console.log(`Rate limited on ${url}, waiting before retry...`);
        await sleep(2000 * (i + 1));
        continue;
      }
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      
      return await res.json();
    } catch (err: any) {
      console.log(`Error fetching ${url}: ${err.message}`);
      if (i === retries - 1) throw err;
      await sleep(1000 * (i + 1));
    }
  }
}

async function downloadSetInteractively() {
  const targetSetNames = process.argv.slice(2);
  if (targetSetNames.length === 0) {
    console.error("Please provide at least one set name as an argument. Example: npx tsx scripts/download-sets.ts 'Base' '151'");
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  for (const targetSetName of targetSetNames) {
    console.log(`\n========================================`);
    console.log(`Searching for set containing "${targetSetName}"...`);
    const params = new URLSearchParams({ q: `name:"*${targetSetName}*"` });
    const setsRes = await fetchWithRetry(`${BASE_URL}/sets?${params}`);
    const sets = setsRes.data;

    if (sets.length === 0) {
      console.log(`No sets found matching "${targetSetName}". Skipping...`);
      continue;
    }

    const setObj = sets[0]; // pick the first match
    console.log(`Found set: ${setObj.name} (${setObj.id}) - Total Cards: ${setObj.total}`);
    
    const setFilePath = path.join(DATA_DIR, `${setObj.id}.json`);
    let allCards: any[] = [];
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      console.log(`  Fetching page ${page} for ${setObj.name}...`);
      const cardParams = new URLSearchParams({
        q: `set.id:"${setObj.id}"`,
        page: String(page),
        pageSize: "100"
      });
      const url = `${BASE_URL}/cards?${cardParams}`;
      
      const cardsData = await fetchWithRetry(url);
      allCards = allCards.concat(cardsData.data);
      
      const count = cardsData.count;
      const totalCount = cardsData.totalCount; 
      console.log(`    -> Retrieved ${count} cards (Total so far: ${allCards.length} / ${totalCount})`);
      
      fs.writeFileSync(setFilePath, JSON.stringify(allCards, null, 2));

      if (allCards.length >= totalCount || count === 0) {
        hasMorePages = false;
      } else {
        page++;
        // Wait to respect rate limits if needed, particularly without an API Key
        if (!API_KEY) {
           console.log('    -> Waiting to respect unauthenticated rate limit...');
           await sleep(2000); 
        } else {
           await sleep(200);
        }
      }
    }

    console.log(`[Success] Done! Saved ${allCards.length} cards for ${setObj.name} to ${setFilePath}.`);
  }
}

downloadSetInteractively().catch(console.error);
