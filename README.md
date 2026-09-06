# tapp-platform

One product: a cash and card settlement layer for Nigeria.

A consumer holds a single balance. They fund it with physical cash handed to an
agent, an NGN bank transfer, or USDC on Base. They spend it by tapping a
contactless card at a merchant, transferring to a bank account, or taking cash
back out at an agent. A merchant accepts the tap on their phone and receives
NGN in their bank account.

```
apps/
  api/        Go — the settlement backend
  pwa/        Next.js — cardholder app
  merchant/   Expo — point-of-sale app
imports/
  tender/     source material being ported out; deleted at the end of Phase 4
```

## The one rule

**The ledger is the authorization boundary.** Every movement of value is a
balanced, double-entry transaction that sums to zero per currency, enforced by
a deferred constraint trigger in Postgres rather than by convention. Banks and
chains settle *behind* it, asynchronously.

Nothing else is allowed to decide that money moved. A card tap does not wait on
a block; a payout does not invent a transaction hash when the provider is
unreachable. A rail that cannot complete defers or fails — it never reports
success it did not observe.

## Getting started

```bash
pnpm install
docker compose up -d postgres redis     # postgres on 5433, redis on 6380
cp .env.example apps/api/.env           # then fill in the secrets
pnpm api:dev
```

`apps/api` refuses to start without `WALLET_MASTER_KEY`. That is deliberate:
it seals custodied private keys, and an earlier revision fell back to a literal
key committed to the repository whenever it was unset or malformed.

## History

The four source repositories were imported with their history via `git subtree`,
minus roughly 490MB of committed build artifacts, an APK and demo video. Commit
SHAs were rewritten by that filtering, so they do not match the originals.

Because subtree grafts commits with their *original* paths, a path-limited log
stops at the import merge. To reach the earlier history:

```bash
git log --all --oneline -- utils/crypto/wallet.go   # original path, not apps/api/...
git log --all --oneline | grep <what you remember>
```

Each source repository is tagged `pre-monorepo-import` at the commit that was
imported, so the mapping back is recoverable:

| Directory | Source | Tag |
|---|---|---|
| `apps/api` | `usezoracle/rails-sui` | `pre-monorepo-import` |
| `apps/pwa` | `usezoracle/tapp` | `pre-monorepo-import` |
| `apps/merchant` | `usezoracle/tapp-merchant` | `pre-monorepo-import` |
| `imports/tender` | `folajindayo/tender` | `pre-monorepo-import` |
