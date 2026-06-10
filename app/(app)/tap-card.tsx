import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
// Reanimated typings expect an EasingFunction; the new Easing.bezier returns
// an EasingFunctionFactory. .factory() returns the actual function — same
// underlying curve, satisfies the type.
import { Button, Icon, Icons, PinDots, PinPad, Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import { useTapCard, type TapCardPhase } from '@/hooks/useTapCard';
import { StepUpQR } from '@/components/StepUpQR';

cssInterop(View, { className: { target: 'style' } });
cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(SafeAreaView, { className: { target: 'style' } });

const FADE = FadeIn.duration(220).easing(Easing.bezier(0.32, 0.72, 0, 1).factory());
const FADE_OUT = FadeOut.duration(180).easing(Easing.bezier(0.32, 0.72, 0, 1).factory());
const PIN_LENGTH = 4;

/**
 * Tap Card view — phase-driven. The orchestrator (useTapCard) drives
 * the state machine; this component just maps phases to surfaces.
 *
 * Each surface enters/exits with the standard ease-out per
 * `MOTION_PRINCIPLES.md § Status changes`; the per-phase content keeps
 * its own animation budget (PIN pad keys, dot pop-ins, etc.).
 */
export default function TapCardScreen() {
  const { amount, memo } = useLocalSearchParams<{ amount?: string; memo?: string }>();
  const tap = useTapCard({
    amount: amount ?? '0',
    memo: typeof memo === 'string' ? memo : undefined,
  });

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-surface-bg">
      <Header amount={amount ?? '0'} onCancel={tap.cancel} />

      <Animated.View
        key={tap.phase.kind}
        entering={FADE}
        exiting={FADE_OUT}
        className="flex-1"
      >
        <Body
          phase={tap.phase}
          submitPin={tap.submitPin}
          submitStepUp={tap.submitStepUp}
          retry={tap.retry}
          retryWrite={tap.retryWrite}
          cancel={tap.cancel}
        />
      </Animated.View>
    </SafeAreaView>
  );
}

function Header({ amount, onCancel }: { amount: string; onCancel: () => void }) {
  return (
    <View className="px-5 py-4 flex-row justify-between items-center">
      <Pressable
        onPress={onCancel}
        hitSlop={12}
        className="h-10 px-3 items-center justify-center rounded-md active:bg-surface-subtle"
      >
        <Text className="text-ink-700">Cancel</Text>
      </Pressable>
      <Text className="text-base font-semibold text-ink">Tap Card</Text>
      <View className="w-16 items-end">
        <Text
          className="text-base font-semibold text-ink"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatNgn(amount)}
        </Text>
      </View>
    </View>
  );
}

function Body({
  phase,
  submitPin,
  submitStepUp,
  retry,
  retryWrite,
  cancel,
}: {
  phase: TapCardPhase;
  submitPin: (pin: string) => Promise<void>;
  submitStepUp: (token: string) => Promise<void>;
  retry: () => void;
  retryWrite: () => void;
  cancel: () => void;
}) {
  switch (phase.kind) {
    case 'scanning':
    case 'reading':
      return <ScanningView />;
    case 'resolving':
      return <SpinnerView label="Authorizing…" />;
    case 'charging-none':
    case 'charging-pin':
    case 'charging-step-up':
      return <SpinnerView label="Charging card…" />;
    case 'pin-required':
      return <PinView onSubmit={submitPin} />;
    case 'step-up-required':
      return (
        <StepUpQR
          url={phase.stepUpUrl}
          token={phase.stepUpToken}
          onGranted={submitStepUp}
          onDeniedOrExpired={() => undefined /* parent shows failed via hook */}
        />
      );
    case 'step-up-polling':
      return <SpinnerView label="Verifying…" />;
    case 'writing':
      return <WritingView label="Tap the card once more to finalize" />;
    case 'write-retry':
      return (
        <WriteRetryView
          error={phase.error}
          onRetry={retryWrite}
          onSkip={cancel}
        />
      );
    case 'settled':
      return <SettledView amount={phase.response.amount} onDone={cancel} />;
    case 'processing':
      return (
        <ProcessingView
          amount={phase.response.amount}
          onDone={cancel}
        />
      );
    case 'failed':
      return (
        <FailedView
          error={phase.error}
          onRetry={retry}
          onCancel={cancel}
        />
      );
  }
}

// -----------------------------------------------------------------------------
// Phase surfaces
// -----------------------------------------------------------------------------

function ScanningView() {
  const scale = useSharedValue(0.9);
  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.12, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(scale);
  }, [scale]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 0.6,
  }));

  return (
    <View className="flex-1 items-center justify-center px-6 gap-8">
      <View className="items-center justify-center" style={{ width: 220, height: 220 }}>
        {/* Pulsing Ripple Rings */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: 190,
              height: 190,
              borderRadius: 95,
              borderWidth: 2,
              borderColor: '#0065F5',
            },
            ringStyle,
          ]}
        />
        <View className="h-32 w-32 rounded-full bg-brand-blue/15 items-center justify-center">
          <Icon xml={Icons.IconContactlessCard} width={64} height={88} />
        </View>
      </View>
      <View className="items-center gap-2">
        <Text className="text-xl font-semibold text-ink">Hold the card</Text>
        <Text className="text-center text-muted-text">
          Place the Tapp Card against the back of your phone.
        </Text>
      </View>
    </View>
  );
}

function SpinnerView({ label }: { label: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-4">
      <ActivityIndicator color="#0065F5" />
      <Text className="text-muted-text">{label}</Text>
    </View>
  );
}

function PinView({ onSubmit }: { onSubmit: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || submitting) return;
    let cancelled = false;
    const captured = pin;
    setSubmitting(true);
    (async () => {
      try {
        await onSubmit(captured);
      } finally {
        if (!cancelled) {
          // Reset locally so the dots clear if we land back here on
          // a retry (e.g. wrong PIN response from server).
          setPin('');
          setErrorTick((t) => t + 1);
          setSubmitting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin, onSubmit, submitting]);

  return (
    <View className="flex-1 px-6 pt-2">
      <View className="items-center gap-8 mt-4">
        <View className="items-center gap-3">
          <Text className="text-2xl font-semibold text-ink">Enter Zoracle PIN</Text>
          <Text className="text-sm text-muted-text text-center">
            Hand the phone to the cardholder.
          </Text>
        </View>
        <PinDots filled={pin.length} length={PIN_LENGTH} errorTick={errorTick} />
      </View>
      <View className="flex-1 justify-center">
        <PinPad
          disabled={submitting}
          onPressDigit={(d) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))}
          onPressBackspace={() => setPin((p) => p.slice(0, -1))}
        />
      </View>
    </View>
  );
}

function WritingView({ label }: { label: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <View className="h-24 w-24 rounded-full bg-brand-blue/15 items-center justify-center">
        <Icon xml={Icons.IconContactlessCard} width={52} height={72} />
      </View>
      <Text className="text-lg font-semibold text-ink text-center">
        Payment received
      </Text>
      <Text className="text-center text-muted-text">{label}</Text>
      <ActivityIndicator color="#0065F5" />
    </View>
  );
}

function WriteRetryView({
  error,
  onRetry,
  onSkip,
}: {
  error: string;
  onRetry: () => void;
  onSkip: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <Text className="text-xl font-semibold text-ink text-center">
        Tap the card once more
      </Text>
      <Text className="text-center text-muted-text">{error}</Text>
      <Text className="text-xs text-muted-subtle text-center">
        The payment was charged — this step keeps the card in sync for the
        next merchant.
      </Text>
      <View className="w-full gap-3 mt-4">
        <Button label="Tap again" onPress={onRetry} />
        <Button label="Skip — cardholder will sync later" variant="ghost" onPress={onSkip} />
      </View>
    </View>
  );
}

function SettledView({ amount, onDone }: { amount: string; onDone: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <Icon xml={Icons.IconSuccessBadge} size={96} />
      <Text className="text-2xl font-semibold text-ink">Payment received</Text>
      <Text
        className="text-5xl font-bold text-ink"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {formatNgn(amount)}
      </Text>
      <View className="w-full mt-4">
        <Button label="Done" onPress={onDone} />
      </View>
    </View>
  );
}

function ProcessingView({
  amount,
  onDone,
}: {
  amount: string;
  onDone: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <ActivityIndicator color="#0065F5" />
      <Text className="text-xl font-semibold text-ink">Settling…</Text>
      <Text
        className="text-3xl font-bold text-ink"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {formatNgn(amount)}
      </Text>
      <Text className="text-center text-muted-text">
        The card was charged. Settlement is finishing — you can leave this
        screen.
      </Text>
      <View className="w-full mt-4">
        <Button label="Done" variant="secondary" onPress={onDone} />
      </View>
    </View>
  );
}

function FailedView({
  error,
  onRetry,
  onCancel,
}: {
  error: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <Text className="text-2xl font-semibold text-danger text-center">
        Couldn&apos;t charge the card
      </Text>
      <Text className="text-center text-muted-text">{error}</Text>
      <View className="w-full gap-3 mt-4">
        <Button label="Try again" onPress={onRetry} />
        <Button label="Use a different method" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}
