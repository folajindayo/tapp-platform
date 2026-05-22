// Design tokens — mirrors the users-app theme so both apps share a single
// visual language. Edit in sync if either side evolves.

import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

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

const isIOS = Platform.OS === 'ios';

export const fontFamilies = {
  display: isIOS ? 'SF Pro Display' : 'sans-serif',
  displayMedium: isIOS ? 'SF Pro Display' : 'sans-serif-medium',
  text: isIOS ? 'SF Pro Text' : 'sans-serif',
  textRegular: isIOS ? 'SF Pro Text' : 'sans-serif',
  textMedium: isIOS ? 'SF Pro Text' : 'sans-serif-medium',
  textBold: isIOS ? 'SF Pro Text' : 'sans-serif',
  rounded: isIOS ? 'SF Pro Rounded' : 'sans-serif-medium',
  amountSymbol: isIOS ? 'SF Pro Display' : 'sans-serif',
  amountDigit: isIOS ? 'SF Pro Display' : 'sans-serif-condensed',
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
