/**
 * withAndroidAutofillHighlight — sets android:autofillHighlightColor to transparent.
 *
 * Android 9+ (API 28) draws a yellow/orange overlay on any View that the
 * AutofillManager considers a candidate, even when importantForAutofill="no"
 * is set on individual inputs. This plugin patches the AppTheme in styles.xml
 * to set the highlight color to transparent app-wide, which is the only
 * reliable way to suppress it without touching each View in native code.
 *
 * Requires: expo prebuild (or expo run:android --clean) to take effect.
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ITEM = '<item name="android:autofillHighlightColor">@android:color/transparent</item>';

module.exports = function withAndroidAutofillHighlight(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const stylesPath = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res', 'values', 'styles.xml',
      );

      if (!fs.existsSync(stylesPath)) return config;

      let xml = fs.readFileSync(stylesPath, 'utf8');

      if (xml.includes('autofillHighlightColor')) return config;

      // Inject into the first <style> block (AppTheme).
      xml = xml.replace(
        /(<style\b[^>]*>)/,
        `$1\n        ${ITEM}`,
      );

      fs.writeFileSync(stylesPath, xml, 'utf8');
      return config;
    },
  ]);
};
