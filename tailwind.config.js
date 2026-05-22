/**
 * Visual language mirrors users-app: brandGreen pill CTAs, near-black text
 * on white surfaces, clean grayscale ramp. Tokens kept in sync with
 * src/ui/theme.ts (which is the source of truth for places NativeWind
 * can't reach — Reanimated animated styles, StyleSheet-only Native
 * primitives, etc.).
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#40FF00',
          blue: '#2775CA',
        },
        ink: {
          true: '#000000',
          DEFAULT: '#121212',
          800: '#1F1F1F',
          700: '#333333',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FAFAFA',
          bg: '#F7F7F7',
          muted: '#E7E7E7',
          subtle: '#F0F0F0',
          disabled: '#ECECEC',
          field: '#EAEAEA',
        },
        line: {
          DEFAULT: '#D5D5D5',
          strong: '#C9C9C9',
          muted: '#DBDBDB',
          divider: '#E8E8E8',
        },
        muted: {
          text: '#838383',
          subtle: '#9A9A9A',
          section: '#A3A3A3',
          secondary: '#868686',
          tertiary: '#B5B5B5',
          inactive: '#AAAAAA',
          disabled: '#A2A2A2',
        },
        success: {
          DEFAULT: '#2BAB00',
          bg: '#E4FFDC',
        },
        danger: {
          DEFAULT: '#C9252D',
          bg: '#FFDBDD',
        },
        warning: {
          DEFAULT: '#FF6B00',
          bg: '#FFF0E2',
        },
      },
      borderRadius: {
        sm: '8px',
        DEFAULT: '12px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        pill: '100000px',
      },
    },
  },
  plugins: [],
};
