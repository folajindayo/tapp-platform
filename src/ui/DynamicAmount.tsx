// Port of users-app/components/ui/DynamicAmount.tsx — keep in sync.
// Surface palette + textInverse mapping adapted to the merchant app's
// dark-themed token set (the source repo's `colors.textInverse` is
// black; we need light text on the dark surface, so SURFACE_COLORS
// uses explicit hex/rgba values instead of theme lookups for the
// active/inactive pair).

import React, { useEffect } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { STANDARD_CURVE } from './motion';
import { colors, fontFamilies } from './theme';

const SURFACE_COLORS = {
  light: { active: '#0D0D0D', inactive: 'rgba(13, 13, 13, 0.35)' },
  dark:  { active: '#FFFFFF', inactive: 'rgba(255, 255, 255, 0.35)' },
} as const;

export type DynamicAmountSurface = 'light' | 'dark';
export type DynamicAmountTone = 'default' | 'error';

const ROW_HEIGHT = 72;

const TIER_DURATION = 220;
const ROLL_DURATION = 320;
const ROLL_DURATION_SOFT = 480;
const ENTER_DURATION = 220;
const EXIT_DURATION = 160;
const SLIDE_DISTANCE = 28;

const enterFromBelow = FadeIn.duration(ENTER_DURATION)
  .easing(STANDARD_CURVE)
  .withInitialValues({ transform: [{ translateY: SLIDE_DISTANCE }], opacity: 0 });

const exitToBelow = FadeOut.duration(EXIT_DURATION).easing(STANDARD_CURVE);

const getAmountFontSize = (displayLength: number) => {
  if (displayLength <= 7)  return { fontSize: 64, lineHeight: 72 };
  if (displayLength <= 10) return { fontSize: 48, lineHeight: 56 };
  if (displayLength <= 13) return { fontSize: 36, lineHeight: 42 };
  return { fontSize: 28, lineHeight: 32 };
};

interface DigitReelProps {
  digit: number;
  color: string;
  reducedMotion: boolean;
  fontSize: SharedValue<number>;
  lineHeight: SharedValue<number>;
  softReel: boolean;
}

const DigitReel: React.FC<DigitReelProps> = ({
  digit,
  color,
  reducedMotion,
  fontSize,
  lineHeight,
  softReel,
}) => {
  const digitSV = useSharedValue(reducedMotion ? digit : 0);

  useEffect(() => {
    if (reducedMotion) {
      digitSV.value = digit;
      return;
    }
    digitSV.value = withTiming(digit, {
      duration: softReel ? ROLL_DURATION_SOFT : ROLL_DURATION,
      easing: softReel ? Easing.out(Easing.cubic) : STANDARD_CURVE,
    });
  }, [digit, reducedMotion, digitSV, softReel]);

  const reelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -digitSV.value * lineHeight.value }],
  }));

  const containerStyle = useAnimatedStyle(() => ({ height: lineHeight.value }));
  const textStyle = useAnimatedStyle(() => ({
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
  }));

  return (
    <Animated.View style={[styles.reelContainer, containerStyle]}>
      <Animated.View style={reelStyle}>
        {Array.from({ length: 10 }, (_, d) => (
          <Animated.Text
            key={d}
            style={[styles.digitText, textStyle, { color }]}
            allowFontScaling={false}
          >
            {d}
          </Animated.Text>
        ))}
      </Animated.View>
    </Animated.View>
  );
};

export interface DynamicAmountProps {
  symbol: string;
  formattedValue: string;
  active?: boolean;
  tone?: DynamicAmountTone;
  surface?: DynamicAmountSurface;
  strikethrough?: boolean;
  sizeScale?: number;
  softReel?: boolean;
  animated?: boolean;
  style?: ViewStyle;
}

export type DigitSlot = {
  type: 'digit';
  segment: 'w' | 'd';
  rawPos: number;
  digit: number;
};
export type CommaSlot = { type: 'comma'; rDistance: number };
export type DotSlot = { type: 'dot' };
export type Slot = DigitSlot | CommaSlot | DotSlot;

export const slotKey = (slot: Slot): string => {
  switch (slot.type) {
    case 'digit': return `${slot.segment}${slot.rawPos}`;
    case 'comma': return `c${slot.rDistance}`;
    case 'dot':   return 'dot';
  }
};

export const buildSlots = (formattedValue: string): Slot[] => {
  const slots: Slot[] = [];
  const dotIndex = formattedValue.indexOf('.');
  const wholePart = dotIndex === -1 ? formattedValue : formattedValue.slice(0, dotIndex);
  const decimalPart = dotIndex === -1 ? null : formattedValue.slice(dotIndex + 1);
  let totalWholeDigits = 0;
  for (let i = 0; i < wholePart.length; i++) {
    if (wholePart[i] !== ',') totalWholeDigits++;
  }
  let wholeDigitIdx = 0;
  for (let i = 0; i < wholePart.length; i++) {
    const ch = wholePart[i];
    if (ch === ',') {
      slots.push({ type: 'comma', rDistance: totalWholeDigits - wholeDigitIdx });
    } else {
      slots.push({
        type: 'digit',
        segment: 'w',
        rawPos: wholeDigitIdx,
        digit: ch!.charCodeAt(0) - 48,
      });
      wholeDigitIdx++;
    }
  }
  if (decimalPart !== null) {
    slots.push({ type: 'dot' });
    for (let i = 0; i < decimalPart.length; i++) {
      slots.push({
        type: 'digit',
        segment: 'd',
        rawPos: i,
        digit: decimalPart.charCodeAt(i) - 48,
      });
    }
  }
  return slots;
};

export const DynamicAmount: React.FC<DynamicAmountProps> = ({
  symbol,
  formattedValue,
  active = false,
  tone = 'default',
  surface = 'light',
  strikethrough = false,
  sizeScale = 1,
  softReel = false,
  animated = true,
  style,
}) => {
  const reducedMotion = useReducedMotion();
  const palette = SURFACE_COLORS[surface];
  const color = tone === 'error' ? colors.danger : active ? palette.active : palette.inactive;

  const tier = getAmountFontSize(formattedValue.length);
  const target = {
    fontSize: tier.fontSize * sizeScale,
    lineHeight: tier.lineHeight * sizeScale,
  };
  const fontSize = useSharedValue(target.fontSize);
  const lineHeight = useSharedValue(target.lineHeight);

  useEffect(() => {
    if (reducedMotion || !animated) {
      fontSize.value = target.fontSize;
      lineHeight.value = target.lineHeight;
      return;
    }
    fontSize.value = withTiming(target.fontSize, {
      duration: TIER_DURATION,
      easing: STANDARD_CURVE,
    });
    lineHeight.value = withTiming(target.lineHeight, {
      duration: TIER_DURATION,
      easing: STANDARD_CURVE,
    });
  }, [animated, target.fontSize, target.lineHeight, fontSize, lineHeight, reducedMotion]);

  const charTextStyle = useAnimatedStyle(() => ({
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
  }));
  const charContainerStyle = useAnimatedStyle(() => ({ height: lineHeight.value }));
  const strikeLineStyle = useAnimatedStyle(() => ({
    top: ROW_HEIGHT / 2 + lineHeight.value * 0.02,
  }));

  const symbolOpacity = tone === 'error' ? 1 : 0.55;

  const symbolSize = useDerivedValue(() => Math.max(14, fontSize.value * 0.4375));
  const symbolStyle = useAnimatedStyle(() => ({
    fontSize: symbolSize.value,
    lineHeight: symbolSize.value * (32 / 28),
  }));

  if (reducedMotion || !animated) {
    const tierStatic = getAmountFontSize(formattedValue.length);
    const targetStatic = {
      fontSize: tierStatic.fontSize * sizeScale,
      lineHeight: tierStatic.lineHeight * sizeScale,
    };
    const symbolStatic = Math.max(14, targetStatic.fontSize * 0.4375);
    return (
      <View style={[styles.row, style]}>
        <View style={styles.strikeContent}>
          <Text
            style={[
              styles.symbol,
              {
                color,
                fontSize: symbolStatic,
                lineHeight: symbolStatic * (32 / 28),
                opacity: symbolOpacity,
              },
            ]}
            allowFontScaling={false}
          >
            {symbol}
          </Text>
          <Text
            style={[styles.staticDigits, targetStatic, { color }]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {formattedValue}
          </Text>
          {strikethrough ? (
            <View
              style={[
                styles.strikeLine,
                { backgroundColor: color, top: ROW_HEIGHT / 2 + targetStatic.lineHeight * 0.02 },
              ]}
            />
          ) : null}
        </View>
      </View>
    );
  }

  const slots = buildSlots(formattedValue);
  const slotLayout = LinearTransition.duration(ENTER_DURATION).easing(STANDARD_CURVE);

  return (
    <View style={[styles.row, style]}>
      <Animated.View style={styles.strikeContent} layout={slotLayout}>
        <Animated.Text
          style={[styles.symbol, symbolStyle, { color, opacity: symbolOpacity }]}
          allowFontScaling={false}
          layout={slotLayout}
        >
          {symbol}
        </Animated.Text>
        <Animated.View style={styles.digitsRow} layout={slotLayout}>
          {slots.map((slot) => {
            const key = slotKey(slot);
            if (slot.type === 'digit') {
              return (
                <Animated.View
                  key={key}
                  entering={enterFromBelow}
                  exiting={exitToBelow}
                  layout={slotLayout}
                >
                  <DigitReel
                    digit={slot.digit}
                    color={color}
                    reducedMotion={reducedMotion}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    softReel={softReel}
                  />
                </Animated.View>
              );
            }
            const ch = slot.type === 'comma' ? ',' : '.';
            return (
              <Animated.View
                key={key}
                entering={enterFromBelow}
                exiting={exitToBelow}
                layout={slotLayout}
                style={charContainerStyle}
              >
                <Animated.Text
                  style={[styles.digitText, charTextStyle, { color }]}
                  allowFontScaling={false}
                >
                  {ch}
                </Animated.Text>
              </Animated.View>
            );
          })}
        </Animated.View>
        {strikethrough ? (
          <Animated.View style={[styles.strikeLine, { backgroundColor: color }, strikeLineStyle]} />
        ) : null}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  strikeContent: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  strikeLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    opacity: 0.8,
  },
  digitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reelContainer: {
    overflow: 'hidden',
  },
  symbol: {
    fontFamily: fontFamilies.amountSymbol,
    fontWeight: '400',
    marginRight: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  digitText: {
    fontFamily: fontFamilies.amountDigit,
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  staticDigits: {
    fontFamily: fontFamilies.amountDigit,
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});

export default DynamicAmount;
