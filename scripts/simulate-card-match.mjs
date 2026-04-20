/**
 * Models the Card Match flip flow to expose where perceived latency comes from.
 * Not a unit test — a deterministic timeline we can read by eye.
 *
 * Run: node scripts/simulate-card-match.mjs
 */

const FLIP_ANIM_MS = 480;
const FLIP_BACK_DELAY_MS = 1800; // current value in CardMatch.tsx

// Latency profiles (ms): [auth, dbLoad, dbUpdate, networkRtt]
const PROFILES = {
  warm: { auth: 80, dbLoad: 50, dbUpdate: 60, network: 80 },
  cold: { auth: 350, dbLoad: 120, dbUpdate: 150, network: 200 },
};

function flipLatency(p) {
  return p.network + p.auth + p.dbLoad + p.dbUpdate + p.network;
}

const events = [];
const log = (t, slot, msg) => events.push({ t: Math.round(t), slot, msg });

function simulateRound(profile, label) {
  events.length = 0;
  const lat = flipLatency(profile);

  // First click at t=0 (slot A)
  log(0, "A", "user click slot A");
  log(0, "A", `setBusy(true), POST /flip (latency ≈ ${lat}ms)`);

  const t1 = lat;
  log(t1, "A", "server response arrives (first-of-pair)");
  log(t1, "A", "setSlots(A.card=cardA, A.revealed=true)");
  log(t1, "A", "setBusy(false) — buttons re-enabled");
  log(t1, "A", "CSS rotateY starts (480ms)");
  log(t1 + FLIP_ANIM_MS / 2, "A", "↳ rotation passes 90°, image becomes visible");
  log(t1 + FLIP_ANIM_MS, "A", "↳ rotation complete — card fully visible");

  // User reaction time before clicking slot B
  const reactGap = 600;
  const tB = t1 + FLIP_ANIM_MS + reactGap;
  log(tB, "B", `user click slot B (after ~${reactGap}ms read time on A)`);
  log(tB, "B", `setBusy(true), POST /flip (latency ≈ ${lat}ms)`);

  const t2 = tB + lat;
  log(t2, "B", "server response arrives (no match)");
  log(t2, "B", "setAnimating(true), setSlots(both revealed=true, flashing=true)");
  log(t2, "B", "setBusy(false)");
  log(t2, "B", `flipBackTimer scheduled at +${FLIP_BACK_DELAY_MS}ms`);
  log(t2 + FLIP_ANIM_MS / 2, "B", "↳ rotation passes 90°, image visible");
  log(t2 + FLIP_ANIM_MS, "B", "↳ rotation complete");

  const tBack = t2 + FLIP_BACK_DELAY_MS;
  log(tBack, "*", "flipBackTimer fires");
  log(tBack, "*", "setSlots(both revealed=false, flashing=false)");
  log(tBack, "*", "CSS rotateY back starts (480ms)");
  log(tBack + FLIP_ANIM_MS, "*", "back rotation complete, card data still mounted");

  // Derived metrics
  const aRevealedAt = t1 + FLIP_ANIM_MS / 2;
  const bRevealedAt = t2 + FLIP_ANIM_MS / 2;
  const bHiddenAt = tBack + FLIP_ANIM_MS / 2;
  const bReadableMs = bHiddenAt - bRevealedAt;
  const totalRoundMs = tBack + FLIP_ANIM_MS;

  console.log(`\n=== ${label.toUpperCase()} (${lat}ms per flip) ===\n`);
  for (const e of events) {
    console.log(
      `  t=${String(e.t).padStart(5, " ")}ms  [${e.slot}]  ${e.msg}`,
    );
  }
  console.log("\n  --- perceived ---");
  console.log(`  Click A → A appears:    ${Math.round(aRevealedAt)}ms`);
  console.log(`  Click B → B appears:    ${Math.round(bRevealedAt - tB)}ms`);
  console.log(`  B readable time:        ${Math.round(bReadableMs)}ms`);
  console.log(`  Full no-match round:    ${Math.round(totalRoundMs)}ms`);
}

simulateRound(PROFILES.warm, "warm function");
simulateRound(PROFILES.cold, "cold function (or first hit after redeploy)");

console.log(`
=== diagnosis ===
  • Each flip = full network roundtrip (you can't dodge this without
    leaking slot positions to the client).
  • Cold edge functions typically add 0.5–2s of one-time latency.
  • B's "readable time" is the gap between when the back face becomes
    visible and when it starts rotating away. With FLIP_BACK_DELAY_MS=
    ${FLIP_BACK_DELAY_MS}ms it's safely > 1s in both warm & cold cases.
  • If you ever see B "barely show up", the cause is almost always the
    back-face image not being decoded yet when the rotation completes
    — fix by awaiting preload BEFORE setSlots reveals the card.
`);
