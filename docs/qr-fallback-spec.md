# Tapp Merchant — QR Code Fallback (iOS phone-to-phone)

iOS does not allow third-party apps to perform NFC HCE (Host Card Emulation). The merchant's iPhone cannot act as an active NFC tag the payer reads on tap. Instead, the iOS merchant variant displays the same Zoracle checkout URL as a **QR code**; the payer scans it with their phone's camera and gets routed to the same checkout web flow.

Functionally equivalent to the Android HCE flow from the payer's POV — same URL, same checkout web, same downstream Rails handling. Only the merchant-side broadcast medium changes.

## When QR is used

- **iOS merchants always** for phone-to-phone (HCE is impossible on iOS).
- **Android merchants optionally** as a fallback if the device reports `android.hardware.nfc.hce` missing or the user has NFC disabled and won't enable it. Surfaced as a "Show QR instead" link on the broadcast screen.

## Payload

Identical to the HCE payload: `https://checkout.zoracle.com/order/<order_id>`, returned by `POST /v1/sender/me/tap`.

Encoded as a QR code, error-correction level **Q (25%)** — enough resilience for tilted scans, slight glare. Not L (7%) which is fragile.

## Library

**`react-native-qrcode-svg`** (v6.x). Reasons:

- Cross-platform, no native module dependencies.
- Renders via `react-native-svg` — sharp at any size, no bitmap blurring.
- Tiny API: `<QRCode value={url} size={300} ecl="Q" />`.
- Maintained, ~1k stars, no significant open bugs.

## Visual treatment

- **Size:** 280–320 dp square, dynamically sized to ~60% of viewport short edge.
- **Quiet zone:** 16dp minimum white margin (built into the library, but enforced by wrapping in a white card).
- **Foreground / background:** strict black on white. No brand-colour QR variants — those hurt scan reliability on mid-tier payer cameras.
- **Centre logo:** OPTIONAL. v1 ships without one (small `<Image>` overlay on QR codes reduces scan reliability by 5–10%; not worth it for marketing). Reconsider in v1.1 once we have launch volume data.

## Brightness

When the broadcast screen mounts, force screen brightness to **maximum** so the QR scans well in normal lighting. Restore the user's prior brightness when the screen unmounts.

Implementation: `expo-brightness`.

```ts
const prev = await Brightness.getBrightnessAsync();
await Brightness.setBrightnessAsync(1.0);
// ...on unmount:
await Brightness.setBrightnessAsync(prev);
```

## Broadcast screen (iOS variant)

```
┌──────────────────────────────────────────────────────┐
│  ←                                          1:47     │
│                                                      │
│                  Ready to receive                    │
│                                                      │
│                                                      │
│           ┌────────────────────────┐                 │
│           │ ███  █   █  ████   █ █ │                 │
│           │ █ █  █ ███  █  █  █ █  │                 │
│           │ ███   █ █   ████   █ █ │                 │
│           │ █   ██  █ █   █ █ █ █  │                 │
│           │   █ █ ███  ███ ███ ██  │                 │
│           │ ██ █ ██  ██ █ █  █ ██  │                 │
│           │ █ █ ███   █ ████ █ ██  │                 │
│           └────────────────────────┘                 │
│                                                      │
│                    ₦ 5,000                           │
│                                                      │
│                                                      │
│  Have your customer scan this QR with their camera.  │
│                                                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                  Cancel                        │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Same lifecycle as the Android HCE screen:

- Mount → fetch order from `POST /v1/sender/me/tap` → render QR + start countdown.
- On WS `payment.deposited` → swap copy to "Payment detected, settling…".
- On WS `payment.settled` → success screen.
- Back / cancel / expiry → `POST /v1/sender/orders/:id/cancel`, return to dashboard.

## Payer scan UX

Payers don't need an app:

- **iOS payer:** opens Camera app → frames QR → tap notification banner → URL opens in Safari.
- **Android payer:** opens Camera (Google or stock) → tap notification → URL opens in default browser.

Modern smartphones all auto-detect QR codes in their default camera apps from iOS 11 / Android 8 respectively. No need for a third-party scanner.

## Compared to HCE (Android merchant)

| Aspect                        | HCE (Android)            | QR (iOS / Android fallback) |
|-------------------------------|--------------------------|------------------------------|
| Payer interaction             | Tap device on device     | Open camera, frame QR        |
| Time to action (typical)      | ~1s                      | ~3–5s                        |
| Cross-device reliability      | Very high (NFC peer)     | High (depends on lighting)   |
| Requires payer's app          | No                       | No                           |
| Requires merchant unlocked    | Yes (screen on)          | Yes (app foreground)         |
| Works in direct sunlight      | Yes                      | Degraded; still usable       |
| Distance                      | Contact / ~1cm           | ~15–40cm typical             |

The HCE flow is faster for in-person quick-tap; QR is universally compatible.

## Out of scope (v1)

- BLE-based phone-to-phone as a second fallback. Adds RF licensing complexity for ~marginal benefit over QR.
- Dynamic QR animation (rotating colours, gif-style) — distracts from scan reliability.
- QR + HCE simultaneously on Android — visually noisy; one or the other.
- Sound-based fallback (ultrasonic data over speaker) — out-of-spec for payments.

## References

- `react-native-qrcode-svg`: <https://github.com/awesomejerry/react-native-qrcode-svg>
- `expo-brightness`: <https://docs.expo.dev/versions/latest/sdk/brightness/>
- QR code error correction levels: ISO/IEC 18004
