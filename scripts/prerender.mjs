/**
 * prerender.mjs — generate static HTML for SEO-critical routes.
 *
 * Why: Collectiblez is a Vite SPA. Without prerendering, every route ships
 * `<div id="root"></div>` plus a JS bundle. Google's bot can execute JS so
 * it eventually indexes us, but Perplexity / ChatGPT / Claude crawlers
 * usually can't — they see an empty page and bounce. Static HTML per route
 * fixes both.
 *
 * Approach: template-based, no headless browser. We read the post-build
 * `dist/index.html` (which already has the right hashed JS bundle <script>),
 * substitute route-specific <title>, <meta>, JSON-LD, and visible content
 * into <div id="root">, then write the result as `dist/<route>/index.html`.
 * Static hosts (Lovable, Vercel, Netlify, Cloudflare Pages) serve nested
 * index.html files automatically for path-based routing.
 *
 * When the real user hits the page, React mounts on top of the prerendered
 * markup and re-renders. The bot keeps the static HTML it saw on initial
 * request.
 *
 * Stage A scope (this script):
 *   - 7 public landing pages: /, /sets, /explore, /games, /giveaway, /privacy, /terms
 *   - 179 set pages: /sets/:slug
 *   - Top 500 cards by price: /sets/:slug/:cardSlug
 *
 * Total: 686 HTML files. Build adds ~30s.
 *
 * Stage B (deferred): the remaining ~20,000 card pages, via a separate
 * incremental job that uploads to the CDN independent of the main build.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const BASE = "https://collectiblez.app";
const TOP_N_CARDS = 500;

// Match src/lib/slug.ts kebab() exactly. Keep in sync.
function kebab(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Sanity check ────────────────────────────────────────────────────────────

if (!fs.existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` before prerender");
  process.exit(0); // exit 0 so npm doesn't fail if dist isn't built yet
}
const templatePath = path.join(DIST, "index.html");
if (!fs.existsSync(templatePath)) {
  console.error("dist/index.html not found");
  process.exit(1);
}
const template = fs.readFileSync(templatePath, "utf8");

// ─── Load data ───────────────────────────────────────────────────────────────

const setsJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/market-sets.json"), "utf8"),
);
const cardsJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/all-cards.json"), "utf8"),
);

const sets = (setsJson.sets ?? []).filter((s) => !s.isOnlineOnly);
const slugBySetId = new Map();
const setById = new Map();
for (const s of sets) {
  slugBySetId.set(s.id, kebab(s.name));
  setById.set(s.id, s);
}

// Index cards by setId for set-page rendering, and build a flat list for
// "top N by price" once we have prices.
const cardsBySetId = new Map();
for (const c of cardsJson.cards ?? []) {
  if (!slugBySetId.has(c.setId)) continue;
  let arr = cardsBySetId.get(c.setId);
  if (!arr) {
    arr = [];
    cardsBySetId.set(c.setId, arr);
  }
  arr.push(c);
}

// ─── Pull prices from Supabase ────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const priceByCardId = new Map();

async function fetchPrices() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log("(no SUPABASE env vars — skipping price enrichment)");
    return;
  }
  // Paginate through get_all_latest_prices (RPC caps at 1000 per page).
  let offset = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_all_latest_prices`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
        Prefer: "params=single-object",
      },
      body: JSON.stringify({ p_limit: 1000, p_offset: offset }),
    });
    if (!res.ok) {
      console.error(`price fetch failed (HTTP ${res.status})`);
      break;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      if (r.card_id && r.price != null) priceByCardId.set(r.card_id, Number(r.price));
    }
    if (rows.length < 1000) break;
    offset += 1000;
  }
  console.log(`✓ priced ${priceByCardId.size.toLocaleString()} cards`);
}

// ─── Template-substitution helpers ───────────────────────────────────────────

function fillTemplate({ title, description, canonical, jsonLd, body }) {
  const ld = jsonLd.map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join("\n");
  const t = escape(title);
  const d = escape(description);
  const u = escape(canonical);
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${d}" />`)
    // Open Graph
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${t}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${d}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${u}" />`)
    // Twitter card — keep image as-is, swap title + description to route-specific.
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${t}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${d}" />`)
    // Insert canonical + JSON-LD just before </head>.
    .replace(
      "</head>",
      `<link rel="canonical" href="${u}" />\n${ld}\n</head>`,
    )
    // Inject visible content into the root div so non-JS crawlers see real markup.
    .replace(
      `<div id="root"></div>`,
      `<div id="root">${body}</div>`,
    );
}

function writeRoute(routePath, html) {
  // routePath like "/", "/sets/ascended-heroes", "/sets/x/y"
  const dir = routePath === "/"
    ? DIST
    : path.join(DIST, ...routePath.slice(1).split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

// ─── Route generators ────────────────────────────────────────────────────────

function generateHomepage() {
  const title = "Collectiblez — Live Pokémon TCG Market Prices";
  const description = `Track live market prices for every Pokémon TCG card across ${sets.length} sets. Updated daily. Browse by set, view price history, monitor top movers.`;
  const body = `
    <header>
      <h1>Collectiblez — Pokémon TCG Market Prices</h1>
      <p>Live market prices for ${sets.length} Pokémon TCG expansions, refreshed daily from TCGPlayer data via Scrydex.</p>
    </header>
    <nav>
      <a href="/sets">Browse all sets</a>
      <a href="/explore">Explore cards</a>
      <a href="/onchain">Onchain activity</a>
    </nav>
  `;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Collectiblez",
      url: BASE,
      potentialAction: {
        "@type": "SearchAction",
        target: `${BASE}/explore?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
  writeRoute("/", fillTemplate({ title, description, canonical: `${BASE}/`, jsonLd, body }));
}

function generateSetsIndex() {
  const title = "All Pokémon TCG Sets & Expansions — Collectiblez";
  const description = `Browse all ${sets.length} Pokémon TCG expansions including Scarlet & Violet, Sword & Shield, Sun & Moon, and every era back to Base Set. Live card prices per expansion.`;
  const sorted = [...sets].sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || ""));
  const body = `
    <h1>All Pokémon TCG Sets</h1>
    <p>${sets.length} expansions. Newest first.</p>
    <ul>
      ${sorted.map((s) => {
        const slug = slugBySetId.get(s.id);
        return `<li><a href="/sets/${slug}">${escape(s.name)}</a> — ${escape(s.series ?? "")} · ${escape(s.releaseDate ?? "")}</li>`;
      }).join("\n")}
    </ul>
  `;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Sets", item: `${BASE}/sets` },
      ],
    },
  ];
  writeRoute("/sets", fillTemplate({ title, description, canonical: `${BASE}/sets`, jsonLd, body }));
}

function generateStaticPage(routePath, title, description, h1, intro) {
  const body = `
    <h1>${escape(h1)}</h1>
    <p>${escape(intro)}</p>
  `;
  writeRoute(routePath, fillTemplate({
    title,
    description,
    canonical: `${BASE}${routePath}`,
    jsonLd: [],
    body,
  }));
}

function generateSetPage(set) {
  const slug = slugBySetId.get(set.id);
  const cardsInSet = cardsBySetId.get(set.id) ?? [];
  // Sort cards in the set by price (with prices) descending, unpriced last.
  const sorted = [...cardsInSet].sort((a, b) => {
    const pa = priceByCardId.get(a.id) ?? -1;
    const pb = priceByCardId.get(b.id) ?? -1;
    return pb - pa;
  });
  const year = set.releaseDate ? set.releaseDate.slice(0, 4) : "";
  const cardCount = set.printedTotal || set.total || cardsInSet.length;
  const title = `${set.name} — Card List & Prices${year ? ` (${year})` : ""} | Collectiblez`;
  const description = `Full ${set.name} card list with live market prices for all ${cardCount} cards from the ${set.series ?? ""} series. Updated daily.`;

  // Top 50 cards in the visible body for non-JS crawlers — enough for ranking
  // signal without bloating the HTML.
  const top = sorted.slice(0, 50);
  const body = `
    <header>
      <h1>${escape(set.name)}</h1>
      <p>${escape(set.series ?? "")} · Released ${escape(set.releaseDate ?? "")} · ${cardCount} cards</p>
    </header>
    <nav><a href="/sets">← All sets</a></nav>
    <ol>
      ${top.map((c) => {
        const cSlug = `${kebab(c.name)}-${kebab(String(c.localId))}`;
        const price = priceByCardId.get(c.id);
        const priceStr = price != null ? `$${price.toFixed(2)}` : "—";
        return `<li><a href="/sets/${slug}/${cSlug}">${escape(c.name)}</a> · #${escape(c.localId)} · ${priceStr}</li>`;
      }).join("\n")}
    </ol>
  `;

  const itemListItems = sorted.slice(0, 100).map((c, i) => {
    const cSlug = `${kebab(c.name)}-${kebab(String(c.localId))}`;
    const price = priceByCardId.get(c.id);
    return {
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: c.name,
        sku: c.localId,
        image: c.imageSmall,
        url: `${BASE}/sets/${slug}/${cSlug}`,
        brand: { "@type": "Brand", name: "Pokémon" },
        category: "Trading Card",
        ...(price != null && {
          offers: {
            "@type": "Offer",
            price: price.toFixed(2),
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
          },
        }),
      },
    };
  });

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Sets", item: `${BASE}/sets` },
        { "@type": "ListItem", position: 2, name: set.name, item: `${BASE}/sets/${slug}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${set.name} Card List`,
      numberOfItems: itemListItems.length,
      itemListElement: itemListItems,
    },
  ];

  writeRoute(`/sets/${slug}`, fillTemplate({
    title,
    description,
    canonical: `${BASE}/sets/${slug}`,
    jsonLd,
    body,
  }));
}

function generateCardPage(card, set) {
  const setSlug = slugBySetId.get(set.id);
  const cardSlug = `${kebab(card.name)}-${kebab(String(card.localId))}`;
  const price = priceByCardId.get(card.id);
  const cardTotal = set.printedTotal || set.total;
  const title = `${card.name} #${card.localId} — ${set.name} Price | Collectiblez`;
  const description = price != null
    ? `${card.name} ${card.localId}${cardTotal ? `/${cardTotal}` : ""} from ${set.name}. Current market price $${price.toFixed(2)}. Updated daily.`
    : `${card.name} ${card.localId}${cardTotal ? `/${cardTotal}` : ""} from ${set.name}. Live market price tracking.`;

  const body = `
    <header>
      <nav>
        <a href="/sets">Sets</a> /
        <a href="/sets/${setSlug}">${escape(set.name)}</a> /
        <span>${escape(card.name)}</span>
      </nav>
      <h1>${escape(card.name)}</h1>
      <p>#${escape(card.localId)}${cardTotal ? `/${cardTotal}` : ""} · ${escape(set.name)}</p>
      ${card.imageSmall ? `<img src="${escape(card.imageLarge || card.imageSmall)}" alt="${escape(card.name)}" />` : ""}
      ${price != null ? `<p><strong>Market price: $${price.toFixed(2)}</strong></p>` : ""}
    </header>
  `;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Sets", item: `${BASE}/sets` },
        { "@type": "ListItem", position: 2, name: set.name, item: `${BASE}/sets/${setSlug}` },
        { "@type": "ListItem", position: 3, name: card.name, item: `${BASE}/sets/${setSlug}/${cardSlug}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: card.name,
      sku: card.localId,
      image: card.imageLarge || card.imageSmall,
      description: `${card.name} ${card.localId}${cardTotal ? `/${cardTotal}` : ""} from ${set.name}.`,
      brand: { "@type": "Brand", name: "Pokémon" },
      category: "Trading Card",
      ...(price != null && {
        offers: {
          "@type": "Offer",
          price: price.toFixed(2),
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: `${BASE}/sets/${setSlug}/${cardSlug}`,
        },
      }),
    },
  ];

  writeRoute(`/sets/${setSlug}/${cardSlug}`, fillTemplate({
    title,
    description,
    canonical: `${BASE}/sets/${setSlug}/${cardSlug}`,
    jsonLd,
    body,
  }));
}

// ─── Run ─────────────────────────────────────────────────────────────────────

await fetchPrices();

// Public landing pages.
generateHomepage();
generateSetsIndex();
generateStaticPage("/explore",  "Explore Pokémon TCG Cards — Collectiblez",
  "Search and filter every Pokémon TCG card by set, rarity, and price. Live market data.",
  "Explore Pokémon TCG Cards", "Search across every Pokémon TCG card with live prices.");
generateStaticPage("/games",    "Pokémon TCG Games — Collectiblez",
  "Play Pokémon TCG mini-games and win real card prizes.",
  "Pokémon TCG Games", "Mini-games with weekly leaderboards and real card prizes.");
generateStaticPage("/giveaway", "Pokémon Card Giveaway — Collectiblez",
  "Enter the current Pokémon card giveaway. Free entry.",
  "Pokémon Card Giveaway", "Enter to win real Pokémon cards.");
generateStaticPage("/privacy",  "Privacy Policy — Collectiblez",
  "How Collectiblez handles your data.",
  "Privacy Policy", "How we handle your data.");
generateStaticPage("/terms",    "Terms of Service — Collectiblez",
  "Collectiblez terms of service.",
  "Terms of Service", "Our terms.");
console.log(`✓ ${7} public landing pages`);

// Set pages.
let setCount = 0;
for (const s of sets) {
  generateSetPage(s);
  setCount++;
}
console.log(`✓ ${setCount} set landing pages`);

// Top N cards by price.
const ranked = [...priceByCardId.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP_N_CARDS);
let cardCount = 0;
for (const [cardId] of ranked) {
  // Find the card object
  const card = (cardsJson.cards ?? []).find((c) => c.id === cardId);
  if (!card) continue;
  const set = setById.get(card.setId);
  if (!set) continue;
  generateCardPage(card, set);
  cardCount++;
}
console.log(`✓ ${cardCount} top card pages`);

console.log(`\nTotal: ${7 + setCount + cardCount} prerendered HTML files`);
