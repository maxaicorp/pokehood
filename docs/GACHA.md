# Solana Onchain Gacha Machine Plan

Date: 2026-06-06 / 2026-06-07

This is a product and engineering plan for a private, hidden Solana gacha machine inside Collectiblez.

The core idea: a user pays onchain, randomness resolves onchain, the prize is selected onchain, and the prize is transferred or reserved by the Solana program. Supabase and the frontend may index and display state, but they must not decide outcomes.

## Product Goal

Build a private Solana gacha route where invited users can connect a wallet, pay for a pull, receive a provably random result, and win an onchain prize from a program-owned prize vault.

Target properties:

- Solana only.
- Hidden/private route, not public navigation.
- Outcomes decided onchain.
- Prize custody controlled by the program, not by the frontend.
- Clear audit trail for every pull.
- Admin can load inventory, pause the machine, set pull price, and retire a machine.
- No public launch until legal/compliance review is complete.

## Important Reality Check

The UI can be private. The onchain activity cannot be truly private.

Anyone who knows the program id, vault addresses, or transaction signatures can inspect activity on Solana explorers. "Invisible to the public" should mean:

- no public nav link
- no sitemap entry
- no prerendered public page
- no SEO indexing
- app route gated by auth/invite/admin role
- onchain wallet allowlist enforced by the program

It cannot mean "nobody can see the transactions onchain."

## What Gacha Means Here

A gacha machine is a weighted prize draw:

1. Admin loads prize inventory into an onchain vault.
2. Admin defines pull price and prize weights.
3. User connects wallet and buys a pull.
4. Program requests/verifies randomness.
5. Program maps randomness to a weighted prize.
6. Program transfers or reserves the prize for the user.
7. Database indexes the result for UI/history only.

## Recommended MVP Shape

### Chain

Solana mainnet beta for production, Solana devnet for build/test.

### Program Framework

Use Anchor.

Reasons:

- Program Derived Addresses are central to this design.
- PDA-owned token vaults let the program custody prizes and sign token transfers.
- Anchor gives account constraints, IDL, and TypeScript client generation.

### Payment Token

Use USDC for MVP.

Reasons:

- Stable pricing is easier for users and accounting.
- Avoids pull price drifting with SOL.
- The existing onchain code already handles USDC/SOL price rendering concepts.

SOL can be added later as a second payment path.

### Prize Type

For "fully onchain," prizes should be onchain assets:

- Solana NFTs
- compressed NFTs, if the program/integration supports transfer cleanly
- SPL tokens
- redeemable onchain prize tokens

Physical cards are not fully onchain by themselves. A physical card can be represented by a redeemable NFT or claim token, but shipping/fulfillment is offchain. If the first gacha includes physical prizes, call that out honestly as "onchain draw, offchain fulfillment."

### Randomness

Use a Solana-native verifiable randomness provider. Primary recommendation: Switchboard Randomness On-Demand.

Switchboard's Solana/SVM randomness docs describe the request/resolve flow, where the app creates a randomness request, receives an oracle assignment, later receives a randomness object, and verifies it through the Switchboard contract before resolving the event.

Reference:

- https://docs.switchboard.xyz/docs-by-chain/solana-svm/randomness

Do not use:

- `Math.random()`
- blockhash-only randomness
- timestamp randomness
- frontend-generated randomness
- admin/server-selected prize outcomes

## Existing App Fit

The repo already has useful adjacent systems:

- `/onchain` route
- Solana-oriented ingest via Magic Eden and Helius
- `onchain_activities`
- `onchain_listings`
- `nft_names`
- admin health/function pages
- game prize tables and admin prize management

The gacha system should follow the same pattern:

```text
Solana program = source of truth
Supabase = indexed read cache and admin telemetry
Frontend = wallet UX and machine display
```

Do not make Supabase decide winners.

## Private Route Plan

Add a hidden route such as:

```text
/lab/gacha/:machineSlug
```

or:

```text
/gacha/private/:machineSlug
```

Route rules:

- Do not add to `AppHeader`.
- Do not add to sitemap generation.
- Do not prerender it.
- Add `noindex,nofollow` SEO metadata.
- Require login and/or invite code.
- Require connected Solana wallet.
- Program should also enforce wallet allowlist, because UI-only privacy is not security.

Possible access modes:

1. Admin only
   - good for internal testing
2. Invite code plus authenticated Collectiblez account
   - good for small beta
3. Wallet allowlist PDA
   - best onchain enforcement
4. Merkle allowlist
   - scalable, but more moving parts

MVP recommendation: explicit wallet allowlist stored onchain for the first private beta.

## Onchain Program Accounts

### `Machine`

One account per gacha machine.

Fields:

```text
authority
treasury_token_account
payment_mint
pull_price
status: draft | active | paused | retired
config_epoch
allowlist_required
total_weight
created_at_slot
updated_at_slot
```

Notes:

- `config_epoch` is important. Each pull stores the epoch it used, so admins cannot alter odds mid-pull.
- If odds or inventory change, increment the epoch.

### `PrizeItem`

One account per prize or prize stack.

Fields:

```text
machine
mint
vault_token_account
display_name_hash
tier
weight
quantity_available
quantity_awarded
status: active | disabled | exhausted
config_epoch
```

For unique NFTs:

```text
quantity_available = 1
```

For fungible/token prizes:

```text
quantity_available = token amount or number of claim units
```

### `Pull`

One account per user pull.

Fields:

```text
machine
player
payment_amount
payment_signature_data
randomness_account
commit_slot
config_epoch
status: paid | randomness_requested | settled | claimed | refunded | expired
winning_prize_item
random_value
created_at_slot
settled_at_slot
```

### `MachineVault`

PDA authority for prize token accounts.

The program owns the vault authority. Admin can deposit prizes, but cannot pull prizes out while the machine is active except through explicit admin withdrawal rules.

### `Treasury`

PDA or admin-controlled token account for payments.

MVP recommendation:

- USDC payments move into a program-controlled treasury token account.
- Admin withdrawal requires machine paused or retired.

## Core Instructions

### Admin Instructions

`initialize_machine`

- Creates `Machine`.
- Sets authority, payment mint, pull price, access mode.

`set_machine_status`

- Draft, active, paused, retired.
- Paused blocks new pulls but still allows settlement/claims/refunds.

`set_pull_price`

- Updates pull price.
- Increments `config_epoch`.
- Only allowed when paused/draft, or applies only to future pulls.

`set_allowlist`

- Adds/removes wallets or updates allowlist root.
- For MVP, direct PDA rows are easiest.

`deposit_prize`

- Transfers NFT/token from admin wallet into PDA-controlled vault token account.
- Creates or updates `PrizeItem`.

`set_prize_weight`

- Updates odds.
- Increments `config_epoch`.
- Only future pulls use the new weight.

`disable_prize`

- Removes a prize from future pulls.
- Cannot affect already reserved/won prizes.

`withdraw_unawarded_prize`

- Only when machine is paused/retired.
- Cannot withdraw a reserved/won prize.

`withdraw_treasury`

- Moves payment proceeds to admin treasury.
- Should be blocked if unsettled pulls exist unless explicitly safe.

### User Instructions

`buy_pull`

- Requires active machine.
- Requires wallet allowed if allowlist enabled.
- Transfers USDC payment from player to treasury.
- Creates `Pull`.
- Stores machine `config_epoch`.
- Initiates or prepares randomness request.

`request_randomness`

- Creates/commits the randomness request using the chosen provider.
- May be combined with `buy_pull` if provider flow allows.

`settle_pull`

- Verifies randomness.
- Maps random value to weighted prize list for the stored `config_epoch`.
- Marks prize as awarded/reserved.
- Transfers prize to player if possible, or marks it claimable.

`claim_prize`

- Transfers reserved prize to player.
- Useful if settlement cannot transfer because the player ATA must be created separately.

`refund_expired_pull`

- If randomness does not resolve after a defined slot/time window, refund the payment.
- Keeps the machine trustworthy when oracle resolution fails.

## Pull Flow

Recommended two-transaction flow:

```text
1. User clicks Pull.
2. Frontend sends buy_pull/request_randomness transaction.
3. Payment moves to treasury.
4. Pull account is created.
5. Randomness request is committed.
6. UI enters "resolving" state.
7. User or backend helper submits settle_pull when randomness is ready.
8. Program verifies randomness.
9. Program selects prize.
10. Program transfers/reserves prize.
11. UI shows reveal.
```

The backend/helper may assist with settlement, but the settlement instruction must be verifiable onchain and callable by anyone.

## Weighted Selection

Prize selection should use cumulative weights:

```text
random_index = random_value % total_weight
walk active prize items by deterministic order
choose first prize where cumulative_weight > random_index
```

Critical details:

- Deterministic prize ordering must be defined.
- Exclude disabled/exhausted prizes.
- Use the `config_epoch` stored on the pull.
- If an item is exhausted between request and settle, either:
  - reserve inventory at buy time, or
  - settle against a snapshot of weights/inventory for that epoch.

MVP recommendation: reserve inventory/epoch state at pull time or prevent config/inventory changes while any pulls are unsettled. Simpler beats clever here.

## Odds Display

Because this is real value, users need clear odds.

Frontend should show:

- pull price
- prize tiers
- count available per tier/item
- current odds
- whether odds change as prizes are won
- last pull tx signature
- randomness tx/signature
- settlement tx/signature

The exact prize list can be hidden only if legal/compliance agrees. From a trust perspective, transparent odds are better.

## Supabase Read Cache

Supabase is not the source of truth. It indexes the onchain program for UX/admin.

Possible tables:

### `gacha_machines`

```text
machine_id
slug
program_id
machine_pda
status
payment_mint
pull_price
private_mode
created_at
updated_at
```

### `gacha_prizes`

```text
machine_id
prize_item_pda
mint
name
image
tier
weight
quantity_available
quantity_awarded
status
last_seen_at
```

### `gacha_pulls`

```text
pull_pda
machine_id
player_wallet
status
payment_amount
randomness_account
winning_prize_item_pda
winning_mint
random_value
buy_signature
settle_signature
claim_signature
created_at
settled_at
```

### `gacha_audit_events`

Append-only event log from indexer:

```text
signature
slot
event_type
machine_id
pull_pda
player_wallet
raw
created_at
```

RLS:

- Admin can read all.
- Invited users can read machines they are allowed to access.
- Public cannot read private machines.

## Indexing Strategy

MVP:

- Client reads onchain accounts directly for the active machine.
- Supabase stores only admin metadata and historical pulls after settlement.

Production:

- Edge function or cron polls program signatures.
- Helius webhook can notify new program transactions.
- Indexer decodes program events and updates Supabase.

Pattern should mirror current onchain ingestion:

```text
onchain events -> edge/indexer -> Supabase cache -> frontend read
```

## Frontend Plan

### User Route

`/lab/gacha/:machineSlug`

States:

- locked/not invited
- connect wallet
- machine loading
- machine paused
- inventory empty
- ready to pull
- payment pending
- randomness resolving
- reveal
- prize won
- claim/transfer pending
- pull expired/refundable

Core components:

- `GachaMachinePage`
- `WalletConnectPanel`
- `MachineHeader`
- `PrizeOddsTable`
- `PullButton`
- `ResolvingState`
- `RevealPanel`
- `MyPullHistory`
- `OnchainAuditLinks`

Required dependencies likely include:

```text
@solana/web3.js
@solana/wallet-adapter-react
@solana/wallet-adapter-react-ui
@solana/wallet-adapter-wallets
@solana/spl-token
@coral-xyz/anchor
```

The current repo does not appear to have wallet adapter dependencies installed yet.

### Admin Route

`/admin/gacha`

Admin views:

- machine list
- create/edit machine
- deposit prize
- prize inventory
- set weights
- pause/resume
- pull history
- unsettled pulls
- refunds
- treasury
- audit links

Admin should never be able to manually choose a winner.

## Security Rules

Must-have:

- Program-enforced wallet allowlist for private beta.
- Program-owned PDA vaults for prizes.
- No frontend/server outcome decisions.
- No admin odds changes affecting active pulls.
- No prize withdrawal while active pulls are unsettled.
- Refund path for stuck randomness.
- Machine pause switch.
- Config epoch stored on every pull.
- Events emitted for every important state transition.
- All token transfers use checked mints/accounts.
- Settlement callable by anyone, not only admin.

Avoid:

- Custody in a normal admin wallet during active machine.
- Server-generated randomness.
- Hidden odds.
- "Trust me" manual fulfillment for onchain prizes.
- Durable offchain-only records of winning pulls.

## Compliance And Launch Gate

This is not legal advice, but gacha with paid entries and prizes can trigger gambling, sweepstakes, loot box, consumer protection, tax, and age/location issues.

Before public or semi-public launch:

- legal review
- jurisdiction rules
- age gating decision
- location gating decision
- terms update
- privacy update
- refund policy
- prize fulfillment policy
- tax/reporting handling if prizes have meaningful value

For private internal testing:

- no public marketing
- limited invite list
- cap pull value
- use devnet until counsel/ops are ready

## Build Phases

### Phase 0: Decision And Legal Gate

Decide:

- payment token: USDC or SOL
- first machine prize inventory
- physical vs onchain-only prizes
- invite model
- max pull price
- max daily pulls per wallet
- whether odds are public
- legal/compliance owner

Output:

- signed product spec
- legal go/no-go for private beta

### Phase 1: Devnet Program MVP

Build Anchor program:

- initialize machine
- allowlist wallet
- deposit prize NFT
- set weights
- buy pull
- request/settle randomness
- transfer prize
- refund expired pull
- pause machine

Use devnet assets only.

Output:

- Anchor program
- IDL
- local/devnet tests
- sample devnet machine

### Phase 2: Hidden Frontend MVP

Add hidden route:

```text
/lab/gacha/:machineSlug
```

Add wallet connection and pull flow.

Do not add public nav, sitemap, or prerender.

Output:

- private devnet page
- wallet connect
- pull/reveal/claim states
- tx links

### Phase 3: Admin And Indexing

Add `/admin/gacha`.

Add Supabase read cache and indexer:

- machines
- prizes
- pulls
- audit events

Output:

- admin can inspect machine health
- pulls are queryable
- history is readable without reloading every chain account

### Phase 4: Security Hardening

Tests:

- cannot pull when paused
- cannot pull if not allowlisted
- cannot pull with wrong payment mint
- cannot settle with fake randomness
- cannot settle twice
- cannot change odds for active pull
- cannot withdraw reserved prize
- refund works after expiry
- distribution simulation matches weights
- inventory exhaustion is handled

Security:

- internal review
- external Solana/Anchor audit if real value is meaningful
- mainnet dry run with tiny-value assets

### Phase 5: Private Mainnet Beta

Small invite list.

Hard caps:

- max pull price
- max pulls per wallet/day
- max machine treasury
- max prize value

Monitoring:

- failed settlements
- stuck randomness
- vault balance
- prize inventory
- refund count
- treasury balance

### Phase 6: Public Decision

Only after legal and security gates.

If public:

- public terms
- clear odds
- support path
- monitoring alerts
- incident response
- tax/prize process

## Test Plan

### Program Tests

Use Anchor tests for:

- initialize machine
- admin-only mutations
- allowlist enforcement
- payment transfer
- prize deposit
- prize transfer
- settlement idempotency
- wrong mint rejection
- wrong vault rejection
- config epoch behavior
- paused machine behavior
- expired randomness refund

### Randomness Tests

- mock provider for deterministic local tests
- devnet provider integration
- fake randomness rejection
- stale randomness rejection
- multiple pending pulls
- settlement after delay

### Economic Tests

- 10,000 simulated pulls against sample weights
- inventory depletion
- common/rare tier distribution
- treasury reconciliation
- no negative inventory

### Frontend Tests

- wallet disconnected
- wallet not allowlisted
- insufficient USDC
- transaction rejected
- settlement pending
- prize revealed
- claim needed
- mobile wallet flow

### Ops Tests

- pause machine during pending pull
- resume machine
- retire machine
- withdraw unawarded prizes
- refund stuck pull
- rebuild Supabase cache from chain

## MVP Open Questions

1. What exact prizes are going into the first machine?
2. Are prizes onchain NFTs, redeemable NFTs, or physical card claims?
3. USDC only, or SOL too?
4. Pull price?
5. Max pulls per wallet/day?
6. Should odds be fully visible?
7. Who gets invite access?
8. Do we need anonymous/private UI access, or logged-in Collectiblez account plus wallet?
9. Should settlement be user-driven, backend-assisted, or both?
10. Is this strictly internal/testing until legal review?

## Recommended First MVP

Keep it narrow:

```text
One hidden devnet machine
USDC-dev payment token
3 to 5 NFT prizes
explicit wallet allowlist
transparent odds
Switchboard randomness
program-owned prize vault
manual admin index refresh
no public nav
no physical fulfillment
```

Then graduate to:

```text
private mainnet beta
real USDC
low-value prizes
small allowlist
full monitoring
legal-approved terms
```

## References

- Switchboard Solana/SVM Randomness: https://docs.switchboard.xyz/docs-by-chain/solana-svm/randomness
- Solana PDA docs: https://solana.com/docs/core/pda/pda-accounts
- Anchor PDA docs: https://www.anchor-lang.com/docs/basics/pda
- Anchor token account docs: https://www.anchor-lang.com/docs/tokens/basics/create-token-account
- Solana wallet adapter lesson: https://solana.com/developers/courses/intro-to-solana/interact-with-wallets
