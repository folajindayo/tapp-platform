# The SME Market

A regulated capital market where qualifying Nigerian SMEs raise capital by
issuing standardized digital securities, and investors discover, buy, hold,
trade and receive distributions on them.

This directory is the specification. It is written before the code, and the
code is expected to follow it or to amend it — not to diverge from it quietly.

## Reading order

The first three documents are load-bearing. Everything else is downstream of
them, and a change to any of them invalidates work built on top.

| # | Document | What it settles |
|---|---|---|
| 00 | [market-model.md](00-market-model.md) | What this market *is*, who is in it, the lifecycle, the component map, and the rules every other document inherits |
| 01 | [instrument.md](01-instrument.md) | What a security on this platform legally *is*, and why it is a unit in a vehicle rather than a share in the SME |
| 02 | [asset-ledger.md](02-asset-ledger.md) | The spine: securities live in the existing ledger as assets, so delivery-versus-payment is one balanced transaction |
| 03 | [admission.md](03-admission.md) | Objective admission requirements, the evidence behind each, and the listing state machine |
| 04 | [valuation-engine.md](04-valuation-engine.md) | How an issuance price is derived: deterministic, versioned, reproducible, defensible |
| 05 | [trading.md](05-trading.md) | Order types, the book, the matching engine, and why thin SME books trade in call auctions before they trade continuously |
| 06 | [clearing-settlement.md](06-clearing-settlement.md) | How a match becomes a settled trade, atomically, and what happens when it cannot |
| 07 | [price-and-oracle.md](07-price-and-oracle.md) | The market-price engine, its manipulation resistance, and the oracle that publishes it |
| 08 | [surveillance.md](08-surveillance.md) | Detecting wash trading, ramping, layering and insider dealing in books thin enough to move |
| 09 | [corporate-actions.md](09-corporate-actions.md) | Distributions, splits, further issuance, buybacks, delisting and default |
| 10 | [chain-layer.md](10-chain-layer.md) | Where tokenization sits, what it buys, and why it is kept out of the settlement path |
| 11 | [compliance.md](11-compliance.md) | The Nigerian regulatory map, investor eligibility, AML/CFT, and every parameter that needs counsel before launch |
| 12 | [audit.md](12-audit.md) | What "every important financial event is auditable" has to mean to be worth saying |

## Status

Phase 1 — the core product thesis — is specified here. Later phases will
deepen individual subsystems; where a phase is expected to land, the relevant
document says so and marks the open parameter rather than inventing a value.

Nothing here has been built. No schema has been migrated, no package created.
The specification is the deliverable.

## The inherited rule

This market is built inside the tapp platform, and inherits its one rule
unchanged:

> **The ledger is the authorization boundary.** Every movement of value is a
> balanced, double-entry transaction that sums to zero per currency, enforced
> by a deferred constraint trigger in Postgres rather than by convention.

The market extends that rule to securities rather than working around it, and
[02-asset-ledger.md](02-asset-ledger.md) is the argument for why that is both
possible and correct.
