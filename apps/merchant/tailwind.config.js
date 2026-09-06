/**
 * Visual language: Zap-inspired — royal blue (#0065F5) CTAs, white text,
 * rounded-xl corners, Inter typography, near-black text on white surfaces,
 * clean grayscale ramp. Tokens kept in sync with src/ui/theme.ts (which is
 * the source of truth for places NativeWind can't reach — Reanimated animated
 * styles, StyleSheet-only Native primitives, etc.).
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#298DFF',
          blue: '#1D79E2',
        },
        ink: {
          true: '#000000',
          DEFAULT: '#FAFAFA',
          800: '#E5E5EA',
          700: '#C7C7CC',
        },
        surface: {
          DEFAULT: '#161616',
          soft: '#1E1E1E',
          bg: '#0D0D0D',
          muted: '#2C2C2E',
          subtle: '#1E1E1E',
          disabled: '#202022',
          field: '#18181A',
        },
        line: {
          DEFAULT: '#222224',
          strong: '#2C2C2E',
          muted: '#1C1C1E',
          divider: '#1A1A1C',
        },
        muted: {
          text: '#9A9A9A',
          subtle: '#8E8E93',
          section: '#8E8E93',
          secondary: '#A3A3A3',
          tertiary: '#686868',
          inactive: '#555555',
          disabled: '#48484A',
        },
        success: {
          DEFAULT: '#30D158',
          bg: '#1C3D1E',
        },
        danger: {
          DEFAULT: '#FF453A',
          bg: '#4A1517',
        },
        warning: {
          DEFAULT: '#FF9F0A',
          bg: '#4A2A00',
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
      // Open Sans (Google Fonts). Loaded via expo-font in
      // app/_layout.tsx. NativeWind picks these up as `font-sans` /
      // `font-medium` / `font-semibold` / `font-bold`.
      fontFamily: {
        sans:     ['BricolageGrotesque-Regular'],
        medium:   ['BricolageGrotesque-Medium'],
        semibold: ['BricolageGrotesque-SemiBold'],
        bold:     ['BricolageGrotesque-Bold'],
      },
    },
  },
  plugins: [],
};
