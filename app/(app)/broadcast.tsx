import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, Icons, Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import { useTapBroadcast } from '@/hooks/useTapBroadcast';

cssInterop(View, { className: { target: 'style' } });
cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(SafeAreaView, { className: { target: 'style' } });

export default function BroadcastScreen() {
  const { amount, memo } = useLocalSearchParams<{ amount?: string; memo?: string }>();
  const { phase, cancel } = useTapBroadcast({
    amount: amount ?? '0',
    memo: typeof memo === 'string' ? memo : undefined,
  });

  if (phase.kind === 'creating') {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-surface-bg items-center justify-center">
        <ActivityIndicator color="#0065F5" />
        <Text className="mt-3 text-muted-text">Preparing payment…</Text>
      </SafeAreaView>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-surface-bg items-center justify-center px-6">
        <Text className="text-2xl font-bold text-danger mb-3">Couldn't start payment</Text>
        <Text className="text-center text-muted-text mb-8">{phase.error}</Text>
        <Button label="Go back" onPress={cancel} variant="secondary" />
      </SafeAreaView>
    );
  }

  if (phase.kind === 'settled') {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-surface-bg items-center justify-center px-6">
        <Icon xml={Icons.IconSuccessBadge} size={96} className="mb-6" />
        <Text className="text-2xl font-semibold text-ink mb-2">Payment received</Text>
        <Text
          className="text-5xl font-bold text-ink mb-8"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatNgn(phase.fiat_amount)}
        </Text>
        <Button label="Done" onPress={cancel} />
      </SafeAreaView>
    );
  }

  const order = 'order' in phase ? phase.order : null;
  const remainingMs = phase.kind === 'broadcasting' ? phase.remainingMs : 0;
  const detecting = phase.kind === 'detected';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-surface-bg">
      <View className="px-5 py-4 flex-row justify-between">
        <Pressable
          className="h-10 px-3 items-center justify-center rounded-md active:bg-surface-subtle"
          onPress={cancel}
        >
          <Text className="text-ink-700">←</Text>
        </Pressable>
        <Text className="text-muted-text" style={{ fontVariant: ['tabular-nums'] }}>
          {formatCountdown(remainingMs)}
        </Text>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-base text-muted-text mb-6">
          {detecting ? 'Payment detected, settling…' : 'Ready to receive'}
        </Text>

        {Platform.OS === 'android' ? (
          <NfcRing />
        ) : order ? (
          <View className="bg-white p-4 rounded-2xl border border-line-divider">
            <QRCode value={order.checkout_url} size={260} ecl="Q" />
          </View>
        ) : null}

        <Text
          className="text-5xl font-bold text-ink mt-10"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatNgn(amount ?? '0')}
        </Text>

        <Text className="text-center text-muted-text mt-6">
          {Platform.OS === 'android'
            ? 'Hold this phone against the customer’s phone.\nThey’ll tap to pay.'
            : 'Have your customer scan this QR with their camera.'}
        </Text>
      </View>

      <View className="px-5 pb-6">
        <Button label="Cancel" variant="secondary" onPress={cancel} />
      </View>
    </SafeAreaView>
  );
}

function NfcRing() {
  const scale = useSharedValue(0.85);
  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(scale);
  }, [scale]);

  const ring = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: 0.5 }));

  return (
    <View className="items-center justify-center" style={{ width: 260, height: 260 }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 240,
            height: 240,
            borderRadius: 120,
            borderWidth: 12,
            borderColor: '#0065F5',
          },
          ring,
        ]}
      />
      <View
        style={{
          width: 140,
          height: 140,
          borderRadius: 70,
          backgroundColor: '#0065F5',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon xml={Icons.IconContactlessCard} width={68} height={92} />
      </View>
    </View>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const _unused = useMemo; // keep import-stable in case future memoization is added
void _unused;
