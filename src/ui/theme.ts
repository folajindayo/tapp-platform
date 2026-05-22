// Design tokens — mirrors the users-app theme so both apps share a single
// visual language. Edit in sync if either side evolves.

import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  // Surfaces
  trueBlack: '#000000',
  black: '#121212',
  ink: '#1F1F1F',
  white: '#FFFFFF',
  whiteSoft: '#FAFAFA',
  background: '#F7F7F7',
  surface: '#FFFFFF',
  surfaceMuted: '#E7E7E7',
  surfaceSubtle: '#F0F0F0',
  surfaceDisabled: '#ECECEC',
  fieldDisabled: '#EAEAEA',

  // Text
  text: '#121212',
  textStrong: '#333333',
  textInverse: '#FFFFFF',
  textLight: '#FAFAFA',
  textMuted: '#838383',
  textSubtle: '#9A9A9A',
  textSection: '#A3A3A3',
  textSecondary: '#868686',
  textTertiary: '#B5B5B5',
  textInactive: '#AAAAAA',
  textDisabled: '#A2A2A2',

  // Lines / icons
  border: '#D5D5D5',
  borderStrong: '#C9C9C9',
  borderMuted: '#DBDBDB',
  divider: '#E8E8E8',
  iconDisabled: '#A0A0A0',
  arrow: '#292D32',

  // Brand
  brandGreen: '#40FF00',
  brandBlue: '#2775CA',

  // Semantic
  success: '#2BAB00',
  successBg: '#E4FFDC',
  danger: '#C9252D',
  dangerBg: '#FFDBDD',
  warning: '#FF6B00',
  warningBg: '#FFF0E2',

  // Controls
  disabledControl: '#686868',
} as const;

// Clash Grotesk loaded via expo-font in app/_layout.tsx. We keep both
// the literal family names AND the per-weight variant names so callers
// can pick by intent (display/text) without hand-mapping weights.
// The Platform isn't relevant — the loaded TTFs ship cross-platform.
export const fontFamilies = {
  display: 'ClashGrotesk-Semibold',
  displayMedium: 'ClashGrotesk-Medium',
  text: 'ClashGrotesk-Regular',
  textRegular: 'ClashGrotesk-Regular',
  textMedium: 'ClashGrotesk-Medium',
  textBold: 'ClashGrotesk-Bold',
  rounded: 'ClashGrotesk-Medium',
  amountSymbol: 'ClashGrotesk-Semibold',
  amountDigit: 'ClashGrotesk-Semibold',
} as const;

export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  pill: 100000,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

export const shadows = StyleSheet.create({
  elevation1: {
    shadowColor: colors.trueBlack,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  } satisfies ViewStyle,
  raised: {
    shadowColor: colors.trueBlack,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  } satisfies ViewStyle,
  footer: {
    shadowColor: colors.trueBlack,
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 6,
  } satisfies ViewStyle,
});

export const typography = StyleSheet.create({
  titleLarge: {
    fontFamily: fontFamilies.display,
    fontWeight: '700',
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
  } satisfies TextStyle,
  titleMedium: {
    fontFamily: fontFamilies.textBold,
    fontWeight: '700',
    fontSize: 20,
    lineHeight: 24,
    color: colors.text,
  } satisfies TextStyle,
  body: {
    fontFamily: fontFamilies.text,
    fontWeight: '500',
    fontSize: 16,
    lineHeight: 19,
    color: colors.text,
  } satisfies TextStyle,
  bodyMuted: {
    fontFamily: fontFamilies.text,
    fontWeight: '500',
    fontSize: 16,
    lineHeight: 19,
    color: colors.textMuted,
  } satisfies TextStyle,
  caption: {
    fontFamily: fontFamilies.text,
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 17,
    color: colors.textMuted,
  } satisfies TextStyle,
  label: {
    fontFamily: fontFamilies.textMedium,
    fontWeight: '500',
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSection,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  } satisfies TextStyle,
  button: {
    fontFamily: fontFamilies.text,
    fontWeight: '500',
    fontSize: 16,
    lineHeight: 17,
    textAlign: 'center',
    color: colors.trueBlack,
  } satisfies TextStyle,
  amount: {
    fontFamily: fontFamilies.amountDigit,
    fontWeight: '900',
    fontSize: 56,
    lineHeight: 64,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
});

export const theme = {
  colors,
  fontFamilies,
  typography,
  radii,
  spacing,
  shadows,
} as const;

export default theme;
