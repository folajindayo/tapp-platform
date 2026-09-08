# Deploying Tapp

Two deployables, two hosts, one branch.

| What | Where | Deploys when |
|---|---|---|
| API (`apps/api`, Go) | Railway, project `tapp-platform`, service `api` | `main` changes under `apps/api/` and `ci` is green |
| PWA (`apps/pwa`, Next.js) | Vercel, project `tapp-pwa`, root directory `apps/pwa` | `main` changes under `apps/pwa/` or the workspace files |

The merchant app ships through Expo and is not deployed from this repo.

## The flow

1. Push to `main` (or merge a PR).
2. `.github/workflows/ci.yml` builds, vets and tests the API against a real
   Postgres and Redis, and typechecks, tests and builds the PWA.
3. Vercel's GitHub integration builds the PWA from `main` on its own. Commits
   that touch neither `apps/pwa` nor the workspace files are skipped.
4. `.github/workflows/deploy-api.yml` runs after `ci` succeeds on `main` and
   runs `railway up` for the API. It needs the `RAILWAY_TOKEN` secret; until
   that exists it skips itself and says so in the run summary.

Manual equivalents, from a linked checkout:

```bash
railway up --service api --path-as-root apps/api --ci   # API
vercel deploy --prod --yes                               # PWA, from the repo root
```

## What boots, and what refuses to

The API brings its own schema: on every boot it runs ent's auto-migration,
then the embedded ledger migrations and seed rows, under one advisory lock.
Nothing is run by hand before a deploy. A database from an older binary is
migrated forward.

The API refuses to start, with a message naming the variable, when any of
these is missing or too short: `WALLET_MASTER_KEY`, `SECRET`,
`JWT_SIGNING_KEY`, `BASE_DEPOSIT_SEED` (when deposits are on), a partial CDP
configuration. A boot that succeeds with a weak secret is worse than one that
fails, so those are fatal on purpose.

The PWA needs `NEXT_PUBLIC_API_BASE_URL` at build time. Without it the bundle
is produced, but every request fails with a message that names the variable,
and the server-side proxy routes answer 503 with the same message.

## Environment: Railway (`api` service)

`apps/api/.env.example` documents every variable. The ones production needs:

| Variable | What | Source |
|---|---|---|
| `DATABASE_URL` | Postgres | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | Redis | `${{Redis.REDIS_URL}}` |
| `ENVIRONMENT` | `production` | |
| `DEBUG` | `false` (gin release mode) | |
| `SECRET`, `JWT_SIGNING_KEY` | ≥32 chars each | `openssl rand -hex 32` |
| `WALLET_MASTER_KEY` | seals custodied keys at rest | `openssl rand -hex 32` |
| `BASE_DEPOSIT_SEED` | derives deposit addresses | `openssl rand -hex 32`, back it up |
| `BASE_TREASURY_KEY` | private key of the treasury wallet | generated once, back it up |
| `BASE_RPC_URL`, `BASE_CHAIN_ID`, `BASE_USDC_CONTRACT` | Base mainnet: `8453`, USDC `0x8335…2913` | |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `CDP_PAYMASTER_URL` | smart accounts and sponsored gas; all four or none | Coinbase Developer Platform |
| `FX_SOURCES`, `FX_SPREADS`, `FX_MAX_DEVIATION` | rate providers (Paycrest) and spreads | |
| `FINTAVA_BASE_URL`, `FINTAVA_API_KEY`, `FINTAVA_WEBHOOK_SECRET` | naira accounts, payouts, KYC | Fintava |
| `EMAIL_PROVIDER`, `EMAIL_DOMAIN`, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS` | verification and recovery mail | provider |
| `ANTHROPIC_API_KEY`, `VISION_MODEL` | cash note recognition; routes are off without it | Anthropic |
| `ADMIN_API_TOKEN` | gates card issuing; the PWA sends the same value | `openssl rand -hex 24` |
| `HOST_DOMAIN` | the API's own host, for card links | Railway domain |
| `PWA_BASE_URL`, `CHECKOUT_BASE_URL` | the browser origins allowed by CORS, and where links point | Vercel domain |

### Fintava webhooks arrive second-hand

Fintava allows one webhook URL per merchant, and it is registered to the
Zerocard backbone (`https://backbone.getzerocard.com/api/v1/webhooks/fintava`).
Backbone re-delivers every verified Fintava webhook, bytes and
`x-fintava-signature` header unchanged, to the URLs in its
`FINTAVA_WEBHOOK_FORWARD_URLS`; this API's `/v1/fintava/webhook` is one of
them. Because the bytes and the header are the originals, this API verifies
the HMAC with the same dashboard secret as if Fintava had called it directly:
`FINTAVA_WEBHOOK_SECRET` here is the same value as backbone's. Events for
accounts this API never issued are acknowledged and ignored, as backbone does
for ours.

Railway refuses empty values; leave a variable unset rather than blank.
`TRUSTED_PROXIES` and `ALLOWED_HOSTS` keep their `*` defaults behind Railway's
proxy. Never share `BASE_DEPOSIT_SEED`, `WALLET_MASTER_KEY` or `SECRET`
between two databases: two deployments deriving from one seed hand the same
deposit address to two different users.

## Environment: Vercel (`tapp-pwa`)

| Variable | Environments | What |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | production (previews if you want them to work) | the API, no trailing slash; compiled into the bundle |
| `ADMIN_API_TOKEN` | production, sensitive | must equal the API's |
| `ENABLE_EXPERIMENTAL_COREPACK` | all | `1`; without it Vercel ignores the pnpm 11 lockfile |
| `NEXT_PUBLIC_MAP_*` | optional | map tiles, see `apps/pwa/.env.example` |

## GitHub

| Secret | Used by |
|---|---|
| `RAILWAY_TOKEN` | `deploy-api.yml`. A Project Token for `tapp-platform` / production. |

## Checking a deploy

```bash
curl https://api-production-ce83.up.railway.app/health        # {"live":"ok"}
curl https://api-production-ce83.up.railway.app/v1/institutions/NGN | head -c 200
railway logs --service api | grep -E "applying migration|base:|fatal"
```

A healthy boot logs each migration it applied (none on a repeat boot) and
`base: new deposit addresses are CDP smart accounts on chain 8453, gas sponsored`.
