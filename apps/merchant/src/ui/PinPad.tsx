import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Delete } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { Text } from './Text';

cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

interface PinPadProps {
  onPressDigit: (digit: string) => void;
  onPressBackspace: () => void;
  disabled?: boolean;
}

/**
 * Numeric PIN pad. Pattern adapted from users-app's BasePinKeypad —
 * 60×60 touch targets (above iOS HIG 44pt + Material 48dp), columns
 * layout for muscle memory, spring scale-on-press for the
 * action→reaction tier-1 acknowledgement per `MOTION_PRINCIPLES.md`.
 *
 * Each digit sits on a light-grey rounded chip so the targets read as
 * tactile buttons rather than free-floating numerals. NativeWind for
 * the surrounding shell; per-key spring transform stays in
 * Reanimated so it composites on the UI thread.
 */
export const PinPad = memo<PinPadProps>(function PinPad({
  onPressDigit,
  onPressBackspace,
  disabled,
}) {
  // 1 2 3 / 4 5 6 / 7 8 9 / _ 0 ⌫
  return (
    <View className="items-center">
      <View className="flex-row gap-4">
        <Column digits={['1', '4', '7']} onPressDigit={onPressDigit} disabled={disabled} />
        <Column digits={['2', '5', '8', '0']} onPressDigit={onPressDigit} disabled={disabled} />
        <Column
          digits={['3', '6', '9']}
          onPressDigit={onPressDigit}
          disabled={disabled}
          tail={<BackspaceKey onPress={onPressBackspace} disabled={disabled} />}
        />
      </View>
    </View>
  );
});

function Column({
  digits,
  onPressDigit,
  disabled,
  tail,
}: {
  digits: string[];
  onPressDigit: (d: string) => void;
  disabled?: boolean;
  tail?: React.ReactNode;
}) {
  return (
    <View className="items-center gap-3">
      {digits.map((d) => (
        <DigitKey key={d} digit={d} onPress={onPressDigit} disabled={disabled} />
      ))}
      {tail}
    </View>
  );
}

const KEY_SIZE = 72;

function DigitKey({
  digit,
  onPress,
  disabled,
}: {
  digit: string;
  onPress: (d: string) => void;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Spring config from MOTION_PRINCIPLES.md § Spring physics — tighter
  // for button-like presses so they snap back quickly.
  const onIn = useCallback(() => {
    scale.value = withSpring(0.92, { mass: 0.4, damping: 22, stiffness: 320 });
  }, [scale]);
  const onOut = useCallback(() => {
    scale.value = withSpring(1, { mass: 0.6, damping: 18, stiffness: 220 });
  }, [scale]);

  const handle = useCallback(() => {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(digit);
  }, [disabled, digit, onPress]);

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Digit ${digit}`}
        disabled={disabled}
        onPressIn={onIn}
        onPressOut={onOut}
        onPress={handle}
        hitSlop={8}
        className="items-center justify-center bg-surface-soft active:bg-surface-subtle rounded-2xl"
        style={{ width: KEY_SIZE, height: KEY_SIZE }}
      >
        <Text className="text-2xl font-semibold text-ink">{digit}</Text>
      </Pressable>
    </Animated.View>
  );
}

function BackspaceKey({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onIn = useCallback(() => {
    scale.value = withSpring(0.92, { mass: 0.4, damping: 22, stiffness: 320 });
  }, [scale]);
  const onOut = useCallback(() => {
    scale.value = withSpring(1, { mass: 0.6, damping: 18, stiffness: 220 });
  }, [scale]);
  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Backspace"
        disabled={disabled}
        onPressIn={onIn}
        onPressOut={onOut}
        onPress={() => {
          if (disabled) return;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        hitSlop={8}
        className="items-center justify-center rounded-2xl active:bg-surface-soft"
        style={{ width: KEY_SIZE, height: KEY_SIZE }}
      >
        <Delete size={24} color="#121212" strokeWidth={1.6} />
      </Pressable>
    </Animated.View>
  );
}
