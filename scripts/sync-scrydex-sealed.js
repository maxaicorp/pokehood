/**
 * sync-scrydex-sealed.js
 *
 * Fetches all sealed products from Scrydex (with prices) and saves to
 * public/data/sealed-products.json so the app never hits the API per user visit.
 *
 * CREDIT COST: ~20 credits (1,947 products ÷ 100 per page = ~20 requests)
 * Re-run daily to refresh prices.
 *
 * Run: node scripts/sync-scrydex-sealed.js
 */

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://cmthndfrvnlyfxgxqjkm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdGhuZGZydm5seWZ4Z3hxamttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjIxMjMsImV4cCI6MjA4ODM5ODEyM30.gHbRuBR4oU4yx69ZLP5HiToFL6k2oGgWCWSw27lQCMU";

const PAGE_SIZE = 100;
const DELAY_MS = 100;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function proxyFetch(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/scrydex-proxy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint }),
  });
  const json = await res.json();
  if (!json || json.status !== 200)
    throw new Error(`Proxy error (${json?.status}): ${JSON.stringify(json?.data)}`);
  return json.data;
}

async function main() {
  // Credit check
  console.log("🔍 Checking credit balance...");
  const usage = await proxyFetch("/account/v1/usage");
  console.log(`   Credits remaining: ${usage.data?.credits_remaining}\n`);

  console.log("🔄 Fetching sealed products from Scrydex...\n");

  const products = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await proxyFetch(
      `/pokemon/v1/sealed?page=${page}&page_size=${PAGE_SIZE}&include=prices&orderBy=-expansion.release_date`
    );

    if (page === 1) {
      const total = data.total_count ?? 0;
      totalPages = Math.ceil(total / PAGE_SIZE);
      console.log(`📦 ${total.toLocaleString()} sealed products across ${totalPages} pages\n`);
    }

    for (const p of data.data ?? []) {
      // English only — treat missing language_code as non-English (strict)
      if (p.expansion?.language_code !== "EN") continue;
      // Skip "Case" wholesale products
      if (p.name?.toLowerCase().includes("case")) continue;
      // Skip products with no price at all
      const hasPrice = p.variants?.some((v) =>
        v.prices?.some((pr) => pr.market > 0 || pr.low > 0)
      );
      if (!hasPrice) continue;

      const img = p.images?.[0] ?? {};
      products.push({
        id: p.id,
        name: p.name,
        type: p.type ?? "",
        description: p.description ?? "",
        imageSmall: img.small ?? "",
        imageMedium: img.medium ?? "",
        expansionId: p.expansion?.id ?? "",
        expansionName: p.expansion?.name ?? "",
        expansionSeries: p.expansion?.series ?? "",
        expansionReleaseDate: (p.expansion?.release_date ?? "").replace(/\//g, "-"),
        expansionLogo: p.expansion?.logo ?? "",
        variants: p.variants ?? [],
      });
    }

    process.stdout.write(
      `\r  Page ${page}/${totalPages} — ${products.length.toLocaleString()} products kept`
    );

    page++;
    if (page <= totalPages) await sleep(DELAY_MS);
  } while (page <= totalPages);

  console.log("\n\n✅ All pages fetched.\n");

  // Write file
  const output = {
    syncedAt: new Date().toISOString(),
    totalProducts: products.length,
    products,
  };

  const outPath = join(__dirname, "../public/data/sealed-products.json");
  writeFileSync(outPath, JSON.stringify(output));

  const sizeMB = (JSON.stringify(output).length / 1024 / 1024).toFixed(2);

  // Final credit check
  const after = await proxyFetch("/account/v1/usage");

  console.log(`📁 Wrote public/data/sealed-products.json`);
  console.log(`   Products: ${products.length.toLocaleString()}`);
  console.log(`   File size: ${sizeMB}MB`);
  console.log(`   Credits remaining: ${after.data?.credits_remaining}`);
  console.log(`\n🎉 Done! Commit and push to deploy.`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
