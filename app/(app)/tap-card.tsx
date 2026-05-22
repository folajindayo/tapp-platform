import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, Icons, Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import { useTapCard } from '@/hooks/useTapCard';

cssInterop(View, { className: { target: 'style' } });
cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(SafeAreaView, { className: { target: 'style' } });

export default function TapCardScreen() {
  const { amount, memo } = useLocalSearchParams<{ amount?: string; memo?: string }>();
  const { phase, cancel, retry } = useTapCard({
    amount: amount ?? '0',
    memo: typeof memo === 'string' ? memo : undefined,
  });

  if (phase.kind === 'settled') {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-white items-center justify-center px-6">
        <Icon xml={Icons.IconSuccessBadge} size={96} className="mb-6" />
        <Text className="text-2xl font-semibold text-ink mb-2">Payment received</Text>
        <Text
          className="text-5xl font-bold text-ink mb-8"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatNgn(phase.response.amount)}
        </Text>
        <Button label="Done" onPress={cancel} />
      </SafeAreaView>
    );
  }

  if (phase.kind === 'processing') {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-white items-center justify-center px-6">
        <ActivityIndicator color="#40FF00" />
        <Text className="mt-4 text-xl font-semibold text-ink">Settling…</Text>
        <Text className="mt-2 text-center text-muted-text">
          The card was charged. Settlement is finishing — you can leave this screen.
        </Text>
        <View className="h-8" />
        <Button label="Done" variant="secondary" onPress={cancel} />
      </SafeAreaView>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-2xl font-bold text-danger mb-3">Couldn't charge the card</Text>
        <Text className="text-center text-muted-text mb-8">{phase.error}</Text>
        <Button label="Try again" onPress={retry} className="w-full mb-3" />
        <Button label="Use a different method" variant="secondary" onPress={cancel} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-white">
      <View className="px-5 py-4 flex-row justify-between items-center">
        <Pressable
          className="h-10 px-3 items-center justify-center rounded-md active:bg-surface-subtle"
          onPress={cancel}
        >
          <Text className="text-ink-700">←</Text>
        </Pressable>
        <Text className="text-base font-semibold text-ink">Tap Card</Text>
        <View className="w-10" />
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <View className="h-32 w-32 rounded-full bg-brand-green/15 items-center justify-center mb-8">
          <Icon xml={Icons.IconContactlessCard} width={64} height={88} />
        </View>

        <Text
          className="text-5xl font-bold text-ink mb-8"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatNgn(amount ?? '0')}
        </Text>

        {phase.kind === 'charging' ? (
          <View className="items-center">
            <ActivityIndicator color="#40FF00" />
            <Text className="mt-3 text-muted-text">Charging card…</Text>
          </View>
        ) : (
          <Text className="text-center text-muted-text">
            Hold the customer’s Tapp Card to{'\n'}
            the back of your phone (Android){'\n'}
            or the top of your iPhone.
          </Text>
        )}
      </View>

      <View className="px-5 pb-6">
        <Button label="Cancel" variant="secondary" onPress={cancel} />
      </View>
    </SafeAreaView>
  );
}
