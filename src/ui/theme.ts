// Design tokens — mirrors the users-app theme so both apps share a single
// visual language. Edit in sync if either side evolves.

import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  // Surfaces
  trueBlack: '#000000',
  black: '#0D0D0D',
  ink: '#FFFFFF',
  white: '#161616',
  whiteSoft: '#1E1E1E',
  background: '#0D0D0D',
  surface: '#161616',
  surfaceMuted: '#2C2C2E',
  surfaceSubtle: '#1E1E1E',
  surfaceDisabled: '#202022',
  fieldDisabled: '#18181A',

  // Text
  text: '#FAFAFA',
  textStrong: '#FFFFFF',
  textInverse: '#000000',
  textLight: '#FAFAFA',
  textMuted: '#9A9A9A',
  textSubtle: '#8E8E93',
  textSection: '#8E8E93',
  textSecondary: '#A3A3A3',
  textTertiary: '#686868',
  textInactive: '#555555',
  textDisabled: '#48484A',

  // Lines / icons
  border: '#222224',
  borderStrong: '#2C2C2E',
  borderMuted: '#1C1C1E',
  divider: '#1A1A1C',
  iconDisabled: '#48484A',
  arrow: '#FFFFFF',

  // Brand
  brand: '#298DFF',
  brandBlue: '#1D79E2',

  // Semantic
  success: '#30D158',
  successBg: '#1C3D1E',
  danger: '#FF453A',
  dangerBg: '#4A1517',
  warning: '#FF9F0A',
  warningBg: '#4A2A00',

  // Controls
  disabledControl: '#48484A',
} as const;

// Loaded via expo-font in app/_layout.tsx.
export const fontFamilies = {
  display:       'BricolageGrotesque-Bold',
  displayMedium: 'BricolageGrotesque-SemiBold',
  text:          'BricolageGrotesque-Regular',
  textRegular:   'BricolageGrotesque-Regular',
  textMedium:    'BricolageGrotesque-Medium',
  textBold:      'BricolageGrotesque-Bold',
  rounded:       'BricolageGrotesque-Medium',
  amountSymbol:  'BricolageGrotesque-Bold',
  amountDigit:   'BricolageGrotesque-Bold',
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
    color: colors.white,
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
