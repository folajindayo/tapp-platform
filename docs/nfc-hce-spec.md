# Tapp Merchant — NFC HCE Spec

The merchant phone emulates an **NFC Forum Type 4 Tag** carrying a single NDEF URI record (the checkout URL). When the payer phone is tapped against the merchant device, the payer's OS reads the NDEF record and opens the URL in the default browser — no payer app needed.

## Why Type 4 + NDEF URI

- Type 4 (smartcard-style APDU exchange) is the only NFC tag type Android can reliably emulate via `HostApduService`. Type 1/2/3 emulation requires hardware support most phones don't have.
- A single URI record (NFC Forum URI RTD) is the simplest payload OS payer-side handlers know how to act on. iOS 14+ opens it from the lock screen with no app; Android opens it through whatever browser the user has set as default.
- AAR (Android Application Record) is **not** used — there's no payer app to invoke.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  RN layer                                            │
│  - broadcast.tsx screen                              │
│  - useTapBroadcast() hook                            │
│  - NfcHce native module bridge (TypeScript)          │
└────────────────────┬─────────────────────────────────┘
                     │ TurboModule call: start/stop(url, ttlMs)
                     ▼
┌──────────────────────────────────────────────────────┐
│  Native Android module (Kotlin, under              │
│  modules/expo-nfc-hce/)                            │
│                                                      │
│  ┌─────────────────────────┐  ┌──────────────────┐  │
│  │ NfcHceModule.kt         │  │ TappHceService   │  │
│  │ - Expo TurboModule      │──│  (HostApduService│  │
│  │ - manages foreground    │   │  registered in   │  │
│  │   service lifecycle     │   │  AndroidManifest)│  │
│  │ - shares the current    │   │ - responds to    │  │
│  │   NDEF bytes via        │   │   SELECT_AID +   │  │
│  │   companion-object slot │   │   ReadBinary     │  │
│  └─────────────────────────┘   │   APDUs          │  │
│                                └──────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Files (Phase 5 / Phase 7 of the plan)

```
modules/expo-nfc-hce/
  expo-module.config.json
  src/
    NfcHceModule.ts            // TS facade: start(url, ttlMs), stop(), isAvailable()
  android/
    src/main/AndroidManifest.xml
    src/main/res/xml/apduservice.xml
    src/main/java/com/usezoracle/tappmerchant/hce/
      NfcHceModule.kt
      TappHceService.kt
      Ndef.kt                  // encodes URL → NDEF bytes
plugins/
  withNfcHce/                  // Expo config plugin
    index.ts                   // injects manifest entries + permissions at prebuild
```

## AndroidManifest entries (injected by the config plugin)

```xml
<uses-permission android:name="android.permission.NFC"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE"/>
<uses-feature android:name="android.hardware.nfc" android:required="true"/>
<uses-feature android:name="android.hardware.nfc.hce" android:required="true"/>

<service
    android:name=".hce.TappHceService"
    android:exported="true"
    android:permission="android.permission.BIND_NFC_SERVICE"
    android:foregroundServiceType="connectedDevice">
  <intent-filter>
    <action android:name="android.nfc.cardemulation.action.HOST_APDU_SERVICE"/>
    <category android:name="android.intent.category.DEFAULT"/>
  </intent-filter>
  <meta-data
      android:name="android.nfc.cardemulation.host_apdu_service"
      android:resource="@xml/apduservice"/>
</service>
```

`res/xml/apduservice.xml`:

```xml
<host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/hce_service_description"
    android:requireDeviceUnlock="false">
  <aid-group android:description="@string/aid_group_description" android:category="other">
    <!-- NFC Forum Type 4 Tag NDEF Tag Application AID -->
    <aid-filter android:name="D2760000850101"/>
  </aid-group>
</host-apdu-service>
```

The AID `D2760000850101` is the standard NDEF Type-4 Tag Application — what every payer phone's stack expects when it wants to read an NDEF tag.

## APDU exchange

When the payer's reader selects our AID, Android invokes `TappHceService.processCommandApdu(apdu, extras)`. We implement the Type 4 read flow:

1. **SELECT AID** (`00 A4 04 00 07 D2 76 00 00 85 01 01 00`) → respond `90 00` (success).
2. **SELECT CAPABILITY CONTAINER** (`00 A4 00 0C 02 E1 03`) → respond `90 00`.
3. **READ BINARY (CC)** (`00 B0 00 00 0F`) → respond with the 15-byte Capability Container + `90 00`. The CC declares max R-APDU size and points the reader at the NDEF file ID (`E1 04`).
4. **SELECT NDEF FILE** (`00 A4 00 0C 02 E1 04`) → respond `90 00`.
5. **READ BINARY (NDEF length)** (`00 B0 00 00 02`) → respond with the 2-byte big-endian NDEF length + `90 00`.
6. **READ BINARY (NDEF body)** (`00 B0 00 02 <len>`) → respond with the NDEF bytes + `90 00`.

Any other APDU → respond `6A 82` (file not found) so misbehaving readers don't hang.

A single `byte[]` slot on `TappHceService` companion holds the current NDEF payload. `NfcHceModule.start(url, ttlMs)` encodes the URL via `Ndef.encodeUri(url)` and writes it to the slot. `stop()` clears it. The HCE service reads from the slot on each APDU.

## NDEF encoding

For `https://checkout.zoracle.com/order/ord_abc`:

```
NDEF Message:
  [Record 0]
    MB=1 ME=1 CF=0 SR=1 IL=0 TNF=001 (well-known)
    type length:    1
    payload length: <varies>
    type:           "U"
    payload:        [0x04] + "checkout.zoracle.com/order/ord_abc"
                    (URI prefix byte 0x04 = "https://")
```

The Ndef.kt helper exposes:

```kotlin
object Ndef {
  fun encodeUri(uri: String): ByteArray {
    val prefix = uriPrefix(uri)            // returns (byte, remainderString)
    val payload = byteArrayOf(prefix.code) + prefix.remainder.toByteArray(Charsets.UTF_8)
    val header  = byteArrayOf(
      (0xD1).toByte(),                     // MB=1 ME=1 SR=1 TNF=001
      0x01,                                // type length
      payload.size.toByte(),               // payload length
      'U'.code.toByte()                    // type
    )
    return header + payload
  }
}
```

We also produce the Type 4 wrapper (CC file + NDEF file) once per `start()` call and cache it on the service. The wrapper is what the APDU handler reads back.

## Lifecycle

- **Start:** `broadcast.tsx` mounts → `useTapBroadcast({orderId, checkoutUrl, expiresAt})` → `NfcHceModule.start(checkoutUrl, ttlMs)` → native module writes NDEF into the service slot AND starts a foreground service with a small notification ("Tapp is ready to accept payment"). Foreground notification is required on Android 14+ for HCE outside the Apple-Pay-equivalent default-payment-app slot.
- **Stop triggers:**
  - User backs out of the broadcast screen → `useEffect` cleanup → `NfcHceModule.stop()`.
  - `expires_at` countdown reaches zero → hook auto-stops → app calls `POST /v1/sender/orders/:id/cancel`.
  - WebSocket reports `payment.settled` or `payment.refunded` → hook stops, navigate to success/error.
  - App backgrounded → `useFocusEffect` cleanup; HCE stops because the foreground notification is tied to our process.

## Constraints + gotchas

- **Default payment app:** Android dispatches HCE service-by-AID-by-category. Our AID is in category `other` (not `payment`, which is reserved for true payment cards and triggers user prompts). `other` AIDs work without making us the device's default payment app — important because we don't want to clash with Google Wallet.
- **`requireDeviceUnlock=false`** means HCE works on the lock screen IF the user's screen is on and unlocked enough to wake. Payer experience parity with Apple Pay / tap-to-go cards relies on this.
- **Foreground service notification is non-dismissable** while broadcasting. Acceptable UX — it visually mirrors the "Tap to Pay is active" indicator on modern POS terminals.
- **HCE is single-tap-at-a-time.** If two payers tap in quick succession before WS reports settle, the second tap still gets the same checkout URL → would create a second payment for the same order. The checkout web must guard against double-claim; the merchant app additionally stops HCE on first `payment.deposited` (not just `settled`) to shorten the race window.
- **Battery-saver mode** can suppress foreground services. If the user has aggressive battery optimisation on, HCE may stop. Phase 7 adds an onboarding prompt to whitelist the app in Android battery settings.
- **APDU MTU:** R-APDUs cap at ~261 bytes; our NDEF payload (~75 bytes for a typical checkout URL) fits comfortably in one READ BINARY. No fragmentation logic needed.

## Why a custom native module instead of `react-native-hce`

The community package works for basic NDEF emulation but is unmaintained at the Android-14 service-type and foreground-notification policy changes. Our requirements are narrow (one NDEF URI record, foreground only), so a thin in-house module is less risk than the upstream surface. ~250 lines of Kotlin all in.

## Testing

- **Unit (Kotlin):** golden-file tests for `Ndef.encodeUri` against known good byte sequences from the NFC Forum spec.
- **Instrumented (Android emulator):** the emulator supports HCE; pair with an Android-virtual-device "reader" or run on a physical Pixel + a second NFC phone.
- **Field test:** Pixel 6 broadcaster + iPhone 13 reader → URL opens in Safari. Repeat with Samsung S22 reader → URL opens in Chrome. Use the NXP TagInfo app to dump the NDEF bytes and confirm they match the encoder's output.

## References

- Android HCE: <https://developer.android.com/develop/connectivity/nfc/hce>
- NFC Forum Type 4 Tag Operation Spec
- NFC Forum URI RTD Spec
- Foreground service types (Android 14+): <https://developer.android.com/about/versions/14/changes/fgs-types-required>
