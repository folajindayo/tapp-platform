import { useEffect, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { cssInterop } from 'nativewind';
import { merchantApi } from '@/api/endpoints';
import { Text } from '@/ui';

cssInterop(View, { className: { target: 'style' } });

interface StepUpQRProps {
  /** URL the cardholder scans (server-issued, signed). */
  url: string;
  /** Opaque token that the merchant app echoes back when re-submitting. */
  token: string;
  /** Fires when the cardholder grants the request in their PWA. */
  onGranted: (token: string) => void;
  /** Fires when the cardholder denies or the token expires. */
  onDeniedOrExpired: (reason: 'denied' | 'expired') => void;
}

/**
 * Step-up QR + polling loop. Rendered as a full-screen panel within
 * the Tap Card view (not a route) so the NFC session and underlying
 * state stay co-located with the orchestrator hook.
 */
export function StepUpQR({ url, token, onGranted, onDeniedOrExpired }: StepUpQRProps) {
  const [tick, setTick] = useState(0);

  // Poll every 1.5s. Stop once the parent unmounts us or we resolve.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      try {
        const resp = await merchantApi.tapCardStepUpPoll(token);
        if (resp.status === 'granted') {
          cancelled = true;
          clearInterval(id);
          onGranted(token);
        } else if (resp.status === 'denied' || resp.status === 'expired') {
          cancelled = true;
          clearInterval(id);
          onDeniedOrExpired(resp.status);
        }
        setTick((n) => n + 1);
      } catch {
        // Network blip — keep polling silently.
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, onGranted, onDeniedOrExpired]);

  return (
    <View className="flex-1 items-center justify-center px-6 gap-6">
      <Text className="text-2xl font-semibold text-ink text-center">
        Verify on your phone
      </Text>
      <View className="bg-surface p-4 rounded-2xl border border-line-divider">
        <QRCode value={url} size={260} ecl="Q" />
      </View>
      <View className="items-center gap-2">
        <Text className="text-muted-text text-center">
          Scan this with your phone to confirm with Face ID.
        </Text>
        <View className="flex-row items-center gap-2 mt-2">
          <PulsingDot />
          <Text className="text-sm text-muted-subtle">Waiting for OK… ({tick})</Text>
        </View>
      </View>
    </View>
  );
}

function PulsingDot() {
  // Tiny static green dot — full pulse animation is overkill for this
  // single status indicator. Per MOTION_PRINCIPLES § "Never animate
  // repeated actions" — a constant pulse on a polling indicator drains
  // attention with no information.
  return <View className="w-2 h-2 rounded-full bg-brand" />;
}
