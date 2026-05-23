import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { kycApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Screen, Text } from '@/ui';
import { StepHeader } from '@/components/StepHeader';

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

export default function KybScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [pollUntil, setPollUntil] = useState<number | null>(null);

  const isPolling = !!pollUntil && Date.now() < pollUntil;
  const statusQuery = useQuery({
    queryKey: ['kyc', 'status', userId],
    queryFn: () => kycApi.status(userId ?? ''),
    enabled: !!userId && isPolling,
    refetchInterval: isPolling ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    if (statusQuery.data.status === 'success') {
      setPollUntil(null);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    } else if (statusQuery.data.status === 'failed') {
      setPollUntil(null);
      Alert.alert('Verification failed', 'Try again or use a different ID.');
    }
  }, [statusQuery.data, queryClient]);

  async function startVerification() {
    if (!userId) return;
    setStarting(true);
    try {
      const res = await kycApi.request({
        wallet_address: userId,
        id_types: [{ country: 'NG', id_type: 'BVN' }],
      });
      // Open Smile Identity hosted page in an in-app browser; user returns
      // to our app after they finish / cancel. We poll status either way.
      await WebBrowser.openBrowserAsync(res.url);
      setPollUntil(Date.now() + POLL_MAX_DURATION_MS);
    } catch (err) {
      Alert.alert(
        'Could not start verification',
        (err as { message?: string })?.message ?? 'Try again',
      );
    } finally {
      setStarting(false);
    }
  }

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(auth)/verify-email');
    }
  };

  return (
    <Screen scrollable={false}>
      <StepHeader
        step={3}
        totalSteps={4}
        title="Verify your identity"
        subtitle="We use your BVN to confirm your identity. Takes about 30 seconds."
        onBack={handleBack}
      />
      <View className="flex-1 gap-6 mt-4">

        <View className="gap-3 mt-4">
          <BulletRow text="Your BVN is never stored on our servers" />
          <BulletRow text="You won't be charged" />
          <BulletRow text="Required to enable bank payouts" />
        </View>

        <View className="flex-1" />

        {isPolling ? (
          <Text className="text-center text-muted-text mb-2">
            Verifying — this can take up to a minute.
          </Text>
        ) : null}

        <Button
          label={isPolling ? 'Verifying…' : 'Start verification'}
          onPress={startVerification}
          loading={starting || isPolling}
          disabled={isPolling}
        />
      </View>
    </Screen>
  );
}

function BulletRow({ text }: { text: string }) {
  return (
    <View className="flex-row gap-3 items-start">
      <View className="h-1.5 w-1.5 rounded-full bg-brand-blue mt-2.5" />
      <Text className="flex-1 text-ink-700">{text}</Text>
    </View>
  );
}
