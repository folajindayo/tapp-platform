/**
 * withNfcHce — Expo config plugin that installs the Tapp HCE service
 * into the prebuilt Android project.
 *
 * It does five things during `expo prebuild`:
 *   1. Adds a <uses-feature android:name="android.hardware.nfc.hce"/> tag.
 *   2. Registers `com.usezoracle.tappmerchant.hce.TappHceService` as a
 *      <service> in AndroidManifest.xml with the HostApduService
 *      intent-filter and the apduservice.xml metadata.
 *   3. Copies our Kotlin sources into android/app/src/main/java/...
 *   4. Drops `apduservice.xml` into android/app/src/main/res/xml/.
 *   5. Adds the two referenced strings into android/app/src/main/res/values/strings.xml.
 *
 * The plugin also patches MainApplication.kt to register
 * `NfcHcePackage()` with React Native's PackageList.
 */

const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
  withMainApplication,
  AndroidConfig,
} = require('expo/config-plugins');

const PACKAGE = 'com.usezoracle.tappmerchant.hce';
const SERVICE_CLASS = `${PACKAGE}.TappHceService`;
const SERVICE_DESCRIPTION = 'Tapp Merchant — Tap to receive payment';
const AID_GROUP_DESCRIPTION = 'Zoracle checkout URL (NDEF Type 4 Tag)';

function withHceManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const manifest = config.modResults.manifest;

    // <uses-feature android:name="android.hardware.nfc.hce" android:required="true"/>
    manifest['uses-feature'] = manifest['uses-feature'] ?? [];
    const hasHceFeature = manifest['uses-feature'].some(
      (f) => f.$['android:name'] === 'android.hardware.nfc.hce',
    );
    if (!hasHceFeature) {
      manifest['uses-feature'].push({
        $: { 'android:name': 'android.hardware.nfc.hce', 'android:required': 'true' },
      });
    }

    // <service> entry
    app.service = app.service ?? [];
    const alreadyAdded = app.service.some((s) => s.$['android:name'] === SERVICE_CLASS);
    if (!alreadyAdded) {
      app.service.push({
        $: {
          'android:name': SERVICE_CLASS,
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_NFC_SERVICE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.nfc.cardemulation.action.HOST_APDU_SERVICE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.nfc.cardemulation.host_apdu_service',
              'android:resource': '@xml/apduservice',
            },
          },
        ],
      });
    }
    return config;
  });
}

function withHceStrings(config) {
  return withStringsXml(config, (config) => {
    config.modResults = AndroidConfig.Strings.setStringItem(
      [
        { $: { name: 'tapp_hce_service_description', translatable: 'false' }, _: SERVICE_DESCRIPTION },
        { $: { name: 'tapp_hce_aid_group_description', translatable: 'false' }, _: AID_GROUP_DESCRIPTION },
      ],
      config.modResults,
    );
    return config;
  });
}

function withHceSources(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const root = config.modRequest.platformProjectRoot;
      const javaRoot = path.join(root, 'app', 'src', 'main', 'java', ...PACKAGE.split('.'));
      const resXml = path.join(root, 'app', 'src', 'main', 'res', 'xml');
      const srcDir = path.join(__dirname, 'android');

      fs.mkdirSync(javaRoot, { recursive: true });
      fs.mkdirSync(resXml, { recursive: true });

      for (const name of ['TappHceService.kt', 'NfcHceModule.kt', 'NfcHcePackage.kt']) {
        fs.copyFileSync(path.join(srcDir, name), path.join(javaRoot, name));
      }
      fs.copyFileSync(path.join(srcDir, 'apduservice.xml'), path.join(resXml, 'apduservice.xml'));
      return config;
    },
  ]);
}

function withHcePackageRegistration(config) {
  return withMainApplication(config, (config) => {
    const importLine = `import ${PACKAGE}.NfcHcePackage`;
    const addCall = 'add(NfcHcePackage())';
    let src = config.modResults.contents;

    if (!src.includes(importLine)) {
      src = src.replace(
        /(package [^\n]+\n)/,
        `$1\n${importLine}\n`,
      );
    }

    // Insert add(NfcHcePackage()) into the packages list. Looks for the
    // generated `packages.add(...)` block or `apply { ... }` style.
    if (!src.includes(addCall)) {
      if (src.includes('val packages = PackageList(this).packages')) {
        src = src.replace(
          /val packages = PackageList\(this\)\.packages\s*/,
          (m) => `${m}\n          packages.add(NfcHcePackage())\n`,
        );
      } else if (src.includes('PackageList(this).packages.apply')) {
        src = src.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (m) => `${m}\n              ${addCall}`,
        );
      }
    }

    config.modResults.contents = src;
    return config;
  });
}

module.exports = function withNfcHce(config) {
  config = withHceManifest(config);
  config = withHceStrings(config);
  config = withHceSources(config);
  config = withHcePackageRegistration(config);
  return config;
};
