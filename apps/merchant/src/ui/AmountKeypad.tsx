// Direct port of users-app/components/ui/AmountKeypad.tsx — keep these
// in sync. The contentOffset math centres a small visual glyph (~24pt)
// inside a larger touch cell (56×48) so the layout reads as bare
// digits but the tap target meets HIG's 44pt floor.

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { colors, fontFamilies } from './theme';

export type AmountKeypadSurface = 'light' | 'dark';

const SURFACE_TEXT_COLOR: Record<AmountKeypadSurface, string> = {
  light: colors.text,
  dark:  colors.textLight,
};

const backspaceSvg = (fill: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M14.9993 20.6695C14.8093 20.6695 14.6193 20.5995 14.4693 20.4495L7.9493 13.9295C6.8893 12.8695 6.8893 11.1295 7.9493 10.0695L14.4693 3.54953C14.7593 3.25953 15.2393 3.25953 15.5293 3.54953C15.8193 3.83953 15.8193 4.31953 15.5293 4.60953L9.0093 11.1295C8.5293 11.6095 8.5293 12.3895 9.0093 12.8695L15.5293 19.3895C15.8193 19.6795 15.8193 20.1595 15.5293 20.4495C15.3793 20.5895 15.1893 20.6695 14.9993 20.6695Z" fill="${fill}"/>
</svg>`;

export type KeypadKeyType = 'digit' | 'dot' | 'back';
export interface KeypadKey {
  value: string;
  type: KeypadKeyType;
}

const COL_1: KeypadKey[] = [
  { value: '1', type: 'digit' },
  { value: '4', type: 'digit' },
  { value: '7', type: 'digit' },
  { value: '.', type: 'dot'   },
];
const COL_2: KeypadKey[] = [
  { value: '2', type: 'digit' },
  { value: '5', type: 'digit' },
  { value: '8', type: 'digit' },
  { value: '0', type: 'digit' },
];
const COL_3: KeypadKey[] = [
  { value: '3', type: 'digit' },
  { value: '6', type: 'digit' },
  { value: '9', type: 'digit' },
  { value: 'back', type: 'back' },
];

const MIN_KEY_TOUCH_WIDTH = 56;
const MIN_KEY_TOUCH_HEIGHT = 48;
const MIN_ROW_GAP = 8;
const VISUAL_KEY_WIDTH = 24;

export interface AmountKeypadProps {
  /** Called when any key is pressed. */
  onKeyPress: (key: KeypadKey) => void;
  /** When true, ignores all key presses. */
  disabled?: boolean;
  /** When true, hides the decimal-point key (use for integer-only inputs). */
  hideDot?: boolean;
  width?: number;
  columnGap?: number;
  keyHeight?: number;
  /** Surface the keypad sits on. 'light' = dark glyphs (default).
   *  'dark' = light glyphs for dark backgrounds. */
  surface?: AmountKeypadSurface;
  style?: ViewStyle;
}

export const AmountKeypad: React.FC<AmountKeypadProps> = ({
  onKeyPress,
  disabled = false,
  hideDot = false,
  width = 254,
  columnGap = 45,
  keyHeight = 29,
  surface = 'light',
  style,
}) => {
  const glyphColor = SURFACE_TEXT_COLOR[surface];
  const backIcon = useMemo(() => backspaceSvg(glyphColor), [glyphColor]);
  const touchHeight = Math.max(MIN_KEY_TOUCH_HEIGHT, keyHeight);
  const touchWidth = MIN_KEY_TOUCH_WIDTH;
  const adjustedColumnGap = Math.max(
    MIN_ROW_GAP,
    (keyHeight * 4 + columnGap * 3 - touchHeight * 4) / 3,
  );
  const keypadWidth = Math.max(width, touchWidth * 3);

  const handlePress = useCallback(
    (key: KeypadKey) => {
      if (disabled) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onKeyPress(key);
    },
    [disabled, onKeyPress],
  );

  const renderKey = (columnIndex: number) => (key: KeypadKey, rowIndex: number) => {
    const isHiddenDot = hideDot && key.type === 'dot';
    const contentOffsetX = (columnIndex - 1) * ((touchWidth - VISUAL_KEY_WIDTH) / 2);
    const oldCenterY = rowIndex * (keyHeight + columnGap) + keyHeight / 2;
    const newCenterY = rowIndex * (touchHeight + adjustedColumnGap) + touchHeight / 2;

    return (
      <KeyButton
        key={`${key.value}-${rowIndex}`}
        keypadKey={key}
        disabled={disabled || isHiddenDot}
        hidden={isHiddenDot}
        glyphColor={glyphColor}
        backIcon={backIcon}
        touchWidth={touchWidth}
        touchHeight={touchHeight}
        contentOffsetX={contentOffsetX}
        contentOffsetY={oldCenterY - newCenterY}
        onPress={handlePress}
      />
    );
  };

  return (
    <View style={[styles.row, { width: keypadWidth }, style]}>
      <View style={[styles.column, { gap: adjustedColumnGap }]}>{COL_1.map(renderKey(0))}</View>
      <View style={[styles.column, { gap: adjustedColumnGap }]}>{COL_2.map(renderKey(1))}</View>
      <View style={[styles.column, { gap: adjustedColumnGap }]}>{COL_3.map(renderKey(2))}</View>
    </View>
  );
};

interface KeyButtonProps {
  keypadKey: KeypadKey;
  disabled: boolean;
  hidden: boolean;
  glyphColor: string;
  backIcon: string;
  touchWidth: number;
  touchHeight: number;
  contentOffsetX: number;
  contentOffsetY: number;
  onPress: (key: KeypadKey) => void;
}

const KeyButton = React.memo<KeyButtonProps>(
  ({
    keypadKey,
    disabled,
    hidden,
    glyphColor,
    backIcon,
    touchWidth,
    touchHeight,
    contentOffsetX,
    contentOffsetY,
    onPress,
  }) => {
    const handlePress = useCallback(() => onPress(keypadKey), [keypadKey, onPress]);
    const accessibilityLabel =
      keypadKey.type === 'back'
        ? 'Backspace'
        : keypadKey.type === 'dot'
        ? 'Decimal point'
        : keypadKey.value;

    return (
      <TouchableOpacity
        style={[
          styles.keyButton,
          { width: touchWidth, height: touchHeight },
          hidden && styles.keyButtonHidden,
        ]}
        activeOpacity={0.45}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        delayPressIn={0}
        pressRetentionOffset={{ top: 12, bottom: 12, left: 12, right: 12 }}
        onPress={handlePress}
      >
        <View
          style={{
            transform: [{ translateX: contentOffsetX }, { translateY: contentOffsetY }],
          }}
        >
          {keypadKey.type === 'back' ? (
            <SvgXml xml={backIcon} width={24} height={24} />
          ) : hidden ? null : (
            <Text style={[styles.keyText, { color: glyphColor }]}>{keypadKey.value}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  },
);

KeyButton.displayName = 'AmountKeypadKeyButton';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  column: {
    alignItems: 'center',
  },
  keyButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyButtonHidden: {
    opacity: 0,
  },
  keyText: {
    fontFamily: fontFamilies.rounded,
    fontWeight: '700',
    fontSize: 24,
    lineHeight: 29,
    textAlign: 'center',
  },
});

export default AmountKeypad;
