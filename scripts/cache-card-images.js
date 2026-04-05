/**
 * cache-card-images.js
 *
 * Downloads card images for the top 1,000 most expensive cards into
 * Supabase Storage (card-images bucket), making them load instantly
 * from the Supabase CDN instead of Scrydex.
 *
 * Prerequisites:
 *   1. Run node scripts/sync-scrydex-cards.js first (to have Scrydex IDs in all-cards.json)
 *   2. Create a public "card-images" bucket in your Supabase dashboard:
 *      Dashboard → Storage → New Bucket → Name: card-images → Public: ON
 *   3. Set this storage policy in the SQL editor:
 *      CREATE POLICY "Public read" ON storage.objects FOR SELECT USING (bucket_id = 'card-images');
 *      CREATE POLICY "Anon upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'card-images');
 *
 * Credits used: 0 (images fetched directly from Scrydex CDN, not the API)
 *
 * Run: node scripts/cache-card-images.js
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://cmthndfrvnlyfxgxqjkm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdGhuZGZydm5seWZ4Z3hxamttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjIxMjMsImV4cCI6MjA4ODM5ODEyM30.gHbRuBR4oU4yx69ZLP5HiToFL6k2oGgWCWSw27lQCMU";

const BUCKET = "card-images";
const TOP_N = 1000;
const DELAY_MS = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Supabase Storage helpers ─────────────────────────────────────────────────

async function uploadToStorage(path, buffer, contentType = "image/webp") {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: buffer,
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed (${res.status}): ${err}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load all-cards.json (must have been synced from Scrydex first)
  const allCardsPath = join(__dirname, "../public/data/all-cards.json");
  let allCards;
  try {
    allCards = JSON.parse(readFileSync(allCardsPath, "utf8"));
  } catch {
    console.error("❌ public/data/all-cards.json not found.");
    console.error("   Run: node scripts/sync-scrydex-cards.js first.");
    process.exit(1);
  }

  // Build a map of card name → Scrydex card data for price matching
  const cardsByName = new Map();
  for (const card of allCards.cards) {
    if (!card.imageSmall) continue; // skip cards without Scrydex image URLs
    const key = `${card.name}|${card.setId}`;
    cardsByName.set(key, card);
  }
  console.log(`📦 Loaded ${allCards.cards.length.toLocaleString()} cards from all-cards.json`);

  // 2. Fetch top 1000 non-sealed cards from price_snapshots
  console.log(`\n💰 Fetching top ${TOP_N} cards by price from Supabase...`);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/price_snapshots?select=card_id,card_name,set_name,price&card_id=not.like.sealed-*&order=price.desc&limit=${TOP_N}`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
    }
  );
  const topCards = await res.json();
  console.log(`   Got ${topCards.length} cards from snapshots\n`);

  // 3. Match to Scrydex card data via card name + set name
  const toDownload = [];
  let noMatch = 0;
  for (const row of topCards) {
    // Try direct lookup by card_id first (if IDs match after the sync)
    const byId = allCards.cards.find((c) => c.id === row.card_id);
    if (byId?.imageSmall) {
      toDownload.push({ ...byId, price: row.price });
      continue;
    }
    // Fallback: match by name + set (handles TCGdex→Scrydex ID migration)
    const setCards = allCards.cards.filter(
      (c) => c.name === row.card_name && allCards.sets[c.setId]?.name === row.set_name
    );
    if (setCards.length > 0 && setCards[0].imageSmall) {
      toDownload.push({ ...setCards[0], price: row.price });
    } else {
      noMatch++;
    }
  }

  console.log(`🎯 Matched ${toDownload.length}/${topCards.length} cards to Scrydex images`);
  if (noMatch > 0) console.log(`   (${noMatch} unmatched — run sync-scrydex-cards.js if high)`);

  // 4. Download from Scrydex CDN and upload to Supabase Storage
  console.log(`\n📥 Downloading and uploading to Supabase Storage...\n`);

  let uploaded = 0;
  let failed = 0;
  const imageOverrides = {}; // card_id → supabase CDN URL

  for (let i = 0; i < toDownload.length; i++) {
    const card = toDownload[i];
    const storagePath = `${card.id}/small.webp`;

    try {
      // Fetch from Scrydex CDN (free, no credits)
      const imgRes = await fetch(card.imageSmall);
      if (!imgRes.ok) throw new Error(`CDN HTTP ${imgRes.status}`);
      const buf = await imgRes.arrayBuffer();

      // Upload to Supabase Storage
      const publicUrl = await uploadToStorage(storagePath, buf, "image/webp");
      imageOverrides[card.id] = publicUrl;
      uploaded++;

      const kb = (buf.byteLength / 1024).toFixed(0);
      process.stdout.write(
        `\r  [${i + 1}/${toDownload.length}] ${card.name} $${card.price} (${kb}KB) ✓`
      );
    } catch (err) {
      failed++;
      process.stdout.write(`\r  [${i + 1}/${toDownload.length}] ⚠️  ${card.name}: ${err.message}\n`);
    }

    await sleep(DELAY_MS);
  }

  // 5. Save overrides map so the app knows which cards have cached images
  const overridesPath = join(__dirname, "../public/data/card-image-overrides.json");
  writeFileSync(overridesPath, JSON.stringify(imageOverrides));

  console.log(`\n\n✅ Done!`);
  console.log(`   Uploaded: ${uploaded} images`);
  console.log(`   Failed:   ${failed}`);
  console.log(`   Storage:  ~${((uploaded * 52) / 1024).toFixed(0)}MB used`);
  console.log(`\n📁 Saved card-image-overrides.json (${Object.keys(imageOverrides).length} entries)`);
  console.log(`\n⚡ Update pokemon-api.ts to use these cached URLs for instant loading.`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
