# The market model

## What this is

A capital market for Nigerian SMEs: businesses that meet objective admission
requirements issue standardized securities against a legally defined economic
interest, and investors buy, hold, trade and receive distributions on them
through a central order book with a deterministic matching engine.

## What this is not, and why the difference is structural

It would be easy to build an investment marketplace — a catalogue of businesses,
a "invest" button, a cap table spreadsheet, and a promise that someone will
help you sell later. Most SME investment products in the region are that. The
difference is not cosmetic, and it is worth naming precisely, because every
design decision downstream follows from it:

| | Marketplace | Capital market |
|---|---|---|
| Price is set by | the platform or the issuer | matched orders between participants |
| Exit is | negotiated, discretionary, often impossible | a standing order book |
| The instrument is | bespoke per deal | standardized, fungible within its class |
| The register is | a document | a live, balanced, auditable ledger |
| "What is it worth" | one number, from whoever issued it | two numbers that never touch: a valuation and a price |
| Failure mode | investors are stuck | investors get a bad price, which is a market working |

The load-bearing consequence: **the platform must be able to be wrong about
value without that being a defect.** A marketplace that mis-prices a business
has failed. A market that mis-prices a business has produced information. This
is why the valuation engine and the market-price engine are separate systems
that are forbidden from reading each other, and why nothing in this design lets
the platform's own opinion of a business set the price at which its securities
trade.

## Participants

| Party | Is | Does |
|---|---|---|
| **Issuer** | an admitted SME, and the vehicle that carries its economics | raises capital, reports, declares distributions |
| **Investor** | a KYC'd, eligibility-checked natural or legal person | subscribes, trades, holds, receives distributions |
| **Platform** | the operator of the market | admits, values at issuance, matches, clears, settles, surveils |
| **Custodian / trustee** | the party holding the underlying legal interest | holds the SME interest on behalf of unit holders |
| **Oracle consumer** | an approved downstream system | reads canonical prices under a published contract |
| **Regulator** | SEC Nigeria, and others | supervises; reads the audit record |

The platform is deliberately listed as a participant with duties rather than as
neutral plumbing. It matches, it clears, it holds client assets, and it
publishes prices. Each of those is a regulated function and a conflict to be
managed, not a technical detail. See [11-compliance.md](11-compliance.md).

## The lifecycle

```
   ISSUER SIDE                                    INVESTOR SIDE

   apply
     │
     ▼
   admission ─────── objective criteria, evidence-backed  (03)
     │                        │
     │                        └── refused → reasons, remediation, re-apply
     ▼
   valuation ─────── deterministic, versioned, reproducible  (04)
     │
     ▼
   instrument defined ─── legal wrapper, rights, unit count  (01)
     │
     ▼
   primary offer ◄──────────────────────────────── subscribe
     │                                                 │
     ▼                                                 ▼
   allocation & close ──── DvP: cash to issuer, units to investors  (06)
     │                                                 │
     ▼                                                 ▼
   LISTED ◄══════════════ order book opens ═══════► place orders  (05)
     │                            │                    │
     │                       matching                  │
     │                            │                    │
     │                       clearing & settlement ────┤          (06)
     │                            │                    │
     │                       trades ──► market price ──► oracle   (07)
     │                            │                    │
     │                       surveillance ◄────────────┘          (08)
     │
     ├── declares distribution ──► entitlement ──► paid to holders (09)
     ├── further issuance / split / buyback ─────► positions adjusted
     │
     ▼
   delisting or default ──────────────────────────► wind-down     (09)
```

## The rules

The platform's inherited rule is that the ledger is the authorization boundary.
The market adds four of its own. Each exists because a specific, plausible
failure would otherwise be possible.

### 1. A trade is one balanced transaction, or it did not happen

Securities and cash move in the same ledger transaction, so delivery-versus-
payment is not a protocol the platform implements but a property the database
enforces. There is no state in which an investor has paid and not received, or
received and not paid.

*Otherwise:* settlement becomes a two-phase dance between a cash ledger and a
position table, and the interesting bugs all live in the gap between them —
where they are, by construction, the hardest to find and the most expensive to
be wrong about. [02-asset-ledger.md](02-asset-ledger.md) is how this is done.

### 2. Valuation and price never read each other

The valuation engine consumes attested business fundamentals and produces a
figure used to strike the *primary issuance*. The market-price engine consumes
executed trades and produces a reference price. No edge runs in either
direction, at any cadence, through any cache.

*Otherwise:* the loop closes. A participant buys a small quantity in a thin
book, the market price rises, the valuation absorbs the price as evidence of
value, the higher valuation is published as the platform's own assessment, and
the participant sells into the credibility they just manufactured. Every
component in that loop behaves correctly. The loop is the defect, and the only
reliable fix is not to build the edge. See [07-price-and-oracle.md](07-price-and-oracle.md).

### 3. Matching is deterministic and replayable

The book is a fold over an ordered, append-only log of order events. Given the
same log, the engine produces the same trades, on any machine, at any later
date.

*Otherwise:* "why did my order not fill" and "was this trade fair" are
answerable only by inference from the outcome. In a regulated market those
questions get asked by people entitled to an answer, sometimes years later.
Determinism turns them from an investigation into a replay.

### 4. The chain is downstream of the ledger, always

Tokenization mirrors settled positions outward. It never tells the platform
that a trade occurred, never gates a match, and never sits in the settlement
path.

*Otherwise:* the market's liveness becomes a function of a block time and a gas
market, and its correctness becomes a function of a reorg. The platform already
learned this once: an earlier revision of this codebase routed settlement
through a chain and the entire Sui integration was subsequently retired.
See [10-chain-layer.md](10-chain-layer.md).

## Component map

```
                        ┌──────────────────────────────────────┐
   evidence ───────────►│  ADMISSION          (03)             │
                        │  objective criteria, states          │
                        └──────────────┬───────────────────────┘
                                       │ admitted
   attested financials ───────────────►│
                        ┌──────────────▼───────────────────────┐
                        │  VALUATION ENGINE   (04)             │
                        │  deterministic · versioned · audited  │
                        └──────────────┬───────────────────────┘
                                       │ issuance price
                        ┌──────────────▼───────────────────────┐
                        │  INSTRUMENT REGISTRY  (01)           │
                        │  legal wrapper · rights · units       │
                        └──────────────┬───────────────────────┘
                                       │
   orders ─────────────────────────────┼──────────────────────────────┐
                        ┌──────────────▼───────────────────────┐      │
                        │  ORDER BOOK + MATCHING  (05)         │      │
                        │  deterministic fold over event log    │      │
                        └──────────────┬───────────────────────┘      │
                                       │ matches                      │
                        ┌──────────────▼───────────────────────┐      │
                        │  CLEARING + SETTLEMENT  (06)         │      │
                        └──────────────┬───────────────────────┘      │
                                       │ one balanced transaction     │
                        ┌──────────────▼───────────────────────┐      │
                        │  THE LEDGER  (02)                    │      │
                        │  cash + securities · sums to zero     │      │
                        │  ══ the authorization boundary ══     │      │
                        └────┬────────────────────┬─────────────┘      │
                             │ settled trades     │ positions          │
              ┌──────────────▼──────┐   ┌─────────▼──────────┐         │
              │ MARKET PRICE  (07)  │   │ CORPORATE ACTIONS  │◄────────┤
              │ robust · manip-     │   │ (09)               │  issuer │
              │ resistant           │   └────────────────────┘  events │
              └──────────┬──────────┘                                  │
                         │                                            │
              ┌──────────▼──────────┐   ┌────────────────────┐         │
              │ ORACLE        (07)  │   │ SURVEILLANCE (08)  │◄────────┘
              │ published contract  │   │ reads all · halts   │
              └──────────┬──────────┘   └─────────┬──────────┘
                         │                        │
              approved consumers            alerts · halts · reports

              ┌─────────────────────┐   ┌────────────────────┐
              │ CHAIN MIRROR  (10)  │   │ AUDIT         (12) │
              │ downstream only     │   │ every event        │
              └─────────────────────┘   └────────────────────┘
                         ▲                        ▲
                         └── settled positions ───┘
```

Read the arrows as permissions, not just data flow. The absent arrows are the
design: nothing runs from market price back into valuation; nothing runs from
the chain mirror back into the ledger; surveillance reads the whole system and
writes only alerts and halts, never orders.

## The two surfaces

The thesis requires that an investor experience *discover → analyse → invest →
trade → receive distributions → sell*, with no exposure to the infrastructure
underneath. That is a constraint on the product surface, not a reason to hide
material facts.

**What the investor sees.** A business, its verified financials, what the
platform's valuation says and how it was derived, what the market is currently
paying, the spread and depth, their own position and its cost basis,
distributions received, and an order ticket. In naira, at all times.

**What the investor never has to see.** Wallets, keys, addresses, gas,
confirmations, token standards, contract addresses, bridges, the word
"blockchain" — and equally, ledger account kinds, matching internals, and the
oracle's aggregation window.

**What must never be hidden, whatever the surface looks like.** That an SME
security is illiquid and can lose all its value; that a quoted price came from
a thin book; who the counterparty risk sits with; what the platform charges;
and the fact that the platform both operates the market and publishes the
price. Simplicity in the interface is a design goal. Simplicity about risk is
mis-selling, and in a regulated market it is the kind that ends the licence.

## Non-goals

- **Not a lending product.** No credit is extended to investors. There is no
  margin, no leverage, no short selling; you cannot sell units you do not hold.
- **Not a public exchange.** This is a platform-operated market under a
  specific regulatory permission, not an NGX competitor.
- **Not a token launchpad.** The instrument is a security with defined rights
  against a real business. The chain layer is infrastructure, and a business
  that would fail admission does not become admissible by being tokenized.
- **Not a valuation authority.** The valuation engine produces a reproducible
  figure from stated inputs under a stated model. It is an opinion with its
  work shown, and the market is free to disagree with it — which is the point.
