// Unified payment-accept screen — experiment.
//
// One screen, two visible affordances. The merchant doesn't pre-choose
// the customer's payment method; the customer self-selects with whatever's
// in their hand (Tapp card → NFC, Tapp phone → QR).
//
// Visual language ported from /Users/mac/tapp/app/wallet/page.tsx:
//   - rounded-3xl bordered card containing the affordances
//   - generous breathing room, strong type hierarchy
//   - dark-mode native
//
// v1: layout only. QR shows the checkout URL once Rails returns it. NFC
// reader (Tap card) is visual-only; wire to expo-nfc-manager in a
// follow-up.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCodeStyled from 'react-native-qrcode-styled';
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
import { ChevronLeft } from 'lucide-react-native';
import { useTapBroadcast } from '@/hooks/useTapBroadcast';
import { useTapCard, type TapCardPhase } from '@/hooks/useTapCard';
import { StepUpQR } from '@/components/StepUpQR';
import { Button, Icon, Icons, PinDots, PinPad, Text } from '@/ui';
import { formatNgn } from '@/ui/format';

const PAL = {
  bg:         '#0D0D0D',
  cardBg:     '#121214',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  qrCard:     '#FFFFFF',
  text:       '#FFFFFF',
  textMuted:  'rgba(255, 255, 255, 0.55)',
  textSubtle: 'rgba(255, 255, 255, 0.35)',
  divider:    'rgba(255, 255, 255, 0.08)',
  pulse:      '#3B82F6',
  pulseRing:  'rgba(59, 130, 246, 0.35)',
  success:    '#22C55E',
} as const;

const FADE = FadeIn.duration(220).easing(Easing.bezier(0.32, 0.72, 0, 1).factory());
const FADE_OUT = FadeOut.duration(180).easing(Easing.bezier(0.32, 0.72, 0, 1).factory());

export default function AcceptPaymentScreen() {
  const { amount, memo } = useLocalSearchParams<{ amount?: string; memo?: string }>();
  const amountStr = typeof amount === 'string' ? amount : '0';
  const memoStr = typeof memo === 'string' ? memo : undefined;
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [activeTab, setActiveTab] = useState<'nfc' | 'scan'>('nfc');

  // The broadcast order is only created once the QR method is chosen.
  const { phase, cancel } = useTapBroadcast({
    amount: amountStr,
    memo: memoStr,
    enabled: activeTab === 'scan',
  });

  const tap = useTapCard({
    amount: amountStr,
    memo: memoStr,
    enabled: activeTab === 'nfc',
  });

  const order = 'order' in phase ? phase.order : null;
  const checkoutUrl = order?.checkout_url ?? null;

  const handleCancel = () => {
    if (activeTab === 'nfc') {
      tap.cancel();
    } else {
      cancel();
    }
  };

  // Settled state takes over the entire card — full-bleed success.
  if (phase.kind === 'settled') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={s.root}>
        <View style={s.body}>
          <View style={s.settledWrap}>
            <View style={s.settledCheck}>
              <Text style={s.settledMark}>✓</Text>
            </View>
            <Text style={s.settledTitle}>Payment received</Text>
            <Text style={s.settledAmount}>{formatNgn(phase.fiat_amount)}</Text>
          </View>
          <Pressable onPress={cancel} style={s.doneButton}>
            <Text style={s.doneLabel}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={s.root}>
        <View style={s.body}>
          <View style={s.settledWrap}>
            <Text style={[s.settledTitle, { color: '#F43F5E' }]}>Couldn’t start payment</Text>
            <Text style={s.helperText}>{phase.error}</Text>
          </View>
          <Pressable onPress={cancel} style={s.doneButton}>
            <Text style={s.doneLabel}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.root}>
      <View style={s.body}>
        {/* Header: small back + amount */}
        {activeTab !== 'nfc' ? (
          <View style={s.header}>
            <Pressable hitSlop={12} onPress={handleCancel} style={s.backBtn}>
              <ChevronLeft size={22} color={PAL.text} />
            </Pressable>
            <View style={s.headerCenter}>
              <Text style={s.headerLabel}>Charge</Text>
              <Text style={s.headerAmount}>{formatNgn(amountStr)}</Text>
            </View>
            <View style={s.headerRight} />
          </View>
        ) : (
          <View style={{ height: 40 }} />
        )}

        {/* Main card — tabbed affordance */}
        <View style={s.card}>
          {/* Segmented Control / Tab Bar */}
          <View style={s.tabContainer}>
            <Pressable
              onPress={() => setActiveTab('nfc')}
              style={[s.tabButton, activeTab === 'nfc' && s.tabButtonActive]}
            >
              <Text style={[s.tabLabel, activeTab === 'nfc' && s.tabLabelActive]}>NFC Tap</Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('scan')}
              style={[s.tabButton, activeTab === 'scan' && s.tabButtonActive]}
            >
              <Text style={[s.tabLabel, activeTab === 'scan' && s.tabLabelActive]}>QR Scan</Text>
            </Pressable>
          </View>

          {activeTab === 'scan' ? (
            /* QR — visible affordance for phone payment (creates the order). */
            <View style={s.qrSlot}>
              {checkoutUrl ? (
                <View style={[s.qrSurface, { borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)' }]}>
                  <QRCodeStyled
                    data={checkoutUrl}
                    size={220}
                    color={isDark ? '#FFFFFF' : '#121212'}
                    style={{ backgroundColor: 'transparent' }}
                    pieceCornerType="rounded"
                    pieceBorderRadius={4}
                    isPiecesGlued={true}
                    outerEyesOptions={{
                      borderRadius: 12,
                      color: isDark ? '#FFFFFF' : '#121212',
                    }}
                    innerEyesOptions={{
                      borderRadius: 6,
                      color: isDark ? '#FFFFFF' : '#121212',
                    }}
                  />
                </View>
              ) : (
                <View style={[s.qrSurface, s.qrPlaceholder, { borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)' }]}>
                  <ActivityIndicator color={isDark ? '#FFFFFF' : '#121212'} />
                </View>
              )}
              <Text style={s.affordanceLabel}>Scan with phone</Text>
              <Text style={s.affordanceHint}>Customer opens camera and scans</Text>
            </View>
          ) : (
            /* NFC Tap interface embedded directly below the tab! */
            <Animated.View
              key={tap.phase.kind}
              entering={FADE}
              exiting={FADE_OUT}
              className="flex-1 w-full"
            >
              <NfcBody
                phase={tap.phase}
                amount={amountStr}
                submitPin={tap.submitPin}
                submitStepUp={tap.submitStepUp}
                retry={tap.retry}
                retryWrite={tap.retryWrite}
                cancel={tap.cancel}
              />
            </Animated.View>
          )}

          {/* Bottom spacer to balance card content vertically */}
          <View style={{ height: 20 }} />
        </View>

        {/* Status footer */}
        {activeTab === 'scan' && (
          <View style={s.footer}>
            <View style={s.statusDot} />
            <Text style={s.statusText}>
              {phase.kind === 'creating' ? 'Preparing payment…'
                : phase.kind === 'detected' ? 'Tap received — confirming…'
                : phase.kind === 'processing' ? 'Bridging funds…'
                : phase.kind === 'fulfilled' ? 'Settling to your bank…'
                : 'Waiting for payment'}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── NFC pulse — visual cue that "something's listening here". For real
// reader-mode integration, swap with NfcManager and trigger the haptic +
// stop-animation on tag detection.

function NfcPulse() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.5, { duration: 1400, easing: Easing.out(Easing.cubic) }),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withTiming(0, { duration: 1400, easing: Easing.out(Easing.cubic) }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [scale, opacity]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={s.pulseWrap}>
      <Animated.View style={[s.pulseRing, ring]} />
      <View style={s.pulseCore}>
        <View style={s.pulseDot} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAL.bg },
  body: { flex: 1, paddingHorizontal: 20, paddingBottom: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: { width: 40 },
  headerLabel: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: PAL.textMuted,
    marginBottom: 2,
  },
  headerAmount: {
    fontFamily: 'BricolageGrotesque-Bold',
    fontSize: 22,
    color: PAL.text,
    fontVariant: ['tabular-nums'],
  },

  // Affordance card
  card: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  qrSlot: {
    alignItems: 'center',
    gap: 8,
  },
  qrSurface: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  qrPlaceholder: {
    width: 252,
    height: 252,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
  },
  affordanceLabel: {
    marginTop: 12,
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 15,
    color: PAL.text,
  },
  affordanceHint: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 12,
    color: PAL.textMuted,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    padding: 4,
    width: '100%',
    maxWidth: 300,
    marginBottom: 24,
  },
  tabButton: {
    flex: 1,
    height: 36,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  tabLabel: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.45)',
  },
  tabLabelActive: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    color: '#FFFFFF',
  },

  // NFC slot
  nfcSlot: {
    alignItems: 'center',
    gap: 8,
  },
  pulseWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  pulseRing: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PAL.pulseRing,
  },
  pulseCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: PAL.pulse,
  },

  // Footer status
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PAL.pulse,
  },
  statusText: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 13,
    color: PAL.textMuted,
  },

  // Settled / failed states
  settledWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  settledCheck: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settledMark: {
    fontFamily: 'BricolageGrotesque-Bold',
    fontSize: 40,
    color: PAL.success,
  },
  settledTitle: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 20,
    color: PAL.text,
  },
  settledAmount: {
    fontFamily: 'BricolageGrotesque-Bold',
    fontSize: 40,
    color: PAL.text,
    fontVariant: ['tabular-nums'],
  },
  helperText: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 13,
    color: PAL.textMuted,
    textAlign: 'center',
  },

  // Done button
  doneButton: {
    height: 56,
    borderRadius: 16,
    backgroundColor: PAL.pulse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneLabel: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
});

// -----------------------------------------------------------------------------
// HCE NFC embedded sub-views
// -----------------------------------------------------------------------------

const PIN_LENGTH = 4;

function NfcBody({
  phase,
  amount,
  submitPin,
  submitStepUp,
  retry,
  retryWrite,
  cancel,
}: {
  phase: TapCardPhase;
  amount: string;
  submitPin: (pin: string) => Promise<void>;
  submitStepUp: (token: string) => Promise<void>;
  retry: () => void;
  retryWrite: () => void;
  cancel: () => void;
}) {
  switch (phase.kind) {
    case 'scanning':
    case 'reading':
      return <ScanningView amount={amount} />;
    case 'resolving':
      return <SpinnerView label={`Authorizing… · ${formatNgn(amount)}`} />;
    case 'charging-none':
    case 'charging-pin':
    case 'charging-step-up':
      return <SpinnerView label={`Charging card… · ${formatNgn(amount)}`} />;
    case 'pin-required':
      return <PinView onSubmit={submitPin} />;
    case 'step-up-required':
      return (
        <StepUpQR
          url={phase.stepUpUrl}
          token={phase.stepUpToken}
          onGranted={submitStepUp}
          onDeniedOrExpired={() => undefined}
        />
      );
    case 'step-up-polling':
      return <SpinnerView label={`Verifying… · ${formatNgn(amount)}`} />;
    case 'writing':
      return <WritingView label="Tap the card once more to finalize" amount={amount} />;
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

function ScanningView({ amount }: { amount: string }) {
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
        <Text variant="titleMedium" className="text-center">
          Hold the card · {formatNgn(amount)}
        </Text>
        <Text variant="bodyMuted" className="text-center">
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
      <Text variant="bodyMuted" className="text-center">{label}</Text>
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
          <Text variant="titleMedium" className="text-center">Enter Zoracle PIN</Text>
          <Text variant="bodyMuted" className="text-center">
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

function WritingView({ label, amount }: { label: string; amount: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <View className="h-24 w-24 rounded-full bg-brand-blue/15 items-center justify-center">
        <Icon xml={Icons.IconContactlessCard} width={52} height={72} />
      </View>
      <Text variant="titleMedium" className="text-center">
        Payment received · {formatNgn(amount)}
      </Text>
      <Text variant="bodyMuted" className="text-center">{label}</Text>
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
      <Text variant="titleMedium" className="text-center">
        Tap the card once more
      </Text>
      <Text variant="bodyMuted" className="text-center">{error}</Text>
      <Text variant="caption" className="text-center">
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
      <Text variant="titleMedium" className="text-center">Payment received</Text>
      <Text
        variant="amount"
        className="text-center"
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
      <Text variant="titleMedium" className="text-center">Settling…</Text>
      <Text
        variant="amount"
        className="text-center text-4xl"
      >
        {formatNgn(amount)}
      </Text>
      <Text variant="bodyMuted" className="text-center">
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
      <Text variant="titleMedium" className="text-danger text-center">
        Couldn&apos;t charge the card
      </Text>
      <Text variant="bodyMuted" className="text-center">{error}</Text>
      <View className="w-full gap-3 mt-4">
        <Button label="Try again" onPress={onRetry} />
        <Button label="Use a different method" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}
