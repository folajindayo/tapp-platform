# Tapp Merchant — NFC Reader Spec (Tap Card / NTAG215)

The merchant app reads a customer's physical NTAG215 NFC card to take payment. Works on **both Android and iOS** via `react-native-nfc-manager`, which wraps `NfcAdapter` on Android and `NFCNDEFReaderSession` / `NFCTagReaderSession` on iOS.

Distinct from the Android HCE flow (see `nfc-hce-spec.md`) — that's the merchant phone *broadcasting* an NDEF tag. This doc is about the merchant phone *reading* one.

## NTAG215 baseline

- 504 bytes user memory.
- 7-byte unique UID, factory-burned, read-only.
- Supports NDEF storage (NFC Forum Type-2 Tag).
- Cheap (~$0.50 a card), widely available, used by Amiibo-style products so the supply chain is mature.
- No active power — read at distance ~3–5 cm; reliable contact-tap.

For Tapp's v1 we use **the UID alone** as the identifier. The merchant app does not need to read NDEF content from the card — the binding "UID → user's Sui zkLogin balance" lives server-side, set at card-linking time on the checkout web. Reading UID-only keeps the reader session as fast as possible (sub-200ms typical).

## What gets read

```
read({
  uid:    "04A3B2C1D5E6F7",     // 7 bytes, hex-encoded, uppercase, no separators
  tech:   "NfcA" | "Ndef",      // platform-reported tech
  atqa:   "0044",               // optional, Android only
  sak:    "00"                  // optional, Android only
}) → POST /v1/sender/me/tap-card { amount, card_uid }
```

The backend keys off `uid` only. The other fields are logged for diagnostics but ignored for routing.

## Library choice

**`react-native-nfc-manager`** (v3.x). Reasons:

- Single API, both platforms.
- Maintained: regular releases through 2025.
- Wraps the NTAG family correctly on both platforms.
- Returns the UID natively — no need to construct it from NfcA bytes ourselves.

Alternatives considered:

- **`react-native-nfc-rewriter`** — focused on writing tags; overkill for read-only.
- **Native modules per-platform** — full control but ~3x the surface area. Not justified for a read-only use case.

## Android specifics

### Permissions + manifest (injected by Expo config plugin)

```xml
<uses-permission android:name="android.permission.NFC"/>
<uses-feature android:name="android.hardware.nfc" android:required="true"/>
```

NFC must be enabled in system settings; otherwise the read returns a `NfcAdapter unavailable` error. If disabled, the app prompts the user with a deep link into Android's NFC settings (`Settings.ACTION_NFC_SETTINGS`).

### Reader API

```ts
import NfcManager, { NfcTech, NfcEvents } from 'react-native-nfc-manager';

async function readCard(): Promise<{ uid: string }> {
  await NfcManager.requestTechnology(NfcTech.NfcA);
  try {
    const tag = await NfcManager.getTag();        // ms 100-300
    const uid = (tag?.id ?? '').toUpperCase();
    if (!/^[0-9A-F]{14}$/.test(uid)) throw new Error('Invalid NTAG215 UID');
    return { uid };
  } finally {
    await NfcManager.cancelTechnologyRequest();
  }
}
```

The session is **foreground only**. No background tag detection.

### Reader-mode flags (foreground dispatch)

Use Android's foreground dispatch API exposed via `NfcManager.setEventListener(NfcEvents.DiscoverTag, ...)` so the OS routes tag events directly to our screen while it's mounted. Critical to keep `Settings → NFC` "Default payment app" dialogs from interfering — our reader-mode call temporarily overrides system tag dispatching.

### Edge cases

- **Multiple taps in quick succession:** debounce 1500ms in our screen logic so we don't read the same card twice.
- **Wrong tag type tapped (e.g. user holds up their phone):** reader returns a non-NTAG UID format; we surface "Not a Tapp Card" without sending a request.
- **NFC turned off mid-session:** caught via `NfcManager.setEventListener(NfcEvents.StateChanged, ...)` — auto-prompt to re-enable.

## iOS specifics

### Entitlement + Info.plist (injected by Expo config plugin)

Entitlement (must be enabled in the developer-account capability list AND in `ios/Tapp.entitlements`):

```xml
<key>com.apple.developer.nfc.readersession.formats</key>
<array>
  <string>NDEF</string>
  <string>TAG</string>
</array>
```

`NDEF` enables NFCNDEFReaderSession (works iPhone 7+); `TAG` enables NFCTagReaderSession (iPhone XS+, more control + can read raw UID on cards without NDEF content). We declare both.

Info.plist:

```xml
<key>NFCReaderUsageDescription</key>
<string>Read Tap Cards to take payments.</string>
```

User-visible string shown in the iOS system NFC sheet.

### Reader API (iOS)

iOS surfaces a **system-rendered NFC sheet** when a session starts. We can't show our own UI during a read — the OS owns the chrome ("Hold your iPhone near the card", animation, "Cancel" button). Our screen renders the contextual amount + instruction in the area above the sheet.

```ts
// Same react-native-nfc-manager API; under the hood it opens an
// NFCTagReaderSession with .iso14443 polling option (right for NTAG215).
await NfcManager.requestTechnology(NfcTech.MifareIOS, {
  invalidateAfterFirstRead: true,
  alertMessage: 'Hold the card to the top of your iPhone',
});
const tag = await NfcManager.getTag();
const uid = (tag?.id ?? '').toUpperCase();
```

iOS automatically dismisses its sheet on first successful read or on user-tapped Cancel.

### iOS gotchas

- **iPhone NFC antenna is at the TOP of the device**, not the back. We tell the merchant "Hold the top edge of your iPhone to the card" in the screen copy.
- **Session timeout:** iOS auto-invalidates after 60s of no detection — our screen UI mirrors this with a "Try again" affordance.
- **Background reads not allowed for non-NDEF/TAG sessions** — Tap Card reads only work while the merchant has the screen open.
- **NFC requires a physical device** for development — iOS Simulator does not emulate NFC.
- **Entitlement requires a paid Apple Developer account** ($99/yr). Dev-client builds for internal testing need an enterprise or organisation team.

## End-to-end (merchant POV)

```
1. Dashboard → New payment → enter amount → "Tap Card" method
2. App calls readCard()
   - Android: screen stays in our chrome; "Hold card to back of phone" instruction
   - iOS:     system NFC sheet appears; "Hold card to top of iPhone"
3. User presents card → UID captured (~200ms)
4. App calls POST /v1/sender/me/tap-card { amount, card_uid }
5. On `status: settled` response → "Payment received" success screen
   On `CARD_NOT_LINKED` / other error → screen-level error with guidance
6. Reader session cleaned up on screen unmount or successful settle
```

## Testing matrix

| Device class                  | Cards to test          | Expected behaviour          |
|-------------------------------|------------------------|-----------------------------|
| Pixel 7 (Android 14)          | NTAG215, NTAG213       | UID read in <300ms          |
| Samsung S22 (Android 13)      | NTAG215                | UID read in <300ms          |
| Old Android (Android 10)      | NTAG215                | UID read, slightly slower   |
| iPhone 13 (iOS 17)            | NTAG215, NTAG216       | System sheet → UID          |
| iPhone XR (iOS 16)            | NTAG215                | System sheet → UID          |
| iPhone SE (3rd gen, iOS 17)   | NTAG215                | System sheet → UID          |
| Any device, **non-NTAG tag**  | MIFARE Classic, etc.   | "Not a Tapp Card" error     |

## Future considerations (v2+)

- **Card programmability:** writing a `<package_id>::<uid>::link` reference URL onto the card's NDEF at link time, so even an unlinked NTAG read could prompt a user to register. v1 keeps cards blank (UID-only).
- **Background reads:** iOS supports background NDEF reads from iOS 14 if the tag has an `https://` NDEF URI written to it. Could be used for an "auto-pay on tap" UX. Out of scope for v1.
- **MIFARE DESFire** for higher-trust authentication scenarios (mutual auth, encrypted UID exchange). Not needed for Tapp's debit-cap model.

## References

- `react-native-nfc-manager`: <https://github.com/revtel/react-native-nfc-manager>
- Android NfcAdapter: <https://developer.android.com/reference/android/nfc/NfcAdapter>
- iOS CoreNFC: <https://developer.apple.com/documentation/corenfc>
- NTAG215 datasheet (NXP): <https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf>
