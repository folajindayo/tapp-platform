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

import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCodeStyled from 'react-native-qrcode-styled';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react-native';
import { useTapBroadcast } from '@/hooks/useTapBroadcast';
import { Text } from '@/ui';
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

export default function AcceptPaymentScreen() {
  const { amount, memo } = useLocalSearchParams<{ amount?: string; memo?: string }>();
  const amountStr = typeof amount === 'string' ? amount : '0';
  const memoStr = typeof memo === 'string' ? memo : undefined;
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Reuse the existing broadcast hook — it creates the order via Rails
  // and subscribes to settlement events. The NFC HCE side of the hook is
  // a no-op when we don't call NfcHce.start (which we don't here — we
  // show a QR instead).
  const { phase, cancel } = useTapBroadcast({ amount: amountStr, memo: memoStr });

  const order = 'order' in phase ? phase.order : null;
  const checkoutUrl = order?.checkout_url ?? null;

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
        <View style={s.header}>
          <Pressable hitSlop={12} onPress={cancel} style={s.backBtn}>
            <ChevronLeft size={22} color={PAL.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerLabel}>Charge</Text>
            <Text style={s.headerAmount}>{formatNgn(amountStr)}</Text>
          </View>
          <View style={s.headerRight} />
        </View>

        {/* Main card — both affordances stacked */}
        <View style={s.card}>
          {/* QR — visible affordance for phone payment */}
          <View style={s.qrSlot}>
            {checkoutUrl ? (
              <View style={[s.qrSurface, { borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)' }]}>
                <QRCodeStyled
                  data={checkoutUrl}
                  size={196}
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

          {/* OR divider */}
          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          {/* NFC zone — invisible affordance for card tap */}
          <View style={s.nfcSlot}>
            <NfcPulse />
            <Text style={s.affordanceLabel}>Tap card here</Text>
            <Text style={s.affordanceHint}>Customer holds Tapp card to the back</Text>
          </View>
        </View>

        {/* Status footer */}
        <View style={s.footer}>
          <View style={s.statusDot} />
          <Text style={s.statusText}>
            {phase.kind === 'creating' ? 'Preparing payment…'
              : phase.kind === 'detected' ? 'Settling…'
              : 'Waiting for payment'}
          </Text>
        </View>
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
    width: 228,
    height: 228,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
  },
  affordanceLabel: {
    marginTop: 6,
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 15,
    color: PAL.text,
  },
  affordanceHint: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 12,
    color: PAL.textMuted,
  },

  // OR divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 10,
    paddingVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: PAL.divider,
  },
  dividerText: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 11,
    color: PAL.textSubtle,
    letterSpacing: 1.2,
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
