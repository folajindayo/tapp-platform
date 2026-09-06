import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, Pressable } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { ArrowLeft, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Text } from '@/ui';
import { colors } from '@/ui/theme';

const DURATION = 280;
const CURVE = Easing.bezier(0.32, 0.72, 0, 1);
const TRAVEL = 8;
const ACTIVE = '#0065F5'; // Royal blue brand color
const INACTIVE = '#D9D9D9';

const DOT_SIZE = 8;
const DOT_GAP = 6;
const DOT_PITCH = DOT_SIZE + DOT_GAP;
const PILL_DURATION = 420;
const PILL_STRETCH_PEAK = 0.4;
const PILL_SQUASH_PEAK = 0.18;

// Keep track of last step cross-mount for continuous slide
let lastSeenStep: number | null = null;
let lastSeenTotalSteps: number | null = null;

// Snappy spring config for press feedback
const TIGHT_SPRING = {
  mass: 0.4,
  damping: 22,
  stiffness: 320,
};

const SPRING_CONFIG = {
  mass: 0.6,
  damping: 18,
  stiffness: 220,
};

// Custom PressableScale component
const PressableScale = ({ children, onPress, style, pressedScale = 0.88, ...rest }: any) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(pressedScale, TIGHT_SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING_CONFIG);
      }}
      onPress={(e) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </Pressable>
  );
};

interface ProgressDotsProps {
  step: number;
  totalSteps: number;
}

const ProgressDots: React.FC<ProgressDotsProps> = ({ step, totalSteps }) => {
  const startStep =
    lastSeenStep != null &&
    lastSeenTotalSteps === totalSteps &&
    Math.abs(lastSeenStep - step) <= 2
      ? lastSeenStep
      : step;

  const pillIndex = useSharedValue(startStep - 1);
  const travel = useSharedValue(1);

  useEffect(() => {
    travel.value = 0;
    travel.value = withTiming(1, { duration: PILL_DURATION, easing: CURVE });
    pillIndex.value = withTiming(step - 1, {
      duration: PILL_DURATION,
      easing: CURVE,
    });
    lastSeenStep = step;
    lastSeenTotalSteps = totalSteps;
  }, [step, totalSteps, pillIndex, travel]);

  const pillStyle = useAnimatedStyle(() => {
    const tx = pillIndex.value * DOT_PITCH;
    const bulge = Math.sin(travel.value * Math.PI);
    return {
      transform: [
        { translateX: tx },
        { scaleX: 1 + PILL_STRETCH_PEAK * bulge },
        { scaleY: 1 - PILL_SQUASH_PEAK * bulge },
      ],
    };
  });

  return (
    <View style={styles.dotsContainer}>
      {Array.from({ length: totalSteps }).map((_, i) => (
        <View key={i} style={[styles.dot, { backgroundColor: INACTIVE }]} />
      ))}
      <Animated.View style={[styles.dot, styles.pill, pillStyle]} />
    </View>
  );
};

export interface StepHeaderProps {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  isFirstStep?: boolean;
  onBack: () => void;
}

export const StepHeader: React.FC<StepHeaderProps> = ({
  step,
  totalSteps,
  title,
  subtitle,
  isFirstStep = false,
  onBack,
}) => {
  const prevStepRef = useRef(step);
  const direction = step < prevStepRef.current ? 1 : -1;

  const [outgoingTitle, setOutgoingTitle] = useState(title);
  const [outgoingSubtitle, setOutgoingSubtitle] = useState(subtitle);

  const progress = useSharedValue(1);

  useEffect(() => {
    if (step !== prevStepRef.current) {
      setOutgoingTitle(prevTitleRef.current);
      setOutgoingSubtitle(prevSubtitleRef.current);
      progress.value = 0;
      progress.value = withTiming(1, { duration: DURATION, easing: CURVE });
      prevStepRef.current = step;
    }
    prevTitleRef.current = title;
    prevSubtitleRef.current = subtitle;
  }, [step, title, subtitle, progress]);

  const prevTitleRef = useRef(title);
  const prevSubtitleRef = useRef(subtitle);

  const handlePress = () => {
    onBack();
  };

  const backStyle = useAnimatedStyle(() => ({
    opacity: isFirstStep
      ? interpolate(progress.value, [0, 1], [1, 0])
      : interpolate(progress.value, [0, 1], [0, 1]),
    transform: [
      {
        rotate: `${interpolate(
          progress.value,
          [0, 1],
          [isFirstStep ? 0 : -30, isFirstStep ? -30 : 0]
        )}deg`,
      },
    ],
  }));

  const closeStyle = useAnimatedStyle(() => ({
    opacity: isFirstStep
      ? interpolate(progress.value, [0, 1], [0, 1])
      : interpolate(progress.value, [0, 1], [1, 0]),
    transform: [
      {
        rotate: `${interpolate(
          progress.value,
          [0, 1],
          [isFirstStep ? 30 : 0, isFirstStep ? 0 : 30]
        )}deg`,
      },
    ],
  }));

  const incomingStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-direction * TRAVEL, 0]) }],
  }));

  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateX: interpolate(progress.value, [0, 1], [0, direction * TRAVEL]) }],
  }));

  const isTransitioning = progress.value < 1 && outgoingTitle !== title;

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <PressableScale
          onPress={handlePress}
          hitSlop={12}
          pressedScale={0.88}
          style={styles.iconWrap}
          accessibilityRole="button"
          accessibilityLabel={isFirstStep ? 'Cancel' : 'Back'}
        >
          <Animated.View style={[styles.icon, backStyle]}>
            <ArrowLeft size={24} color={colors.text} />
          </Animated.View>
          <Animated.View style={[styles.icon, closeStyle, StyleSheet.absoluteFill]}>
            <X size={24} color={colors.text} />
          </Animated.View>
        </PressableScale>

        <ProgressDots step={step} totalSteps={totalSteps} />

        <View style={styles.iconWrapPlaceholder} />
      </View>

      <View style={styles.titleContainer}>
        <View style={styles.titleSlot}>
          <Animated.Text style={[styles.title, incomingStyle]}>{title}</Animated.Text>
          {isTransitioning && (
            <Animated.Text style={[styles.title, styles.absoluteText, outgoingStyle]}>
              {outgoingTitle}
            </Animated.Text>
          )}
        </View>

        {(subtitle || outgoingSubtitle) && (
          <View style={styles.subtitleSlot}>
            {subtitle && (
              <Animated.Text style={[styles.subtitle, incomingStyle]}>{subtitle}</Animated.Text>
            )}
            {isTransitioning && outgoingSubtitle && (
              <Animated.Text style={[styles.subtitle, styles.absoluteText, outgoingStyle]}>
                {outgoingSubtitle}
              </Animated.Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 20,
    width: '100%',
    marginBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  iconWrap: {
    position: 'relative',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapPlaceholder: {
    width: 24,
    height: 24,
  },
  icon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DOT_GAP,
    position: 'relative',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  pill: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: ACTIVE,
  },
  titleContainer: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
  },
  titleSlot: {
    position: 'relative',
    justifyContent: 'center',
  },
  subtitleSlot: {
    position: 'relative',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    fontWeight: '700',
    fontSize: 26,
    lineHeight: 31,
    color: colors.text,
  },
  subtitle: {
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 19,
    color: colors.textMuted,
  },
  absoluteText: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
