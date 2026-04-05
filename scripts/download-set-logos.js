/**
 * download-set-logos.js
 *
 * Downloads all English set logos from Scrydex CDN into public/data/logos/.
 * Images are fetched directly from images.scrydex.com — NO API credits used.
 * The scrydex-proxy is only called once to get the expansion list (1 credit).
 *
 * Run: node scripts/download-set-logos.js
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = join(__dirname, "../public/data/logos");

const SUPABASE_URL = "https://cmthndfrvnlyfxgxqjkm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdGhuZGZydm5seWZ4Z3hxamttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjIxMjMsImV4cCI6MjA4ODM5ODEyM30.gHbRuBR4oU4yx69ZLP5HiToFL6k2oGgWCWSw27lQCMU";

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
  if (!json || json.status !== 200) throw new Error(`Proxy error: ${json?.status}`);
  return json.data;
}

async function main() {
  mkdirSync(LOGOS_DIR, { recursive: true });

  // 1. Get all English expansions (1 credit)
  console.log("📋 Fetching expansion list from Scrydex (1 credit)...");
  const PAGE_SIZE = 100;
  const first = await proxyFetch(`/pokemon/v1/en/expansions?page=1&page_size=${PAGE_SIZE}`);
  const total = first.total_count ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  let expansions = first.data ?? [];
  for (let p = 2; p <= pages; p++) {
    const r = await proxyFetch(`/pokemon/v1/en/expansions?page=${p}&page_size=${PAGE_SIZE}`);
    expansions = [...expansions, ...(r.data ?? [])];
  }

  // Filter to sets that have logos (exclude online-only)
  const withLogos = expansions.filter((e) => e.logo && !e.is_online_only);
  console.log(`   Found ${expansions.length} expansions, ${withLogos.length} with logos\n`);

  // 2. Download each logo (0 credits — direct CDN fetch)
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < withLogos.length; i++) {
    const exp = withLogos[i];
    // Detect extension from URL, fallback to .png
    const ext = extname(exp.logo) || ".png";
    const localPath = join(LOGOS_DIR, `${exp.id}${ext}`);

    // Skip if already exists
    if (existsSync(localPath)) {
      skipped++;
      process.stdout.write(`\r  [${i + 1}/${withLogos.length}] Skipped ${exp.name} (exists)`);
      continue;
    }

    try {
      const res = await fetch(exp.logo);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(localPath, buf);
      downloaded++;
      process.stdout.write(`\r  [${i + 1}/${withLogos.length}] Downloaded ${exp.name} (${(buf.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      failed++;
      console.log(`\n  ⚠️  Failed ${exp.name}: ${err.message}`);
    }

    // Small delay to be polite to the CDN
    await sleep(30);
  }

  console.log(`\n\n✅ Done!`);
  console.log(`   Downloaded: ${downloaded}`);
  console.log(`   Skipped (existed): ${skipped}`);
  console.log(`   Failed: ${failed}`);
  console.log(`\n📁 Logos saved to public/data/logos/`);
  console.log(`   Note: Sets.tsx now uses Scrydex CDN URLs directly, so local logos`);
  console.log(`   are only needed if you want them bundled with the app build.`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
