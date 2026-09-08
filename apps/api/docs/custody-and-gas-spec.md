# Custody and gas

Two subsystems, specified together because they share one boundary: the place
where this platform holds the authority to move value on a chain.

Prior art is `zerocard-kms` and `zerocard-gas-sponsorship`. Both are read
carefully below — several of their ideas are kept, and the places they fall
down are exactly where tapp can do better, because tapp already has the one
thing neither of them has: a real ledger.

## 1. What is actually being protected

Three pieces of key material exist today, and all three are loaded from
`.env` into the API process:

| Secret | Controls | Blast radius if the API process is compromised |
|---|---|---|
| `BASE_DEPOSIT_SEED` | every user deposit address, by BIP-32 derivation | every deposit not yet swept, and every future deposit |
| `BASE_TREASURY_KEY` | the treasury that holds swept funds and pays withdrawals | everything the platform holds on chain |
| `WALLET_MASTER_KEY` | seals `users.encrypted_private_key` at rest | every custodied user key |

One remote code execution against `apps/api` yields all three. That is the
problem a KMS exists to solve, and it is worth stating plainly rather than in
the language of threat-model tables: **today, the thing that signs and the
thing that parses untrusted HTTP input are the same process.**

## 2. What the prior art gets right

Neither service is a strawman. These are kept:

- **Policy, pricing and execution are separate.** A sponsorship decision, the
  price of it, and the act of signing are three different concerns with three
  different failure modes. `zerocard-gas-sponsorship` splits them cleanly.
- **Hot-wallet isolation with a hard cap.** A gas wallet is capped so that
  losing one costs a bounded amount. Blast radius is designed, not hoped for.
- **A refill-rate guard.** Automated replenishment without a rate limit is an
  attacker's drain loop: force spend, trigger refill, repeat.
- **Short-TTL estimate caching.** A gas quote that outlives the price it was
  built on is a free option written against the platform.
- **Tiered approval for large signings.** Above a threshold, one process
  should not be able to authorise alone.
- **A tamper-evident audit chain.** `H_n = SHA-256(seq ‖ event ‖ actor ‖
  details ‖ H_{n-1} ‖ ts)` makes silent deletion detectable.
- **Emergency seal.** `MasterKeyProvider.seal()` zeroizes the working copy and
  refuses to sign until an operator intervenes. tapp has no equivalent today.
- **The EIP-7702 analysis is correct.** Delegating an EOA per-transaction
  avoids the per-user smart-account deployment cost that plain ERC-4337
  imposes. If user-sponsored transactions are ever needed, that is the route.

## 3. Where it falls down, and why tapp can do better

Each of these is a specific, checkable defect — not a matter of taste.

### 3.1 The accounting ledger is not a ledger

`packages/database/src/index.ts:213` — `gasAccountingLedger = new Map<string,
GasAccountingRecord>()`, and profit is `user_charge_usd - actual_gas_cost_usd`
computed per row. Nothing forces the books to balance, nothing survives a
restart, and "how much has sponsorship cost us" is answerable only by trusting
a number some code wrote down.

tapp already enforces the alternative in the database: every movement is a
balanced set of entries summing to zero per currency, checked by a deferred
constraint trigger that a bug cannot bypass. **Gas becomes movements.** The
cost of a sponsored transaction is not a field, it is entries — and if they do
not balance, the transaction does not commit.

### 3.2 Policy limits live in process memory

`packages/policy-engine/src/index.ts:51` — `private userLimits = new Map<...>()`.
Two consequences, both serious:

- **Restart clears every daily cap.** A user at their limit is back to zero.
- **N replicas enforce N × the cap.** The "$1/day new user" limit is per
  process, so horizontal scaling multiplies the exposure it was written to
  bound. The limit reads as a control and behaves as a suggestion.

The stores added later (`gas-wallet.store.ts`, `gas-funding.store.ts`) *are*
Postgres-backed, which makes the inconsistency worse rather than better: some
state survives a restart and some does not, and which is which is not visible
from the outside.

### 3.3 The audit chain does not survive a restart

`src/modules/audit/audit-ledger.service.ts:7` — `private ledger:
AuditLogRecord[] = []`. A hash chain proves that history has not been edited.
A hash chain held in memory proves nothing, because there is no history: the
process restarts and the chain begins again at genesis with no gap visible.
`verifyIntegrity()` will happily report a clean chain over an empty one.

### 3.4 The key derivation is non-standard, and worse than tapp's

`wallet-key.service.ts:87` — `seed = HMAC-SHA256(masterSalt, "${userId}_${chain}")`.
Four problems:

1. **Not BIP-32/BIP-44.** No standard tool can re-derive these keys. Recovery
   depends on this exact source file continuing to exist and behave identically
   forever. tapp derives `m/44'/60'/0'/0/n`, which any hardware wallet or
   library can reproduce from the seed alone.
2. **The salt is a UTF-8 string** (`Buffer.from(masterSalt, 'utf8')`), and the
   only check is `length < 32` — that is *character* length, not entropy. A
   32-character human-chosen salt is far short of 256 bits. tapp's seed is 32
   raw bytes of hex, validated as such.
3. **The HMAC output is used directly as a secp256k1 scalar** with no rejection
   sampling. The code correctly throws when the scalar is out of range rather
   than papering over it, but that means an unlucky `(userId, chain)` pair is
   *permanently underivable* — that user can never have a wallet. BIP-32
   specifies incrementing the index instead, and tapp inherits that.
4. **Keyed on `userId`.** A user id that ever changes — a merge, a migration —
   orphans the funds at the old address.

**tapp's existing derivation is already better. It stays.** This is the clearest
case of the prior art being the wrong thing to copy.

### 3.5 "Hardware isolation" is a Node Buffer

The README promises a "Secure Key Environment (Zero Key Exposure Isolation)"
and "hardware isolation signing". The implementation is a `Buffer` held in the
memory of an ordinary Node process. The zero-trust threat model states
"Backend Compromised: attacker has arbitrary RCE on application servers" — but
RCE on the KMS process yields the salt, and therefore every key.

The honest version of this claim is narrower and still valuable: **the KMS is a
separate process with a small, audited surface, so compromising the large
surface (the API) does not directly yield keys.** That is a real gain. It is
not hardware isolation, and calling it that discourages the work that would
make it true.

## 4. Design

### 4.1 The boundary

Build both as packages inside `apps/api`, not as separate deployables:

```
internal/custody/        the signing boundary
  keyring.go             derivation + in-process key handling, sealed
  signer.go              sign(intent) -> signature; the only way to sign
  policy.go              what may be signed, by whom, up to what value
  approval.go            quorum for anything above the threshold
  audit.go               append-only, hash-chained, in Postgres

internal/chain/gas/      making on-chain operations possible
  need.go                does this operation need gas, and how much
  sponsor.go             fund it, or route around needing it
  wallets.go             sponsor wallets, caps, refill guard
```

**Why in-process rather than a separate service, when §1 argued for a
boundary?** Because a boundary that is not yet enforced by a process is still
worth defining, and defining it first is what makes extracting it later a
move rather than a rewrite. Every signing call goes through `custody.Signer`
from day one; no handler touches key material. When the boundary is worth a
process, the interface is already the network interface. Standing up an HTTP
service on day one, before anything calls it correctly, buys a deployment unit
and no safety.

This is also the honest reading of the prior art: `zerocard-kms` is a separate
service, and its separation does not currently buy what its README claims.

### 4.2 Gas costs post to the ledger

The differentiating decision. A sponsored transaction is a real cost in a real
currency, so it is a movement:

```
revenue (system) USD   -cost        gas.sponsored
payable (system) USD   +cost        gas.owed_to_sponsor_wallet
```

and when the platform recovers it from the user:

```
user available   USD   -charge      gas.recovered
revenue (system) USD   +charge      gas.fee
```

The margin is then not a computed field but the difference between two account
balances that the database guarantees are consistent. "What has sponsorship
cost us this month" becomes a ledger query, and `ledger.Audit` already reports
whether the whole system balances.

Nothing outside `internal/ledger/movements` may post these, per the existing
rule: *a handler that assembles its own entries is a handler that can invent a
movement nobody reviewed.*

### 4.3 Policy and limits in Postgres, not memory

One table, one row per user per window, with the window advanced by comparison
rather than by a timer:

```sql
CREATE TABLE gas_sponsorship_limits (
    user_id      uuid PRIMARY KEY,
    window_start timestamptz NOT NULL,
    spent_minor  bigint      NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
    currency     currency    NOT NULL
);
```

Spend is claimed with `UPDATE ... WHERE spent_minor + $cost <= $cap RETURNING`,
so the cap is enforced by the database under concurrency rather than by a
read-then-write in one replica's memory. Ten API instances share one limit.

### 4.4 Audit that survives

Append-only Postgres table, hash-chained exactly as `zerocard-kms` describes,
but persisted — and with the one addition that makes the chain meaningful:
the head hash is recorded on every append, so a truncated table is detectable
by a chain that no longer reaches the recorded head. An in-memory chain cannot
do this; a persisted one that never records its head cannot either.

### 4.5 The gas problem tapp actually has

Before building sponsorship, note what needs sponsoring. Users here never sign
on-chain — the ledger is the authorization boundary and the chain is
downstream. The real gas consumer is the **sweeper**: it signs with a derived
deposit-address key (`sweeper.go:116`) and those addresses hold no ETH, so
every sweep above `MinSweepMicro` fails for want of gas. Currently masked only
because `BASE_TREASURY_KEY` is empty and `CanSend()` is false.

**USDC on Base supports EIP-2612 `permit`** — verified against the mainnet
contract (`DOMAIN_SEPARATOR()` and `nonces(address)` both answer). So the
sweeper can:

1. sign a `permit` off-chain with the derived key — free, no ETH needed;
2. have the **treasury** submit `permit` + `transferFrom`, paying gas from the
   one key that is already funded.

Deposit addresses never need gas at all. This deletes the majority of the
sponsorship problem rather than building infrastructure to manage it — and by
the repo's own standard, a component that cannot be justified should be
dropped. Sponsorship is then built only for what genuinely remains.

## 5. What is deliberately not built

- **ERC-4337 bundler + paymaster.** It sponsors transactions from smart
  accounts that users control. tapp users hold no on-chain account; the
  ledger holds their balance. It would add an EntryPoint, a bundler to run or
  trust, a funded paymaster, and a per-user account deployment cost, to reach
  where `permit` already reaches. Revisit only if self-custody ships — and
  then via EIP-7702, for the reasons the prior art's own analysis gives.
- **Multi-chain.** The prior art carries Solana and Stellar adapters. tapp is
  Base and NGN. A chain abstraction with one chain behind it is a cost with
  no benefit.
- **A profit-margin engine.** Margin falls out of two ledger balances.

## 6. Open decisions

1. **Sponsor-wallet cap.** The prior art uses $500. tapp's figure should come
   from what a sweep actually costs on Base times a sensible float, not from
   a round number carried over.
2. **Approval quorum threshold**, and who the second approver is. A quorum
   with one operator is not a quorum.
3. **Whether the KMS boundary becomes a process**, and when. The spec makes it
   an interface first; the trigger for extraction should be named now.
4. **Whether user-recovered gas is charged at all.** §4.2 supports it, but a
   platform that sweeps its own deposits is paying its own cost of doing
   business, and charging for it may be the wrong model.

## 7. First step

Not the KMS and not the sponsor. **The permit-based sweep**, because it is the
one thing that is currently broken, it is small, and it removes most of the
problem the rest of this document is about.
