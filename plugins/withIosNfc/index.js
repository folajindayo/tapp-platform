/**
 * withIosNfc — Expo config plugin that turns on iOS Core NFC for the
 * Tap Card reader flow.
 *
 * Does three things during `expo prebuild`:
 *   1. Ensures `com.apple.developer.nfc.readersession.formats = [NDEF, TAG]`
 *      lands in the app entitlements (so the device will hand us
 *      NFCNDEFReaderSession and NFCTagReaderSession sessions).
 *   2. Ensures `NFCReaderUsageDescription` is set in Info.plist (App Store
 *      submission rejects without it).
 *   3. Adds the `com.apple.developer.nfc.readersession.iso7816.select-identifiers`
 *      array containing the standard NDEF Type 4 Tag AID (D2 76 00 00 85 01 01)
 *      and the NTAG215 application AID so cross-merchant cards are surfaced.
 *
 * Note: HCE on iOS isn't supported by Apple for third-party apps — payer-side
 * tap-to-broadcast stays Android-only. iOS merchants fall back to QR.
 */

const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const USAGE_DESCRIPTION = 'Read Tapp Cards to take payments instantly.';
const NDEF_AID = 'D2760000850101';
const NTAG_AID = 'A0000003960000';

function withIosNfcEntitlements(config) {
  return withEntitlementsPlist(config, (config) => {
    const entitlements = config.modResults;

    const formats = new Set(
      Array.isArray(entitlements['com.apple.developer.nfc.readersession.formats'])
        ? entitlements['com.apple.developer.nfc.readersession.formats']
        : [],
    );
    formats.add('TAG');
    entitlements['com.apple.developer.nfc.readersession.formats'] = Array.from(formats);

    return config;
  });
}

function withIosNfcInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    const plist = config.modResults;

    if (!plist.NFCReaderUsageDescription) {
      plist.NFCReaderUsageDescription = USAGE_DESCRIPTION;
    }

    const ids = new Set(
      Array.isArray(plist['com.apple.developer.nfc.readersession.iso7816.select-identifiers'])
        ? plist['com.apple.developer.nfc.readersession.iso7816.select-identifiers']
        : [],
    );
    ids.add(NDEF_AID);
    ids.add(NTAG_AID);
    plist['com.apple.developer.nfc.readersession.iso7816.select-identifiers'] = Array.from(ids);

    return config;
  });
}

module.exports = function withIosNfc(config) {
  config = withIosNfcEntitlements(config);
  config = withIosNfcInfoPlist(config);
  return config;
};
