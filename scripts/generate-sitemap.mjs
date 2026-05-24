/**
 * build-sitemap.js
 *
 * Generates static sitemap files into public/ from the local market-sets.json
 * and all-cards.json. Lovable's hosting serves anything under public/ as
 * static files, so this produces the simplest reliable sitemap setup: every
 * set page and every (non-online-only) card page gets a canonical URL.
 *
 * Run:    node scripts/build-sitemap.js
 * Output: public/sitemap.xml          — sitemap index
 *         public/sitemap-pages.xml    — homepage + sets + explore
 *         public/sitemap-sets.xml     — every /sets/:slug
 *         public/sitemap-cards-N.xml  — chunks of /sets/:slug/:cardSlug
 *
 * Re-run whenever new sets/cards are added. The edge function
 * supabase/functions/seo-sitemap/index.ts mirrors this logic and serves the
 * same content dynamically if you'd rather host the sitemap there instead.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = "https://collectiblez.app";
const CHUNK_SIZE = 45_000; // Google caps a single sitemap at 50,000 URLs.

// Match src/lib/slug.ts kebab() exactly. Keep in sync.
function kebab(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function urlEl(loc, lastmod, changefreq, priority) {
  const parts = [`    <loc>${loc}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

function urlset(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

function sitemapIndex(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`;
}

// ─── Load source data ────────────────────────────────────────────────────────

const setsJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/market-sets.json"), "utf8"),
);
const cardsJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/all-cards.json"), "utf8"),
);

const sets = (setsJson.sets ?? []).filter((s) => !s.isOnlineOnly);
const slugBySetId = new Map();
for (const s of sets) slugBySetId.set(s.id, kebab(s.name));

const cards = (cardsJson.cards ?? []).filter((c) => slugBySetId.has(c.setId));
const today = new Date().toISOString().slice(0, 10);

// ─── Build static pages sitemap ──────────────────────────────────────────────

// /market is intentionally omitted — it's an alias of / (both routes serve the
// same Market component). Including both would create duplicate content. The
// canonical emitted by Market.tsx points to / regardless of which route hit.
const pagesXml = urlset([
  urlEl(`${BASE}/`, today, "daily", "1.0"),
  urlEl(`${BASE}/sets`, today, "weekly", "0.8"),
  urlEl(`${BASE}/explore`, today, "weekly", "0.7"),
  urlEl(`${BASE}/onchain/activity`, today, "daily", "0.7"),
  urlEl(`${BASE}/onchain/marketplace`, today, "daily", "0.6"),
  urlEl(`${BASE}/games`, today, "monthly", "0.5"),
  urlEl(`${BASE}/giveaway`, today, "weekly", "0.6"),
  urlEl(`${BASE}/privacy`, today, "yearly", "0.3"),
  urlEl(`${BASE}/terms`, today, "yearly", "0.3"),
]);
fs.writeFileSync(path.join(ROOT, "public/sitemap-pages.xml"), pagesXml);

// ─── Build set landing pages sitemap ─────────────────────────────────────────

const setUrls = sets.map((s) =>
  urlEl(
    `${BASE}/sets/${kebab(s.name)}`,
    (s.updatedAt || s.releaseDate || today).slice(0, 10),
    "weekly",
    "0.8",
  ),
);
fs.writeFileSync(path.join(ROOT, "public/sitemap-sets.xml"), urlset(setUrls));

// ─── Build card page sitemaps (chunked) ──────────────────────────────────────

const chunkCount = Math.max(1, Math.ceil(cards.length / CHUNK_SIZE));
const cardSitemapNames = [];
for (let i = 0; i < chunkCount; i++) {
  const slice = cards.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
  const cardUrls = slice.map((c) => {
    const setSlug = slugBySetId.get(c.setId);
    const cSlug = `${kebab(c.name)}-${kebab(String(c.localId))}`;
    return urlEl(`${BASE}/sets/${setSlug}/${cSlug}`, undefined, "weekly", "0.5");
  });
  const filename = `sitemap-cards-${i + 1}.xml`;
  cardSitemapNames.push(filename);
  fs.writeFileSync(path.join(ROOT, `public/${filename}`), urlset(cardUrls));
}

// ─── Build sitemap index ─────────────────────────────────────────────────────

const indexXml = sitemapIndex([
  `  <sitemap>\n    <loc>${BASE}/sitemap-pages.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
  `  <sitemap>\n    <loc>${BASE}/sitemap-sets.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
  ...cardSitemapNames.map(
    (name) =>
      `  <sitemap>\n    <loc>${BASE}/${name}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
  ),
]);
fs.writeFileSync(path.join(ROOT, "public/sitemap.xml"), indexXml);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`✓ sitemap.xml (index of ${2 + chunkCount} child sitemaps)`);
console.log(`✓ sitemap-pages.xml (8 URLs)`);
console.log(`✓ sitemap-sets.xml (${sets.length} URLs)`);
for (let i = 0; i < chunkCount; i++) {
  const count = Math.min(CHUNK_SIZE, cards.length - i * CHUNK_SIZE);
  console.log(`✓ sitemap-cards-${i + 1}.xml (${count} URLs)`);
}
console.log(`\nTotal: ${4 + sets.length + cards.length} URLs across ${2 + chunkCount} sitemap files.`);
