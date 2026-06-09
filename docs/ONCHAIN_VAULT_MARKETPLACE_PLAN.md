# Collectiblez Vault Marketplace — Build Plan (tokenized sealed product)

**What we're building:** a marketplace where a **sealed Pokémon product** (e.g. an ETB) held in
our vault is represented **1:1 by an on-chain NFT**. Buy/sell the NFT instantly; **burn to redeem**
the physical box. Not fractional, not a wager — you own one whole box, represented digitally.

**Why NFT (not a fungible token):** each NFT = one discrete whole box → no fractions possible (can't
accidentally become a security), native burn-to-redeem, secondary **royalties**, and discovery on the
marketplaces collectors already use (Magic Eden / Tensor). A fungible DEX token would add the
decimals/fractional trap + securities optics for the wrong (DeFi) audience. Revisit a 0-decimal
Token-2022 only after legal review, if DEX liquidity is ever wanted.

**Reusable infra:** wallet → mint → buy → portfolio → redeem → proof-of-reserves are the same
primitives a future **gacha** (product-framed mystery pack) or any product drop would reuse. Build
the marketplace once; everything else plugs in.

---

## ⛔ Non-engineering gates (do in parallel — these block taking money)

- **Lawyer**: redemption terms, ToS, and marketing language ("own/trade/redeem a box" = product, NOT
  "invest for appreciation"). Confirm the 1:1 redeemable structure + the exact wording.
- **Inventory + custody**: buy the boxes; secure storage; **insurance**; a written redemption SOP
  (burn → ship within N days; loss/damage policy; who pays shipping).
- **Treasury**: a dedicated Solana wallet (hardware-backed) for the collection + sale proceeds.

Nothing below should accept a real dollar until the lawyer signs off the terms.

---

## Architecture (assemble existing Metaplex infra — no raw on-chain program to write)

| Concern | Choice |
|---|---|
| Token standard | **Metaplex Core NFT** collection (modern, cheap, royalty-capable; cNFT/Bubblegum if we ever scale to 10k+). 100 units is trivial. |
| Primary sale | **Metaplex Candy Machine** — atomic "pay SOL/USDC → mint NFT", hard **supply cap**, mint authority lockable. No custom escrow needed. |
| Secondary market | **Magic Eden / Tensor** list (they handle escrow + enforce royalty → we earn per resale). In-app listing escrow is a later option. |
| Wallet | `@solana/wallet-adapter` + Phantom (in the React app) |
| RPC / indexing | **Helius** (already used for the Onchain page) |
| Off-chain state | **Supabase**: redemption queue, shipping info, supply mirror, proof-of-reserves |
| Settlement | SOL / USDC (merchant sale of our own product — not money transmission) |

**Trust anchor:** supply is locked at the box count, mint authority renounced after mint, and a public
**proof-of-reserves** page shows `boxes vaulted ↔ live NFTs ↔ redeemed`. That 1:1 honesty is the product.

---

## Phases

### Phase 0 — Decisions + foundation
Lawyer engaged · inventory + custody + insurance arranged · treasury wallet created · **devnet** set up
for all testing first.

### Phase 1 — Wallet in the app (foundation)
- Add `@solana/wallet-adapter` (Phantom) — a "Connect Wallet" in the header/profile.
- Reuse existing Helius/RPC config. Wallet state available app-wide.

### Phase 2 — Mint the collection (devnet → mainnet)
- Metaplex Core collection + Candy Machine: N units, metadata (box art, set, `redeemable: 1 sealed
  ETB`, vault id), price, **supply cap = N**, mint authority locked after deploy.
- Admin tool to configure + deploy the machine.

### Phase 3 — Primary marketplace (BUY)
- A **/vault** (or /market → "Vault") page: available boxes, price, **supply tracker (e.g. 87/100)**,
  Connect + **Buy** → Candy Machine mint (atomic pay → receive NFT).
- **Portfolio**: show owned box-NFTs in the user's dashboard (read from wallet via Helius DAS).

### Phase 4 — Redemption (the obligation)
- On an owned box-NFT: **Redeem** → **burn** the NFT → write a `vault_redemptions` row (wallet, mint,
  shipping address collected securely) → **admin queue** → ship → mark fulfilled.
- The NFT is permanently gone; that box leaves the vault.

### Phase 5 — Secondary + fees
- List the collection on **Magic Eden / Tensor** with a royalty → earn on every resale. Link from the
  app. (Optional later: in-app fixed-price listing escrow to keep trading on-site.)

### Phase 6 — Proof of reserves + trust
- Public page: `100 vaulted · N live · M redeemed`, vault photos, on-chain collection address. This is
  what makes buyers (and grant reviewers) trust it.

### Phase 7 — Grant + scale + future gacha
- One-pager: "Redeemable sealed-product RWA on Solana." Scale to more sets/boxes. **Gacha** later =
  a different primary-sale mechanic (pay → random NFT from a disclosed-odds pool, framed as a product/
  booster, never a cash-out wager) — reuses mint + marketplace + redemption built above.

---

## The thin vertical slice (do this FIRST — before 100 boxes)

Prove the **entire cycle with ONE real box on devnet**, then a single mainnet box:
1. Wallet connect works (Phase 1).
2. Mint **1** box-NFT (Phase 2, devnet).
3. Buy it with a test wallet (Phase 3).
4. **Burn → redemption request → admin marks shipped** (Phase 4), with a real box on the desk.
5. Confirm supply math + proof-of-reserves reads 1↔1.

If that loop works end-to-end, scale the count to 100. Don't commit inventory until the loop is proven.

---

## What I (engineering) build vs what you provide

- **I build:** wallet adapter integration, the /vault marketplace + buy flow, portfolio, the
  redemption burn + admin fulfillment queue (Supabase), the proof-of-reserves page, admin mint tooling.
- **You provide:** the treasury wallet + SOL for deploy, the Candy Machine deploy approval (your keys),
  the physical inventory + custody, and the **lawyer-approved terms** before launch.

## Risks (eyes-open)
- **Custody/ops** is the real weight (storage, insurance, fulfillment, inventory price risk).
- **Redemption must be ironclad** — it's the consumer-protection core.
- **Keep marketing "product," not "investment"** — protects the legal structure.
- **Royalty enforcement on Solana is marketplace-dependent** — ME/Tensor honor it; some venues don't.
