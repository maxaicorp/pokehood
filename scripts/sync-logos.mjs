/**
 * sync-logos.mjs — download missing set logos from Scrydex CDN.
 *
 * Runs as part of `npm run prebuild` (and `predev`). Walks every physical
 * set in public/data/market-sets.json and ensures `public/data/logos/{id}.png`
 * exists. If not, fetches from Scrydex's `images.scrydex.com/pokemon/{id}-logo/logo`
 * and writes the file. Idempotent — sets we already have a logo for are skipped.
 *
 * Why: SetCard prefers the local logo (no CDN dep, no 404 flash). Without this
 * script, adding a new set required someone to remember to download the logo
 * separately — easy to miss, breaks the Sets browse page on the deploy after.
 *
 * Failures are non-fatal — a missing logo just means SetCard falls back to
 * the remote URL, same as before this script existed. We log warnings but
 * never break the build.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOGOS_DIR = path.join(ROOT, "public/data/logos");
const SETS_FILE = path.join(ROOT, "public/data/market-sets.json");
const SCRYDEX_LOGO = (id) => `https://images.scrydex.com/pokemon/${id}-logo/logo`;
const TIMEOUT_MS = 10_000;

if (!fs.existsSync(SETS_FILE)) {
  console.error("market-sets.json not found, skipping logo sync");
  process.exit(0);
}

fs.mkdirSync(LOGOS_DIR, { recursive: true });

const sets = JSON.parse(fs.readFileSync(SETS_FILE, "utf8")).sets ?? [];
const physical = sets.filter((s) => !s.isOnlineOnly);

const missing = physical.filter(
  (s) => !fs.existsSync(path.join(LOGOS_DIR, `${s.id}.png`)),
);

if (missing.length === 0) {
  console.log(`✓ logos: all ${physical.length} physical sets have local logos`);
  process.exit(0);
}

console.log(`logos: ${missing.length} missing — fetching from Scrydex CDN...`);

async function download(set) {
  const url = SCRYDEX_LOGO(set.id);
  const out = path.join(LOGOS_DIR, `${set.id}.png`);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`  ⚠ ${set.id} (${set.name}): HTTP ${res.status} — skipped`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) {
      // Cloudflare's "image not found" placeholder is tiny — treat as miss.
      console.warn(`  ⚠ ${set.id} (${set.name}): suspiciously small (${buf.length} bytes) — skipped`);
      return false;
    }
    fs.writeFileSync(out, buf);
    console.log(`  ✓ ${set.id} (${set.name}): ${(buf.length / 1024).toFixed(1)} KB`);
    return true;
  } catch (e) {
    console.warn(`  ⚠ ${set.id} (${set.name}): ${e.message ?? e}`);
    return false;
  }
}

// Throttle to 5 concurrent downloads to be nice to the CDN.
const POOL = 5;
const queue = [...missing];
let saved = 0;
async function worker() {
  while (queue.length) {
    const s = queue.shift();
    if (await download(s)) saved++;
  }
}
await Promise.all(Array.from({ length: Math.min(POOL, missing.length) }, worker));

console.log(`logos: ${saved}/${missing.length} downloaded, ${missing.length - saved} skipped\n`);
