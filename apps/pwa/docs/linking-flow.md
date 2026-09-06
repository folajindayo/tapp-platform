# Linking flow — claim a fresh Tapp Card

Status: **DESIGN, AWAITING IMPLEMENTATION SIGN-OFF**
Last updated: 2026-05-22

This is the flow a cardholder runs once per card: tap a fresh card,
log in, fund the spending cap, set a PIN, walk away with a working
card. Everything afterward is just transactions.

PoC scope (NFC-Tools-written URLs) is a degenerate case of this flow:
the card already has the activation URL, but no `K`, no PWD lock,
no on-chain cap. Linking the PoC subset = "claim only" — flips
`status: issued → claimed` and binds `user_id`. Nothing more. The
full flow lands when the Move contract + Web NFC write logic are
greenlit.

---

## Two-act sequence

### Act 1 — Claim (PoC-shippable today)

```
User                  PWA                          Rails             Sui
 │  tap card           │                            │                 │
 │ ─OS opens URL──────▶│                            │                 │
 │                     │ /link?token=A7B2K9P3       │                 │
 │                     │ resolves token via         │                 │
 │                     │ GET /c/A7B2K9P3 ──────────▶│ 302 to PWA      │
 │                     │ ◀──────────────────────────│                 │
 │                     │                            │                 │
 │ "Sign in to claim"  │ render zkLogin button      │                 │
 │ tap button          │                            │                 │
 │ ───────────────────▶│                            │                 │
 │                     │ Google OAuth → zkLogin     │                 │
 │                     │ ephemeral KP + JWT         │                 │
 │                     │                            │                 │
 │                     │ POST /v1/cards/link/claim  │                 │
 │                     │   { token: A7B2K9P3 }      │                 │
 │                     │────────────────────────────▶│ flip status    │
 │                     │                            │ issued→claimed  │
 │                     │                            │ bind user_id    │
 │                     │ ◀──{ card_id, ... }─────────│                 │
 │                     │                            │                 │
 │ "Card claimed."     │                            │                 │
 │ continue to fund?   │                            │                 │
 │◀────────────────────│                            │                 │
```

PoC stops here. The card is associated with the user. Tapping it
again opens `/dashboard/cards/:id` (the "your card" page) for the
logged-in user, or "already claimed" for anyone else.

### Act 2 — Fund (post-PoC, gated on Move + Web NFC build)

```
User                  PWA                          Rails             Sui
 │ choose limits +     │ form: daily=₦40k,          │                 │
 │ PIN                 │ per_tap=₦2k, step_up=₦15k, │                 │
 │ ───────────────────▶│ PIN=••••                   │                 │
 │                     │                            │                 │
 │                     │ generate K (32B random)    │                 │
 │                     │ derive K' = HMAC(K, PIN)   │                 │
 │                     │ derive anchor =            │                 │
 │                     │   HMAC(K', "linking-anchor")│                │
 │                     │ derive verifier =          │                 │
 │                     │   HMAC(K, "verifier")      │                 │
 │                     │                            │                 │
 │ "Tap card to back   │                            │                 │
 │ of your phone"      │                            │                 │
 │  ◀───────────────────│                            │                 │
 │ taps card           │                            │                 │
 │ ───────────────────▶│ navigator.nfc.write(K)     │                 │
 │                     │ PWD_AUTH + set new PWD     │                 │
 │                     │ lock NDEF sector           │                 │
 │                     │                            │                 │
 │                     │ build PTB:                 │                 │
 │                     │   create_cap<USDC>(        │                 │
 │                     │     funding, daily,        │                 │
 │                     │     per_tap, uid_hash)     │                 │
 │                     │ zkLogin signs ──────────────▶ Sui (executeTx)│
 │                     │                            │ ──────────────▶ │ Move:
 │                     │                            │ ◀────tx_digest──│ create_cap
 │                     │                            │                 │
 │                     │ POST /v1/cards/link/       │                 │
 │                     │   complete                 │                 │
 │                     │   { card_uid_hash,         │                 │
 │                     │     cap_object_id,         │                 │
 │                     │     pin_verifier,          │                 │
 │                     │     linking_proof = anchor,│                 │
 │                     │     tx_digest }            │                 │
 │                     │────────────────────────────▶│ verify tx_digest│
 │                     │                            │ on-chain;       │
 │                     │                            │ persist row;    │
 │                     │                            │ flip status     │
 │                     │                            │ claimed→live    │
 │                     │ ◀──────────────────────────│                 │
 │                     │                            │                 │
 │ "Card is live"      │ show dashboard for         │                 │
 │ tap-to-pay anywhere │ the new card               │                 │
 │◀────────────────────│                            │                 │
```

After this, K, K', PIN, anchor are all wiped from PWA memory. Only
`pin_verifier` and `linking_proof` live server-side (and neither lets
anyone recover K or the PIN — see Rails spec Appendix A).

---

## Screen-by-screen

### `/link?token=…` — Step 1 of 4

If not signed in:
```
┌──────────────────────────────────────────┐
│              ZORACLE                     │
│                                          │
│         💳  You tapped a new card        │
│                                          │
│   Sign in to claim it as yours.          │
│                                          │
│        ┌──────────────────────────┐      │
│        │   Continue with Google   │      │
│        └──────────────────────────┘      │
│                                          │
│   Tip: this URL only works once.         │
│   Once claimed, no one else can take it. │
└──────────────────────────────────────────┘
```

If already signed in and token is valid + issued:
- Auto-call `POST /link/claim` with the JWT and the URL token
- Push to Step 2

If already claimed by *this* user:
- 302 to `/dashboard/cards/:id`

If already claimed by *another* user:
- Show "This card belongs to someone else." page

### `/link/configure` — Step 2 of 4 (post-PoC)

Form:
- Daily limit slider: ₦5k – ₦200k, default ₦40k (~$25)
- Per-tap limit (PIN threshold) slider: ₦500 – ₦5k, default ₦2k
- Step-up threshold slider: ₦5k – ₦50k, default ₦15k
- PIN input: 4 digits, hidden, confirm
- Funding amount: how much USDC to load into the cap (rate shown next to it)

CTA: "Tap your card to continue"

### `/link/write` — Step 3 of 4 (post-PoC)

Prompts for the NFC tap. Web NFC API call:
```ts
const ndef = new NDEFReader();
await ndef.write({
  records: [
    {
      recordType: 'mime',
      mediaType: 'application/zoracle-card-secret',
      data: K, // 32 bytes
    },
  ],
});
```
Then NTAG215 password-lock via raw command transceive (Web NFC
exposes `serial-number` + raw APDU; details in implementation
notes).

On any error: "Couldn't write to card. Try again? [Retry] [Cancel]".
On success: progress bar to Step 4.

### `/link/sign` — Step 4 of 4 (post-PoC)

zkLogin signs the `create_cap` PTB. Funded balance is taken from the
user's connected Sui wallet (their zkLogin-derived address). Pending
spinner with "Funding card on Sui…". On confirmation, redirect to
`/dashboard/cards/:id` with a confetti success state.

### `/dashboard/cards/:id` — Live card view

- Card visual (color, name, last 4 of UID hash, brand mark)
- Today's spend / daily limit
- Recent debits (last 10, with merchant name + amount)
- Top up button → `/cards/top-up`
- Resync button → `/cards/resync` (only enabled if recent token-mismatch)
- Revoke button → `/cards/revoke` (with confirm modal)

---

## API endpoints used (PWA → Rails)

| Method | Path                          | Body                                     | When |
| ------ | ----------------------------- | ---------------------------------------- | --- |
| POST   | `/v1/cards/link/claim`        | `{ token }`                              | PoC — Step 1 |
| POST   | `/v1/cards/link/complete`     | `{ card_uid_hash, cap_object_id, pin_verifier, linking_proof, tx_digest }` | Post-PoC — Step 4 |
| POST   | `/v1/cards/top-up`            | `{ card_id, amount_subunit }` → PTB to sign | Top-up screen |
| POST   | `/v1/cards/revoke`            | `{ card_id }` → PTB to sign              | Revoke screen |
| GET    | `/v1/cards/me`                | —                                        | Dashboard |

All require `Authorization: Bearer <zkLoginJWT>`.

---

## Error states

- **Token already claimed by you:** auto-redirect to that card's page.
- **Token already claimed by someone else:** terminal "this card
  belongs to someone else" page with a "report stolen card" link
  (PoC stance: link is a no-op, just a UX placeholder).
- **Token revoked / locked:** "this card is not available" with
  customer-support contact info.
- **NFC write failed:** retry up to 3 times, then offer "Use a
  different card" — no partial state on the server (write happens
  *before* the on-chain `create_cap`).
- **PTB signing failed:** the card is `claimed` but not `live`. PWA
  shows "Card not yet active — finish funding to use it." User can
  resume from `/link/configure` for that card.
- **Web NFC unsupported (iOS):** terminal page explaining the
  cardholder needs an Android Chrome browser to link. v1.5 plan: tiny
  native iOS app for linking + resync.

---

## Security notes (Act 2)

- `K` lives in JS memory for the duration of the write call only.
  Overwrite-then-`null` immediately after.
- `pin_verifier` and `linking_proof` get sent to the server, but
  neither alone (nor both together) lets anyone recover K or the
  PIN. Detail in `rails/docs/tapp-card-spec.md` Appendix A.
- `cap_object_id` is the only on-chain handle to the card's funded
  balance. User holds the destroy capability — Rails cannot reclaim
  funds. This is the load-bearing custody fact.
- NTAG215 password lock is *not* the security boundary — it's a
  speed-bump. The real boundary is K's secrecy (only on the card +
  briefly in PWA memory) and the on-chain cap's user-only destroy
  authority.
