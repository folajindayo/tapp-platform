import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { cssInterop } from 'nativewind';

cssInterop(View, { className: { target: 'style' } });

interface PinDotsProps {
  /** How many digits have been typed (0..length). */
  filled: number;
  /** Total digits to collect. v1 = 4. */
  length?: number;
  /** Triggers a shake when this changes — use a counter incremented on rejection. */
  errorTick?: number;
}

/**
 * Masked-PIN indicator row. Matches the visual register of
 * users-app's TransactionPinDots — 12×12 ink-filled dots with a
 * soft hollow ring for unfilled positions.
 *
 * Two motion behaviors live here, both per `MOTION_PRINCIPLES.md`:
 *   - Per-dot pop-in spring as each digit lands (tier-1 acknowledgement)
 *   - Horizontal shake on `errorTick` change (tier-3 resolution)
 */
export const PinDots = memo<PinDotsProps>(function PinDots({
  filled,
  length = 4,
  errorTick = 0,
}) {
  const shake = useSharedValue(0);

  useEffect(() => {
    if (errorTick === 0) return;
    shake.value = withSequence(
      withTiming(10, { duration: 50, easing: Easing.linear }),
      withTiming(-10, { duration: 50, easing: Easing.linear }),
      withTiming(6, { duration: 50, easing: Easing.linear }),
      withTiming(-6, { duration: 50, easing: Easing.linear }),
      withTiming(0, { duration: 50, easing: Easing.linear }),
    );
  }, [errorTick, shake]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  return (
    <Animated.View style={rowStyle} className="flex-row items-center gap-4">
      {Array.from({ length }).map((_, i) => (
        <Dot key={i} active={i < filled} />
      ))}
    </Animated.View>
  );
});

function Dot({ active }: { active: boolean }) {
  const scale = useSharedValue(active ? 1 : 0.85);
  useEffect(() => {
    scale.value = withSpring(active ? 1 : 0.85, {
      mass: 0.4,
      damping: 18,
      stiffness: 280,
    });
  }, [active, scale]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      style={style}
      className={
        active
          ? 'w-3 h-3 rounded-full bg-ink'
          : 'w-3 h-3 rounded-full border border-line-strong'
      }
    />
  );
}
