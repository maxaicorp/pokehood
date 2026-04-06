/**
 * sync-scrydex-cards.js
 *
 * Fetches all English card metadata from Scrydex and rebuilds
 * public/data/all-cards.json with Scrydex IDs, names, and image URLs.
 *
 * CREDIT COST: ~1 credit per page × 235 pages = ~235 credits (one-time)
 * Prices are NOT fetched here — they come from the price_snapshots table
 * which is kept fresh by the snapshot-prices edge function.
 *
 * Run: node scripts/sync-scrydex-cards.js
 */

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://cmthndfrvnlyfxgxqjkm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdGhuZGZydm5seWZ4Z3hxamttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjIxMjMsImV4cCI6MjA4ODM5ODEyM30.gHbRuBR4oU4yx69ZLP5HiToFL6k2oGgWCWSw27lQCMU";

const PAGE_SIZE = 100;
const DELAY_MS = 100; // 100ms between pages → ~10 req/sec, well under 100/sec limit

// ─── Proxy helper ─────────────────────────────────────────────────────────────

async function proxyFetch(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/scrydex-proxy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (!json || json.status !== 200) {
    throw new Error(`Proxy error (status ${json?.status}): ${JSON.stringify(json?.data)}`);
  }
  return json.data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Step 0: Check credit balance before doing anything
  console.log("🔍 Checking Scrydex credit balance...");
  const usage = await proxyFetch("/account/v1/usage");
  const remaining = usage.data?.credits_remaining ?? "?";
  const consumed = usage.data?.total_credits_consumed ?? "?";
  console.log(`   Credits used this period: ${consumed}`);
  console.log(`   Credits remaining:        ${remaining}`);

  // Estimate cost: totalCards / PAGE_SIZE pages, rounded up
  // We'll know exact total after page 1, but ~235 is a safe estimate
  const estimatedCost = 240;
  if (typeof remaining === "number" && remaining < estimatedCost) {
    console.error(`\n❌ Not enough credits. Need ~${estimatedCost}, have ${remaining}. Aborting.`);
    process.exit(1);
  }
  console.log(`   Estimated cost: ~${estimatedCost} credits (1 per page, no price data)\n`);

  // Step 1: Fetch all card metadata (no prices — saves credits)
  console.log("🔄 Fetching card metadata from Scrydex...\n");

  const sets = {};
  const cards = [];

  let page = 1;
  let totalPages = 1;

  do {
    const data = await proxyFetch(
      `/pokemon/v1/en/cards?page=${page}&page_size=${PAGE_SIZE}&orderBy=-expansion.release_date`
    );

    if (page === 1) {
      const totalCount = data.total_count ?? 0;
      totalPages = Math.ceil(totalCount / PAGE_SIZE);
      console.log(`📦 ${totalCount.toLocaleString()} cards across ${totalPages} pages (~${totalPages} credits)\n`);
    }

    for (const card of data.data ?? []) {
      const exp = card.expansion ?? {};

      // Build sets map (keyed by Scrydex expansion ID)
      if (!sets[exp.id]) {
        sets[exp.id] = {
          name: exp.name ?? "",
          logo: exp.logo ?? "",
          symbol: exp.symbol ?? "",
          releaseDate: (exp.release_date ?? "").replace(/\//g, "-"),
          series: exp.series ?? "",
          // Scrydex marks Mega Evolution as online-only, but it's a physical TCG product
          isOnlineOnly: (exp.series ?? "").toLowerCase() === "mega evolution"
            ? false
            : (exp.is_online_only ?? false),
          printedTotal: exp.printed_total ?? exp.total ?? 0,
          total: exp.total ?? 0,
        };
      }

      // Card entry — store full Scrydex image URLs directly
      const img = card.images?.[0] ?? {};
      cards.push({
        id: card.id,
        name: card.name ?? "",
        imageSmall: img.small ?? "",
        imageLarge: img.large ?? "",
        localId: card.number ?? "",
        setId: exp.id ?? "",
        rarity: card.rarity ?? "",
        supertype: card.supertype ?? "Pokémon",
        subtypes: card.subtypes ?? [],
        types: card.types ?? [],
        hp: card.hp ?? null,
      });
    }

    const pct = ((page / totalPages) * 100).toFixed(1);
    process.stdout.write(
      `\r  Page ${page}/${totalPages} (${pct}%) — ${cards.length.toLocaleString()} cards, ${Object.keys(sets).length} sets`
    );

    page++;
    if (page <= totalPages) await sleep(DELAY_MS);
  } while (page <= totalPages);

  console.log("\n\n✅ All pages fetched.\n");

  // Step 2: Write all-cards.json
  const output = { sets, cards };
  const outPath = join(__dirname, "../public/data/all-cards.json");
  writeFileSync(outPath, JSON.stringify(output));

  // Check final credit usage
  const usageAfter = await proxyFetch("/account/v1/usage");
  const remainingAfter = usageAfter.data?.credits_remaining ?? "?";

  console.log(`📁 Wrote public/data/all-cards.json`);
  console.log(`   Cards:  ${cards.length.toLocaleString()}`);
  console.log(`   Sets:   ${Object.keys(sets).length}`);
  console.log(`\n💳 Credits remaining: ${remainingAfter}`);
  console.log(`\n🎉 Done! Restart the dev server to pick up the new data.`);
  console.log(`\n⚠️  Note: The Market page needs price_snapshots to be refreshed`);
  console.log(`   with Scrydex card IDs. Run: node scripts/sync-scrydex-prices.js`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
