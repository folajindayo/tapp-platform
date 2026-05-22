import { useEffect, useRef, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Header, Screen, Text } from '@/ui';

const CODE_LEN = 6;

export default function VerifyEmailScreen() {
  const email = useAuthStore((s) => s.user?.email ?? '');
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === CODE_LEN) {
      void submit(code);
    }
  }, [code]);

  async function submit(token: string) {
    setSubmitting(true);
    try {
      await authApi.confirmAccount({ token });
      // Invalidate /me so the root guard advances.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    } catch (err) {
      Alert.alert('Invalid code', (err as { message?: string })?.message ?? 'Try again');
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!email || cooldown > 0) return;
    setResending(true);
    try {
      await authApi.resendToken({ email });
      setCooldown(60);
      Alert.alert('Sent', 'We sent a new code to your email.');
    } catch (err) {
      Alert.alert('Could not resend', (err as { message?: string })?.message ?? 'Try again');
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen scrollable={false}>
      <Header back={false} />
      <View className="flex-1 gap-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">Check your email</Text>
          <Text className="text-muted-text">
            We sent a 6-digit code to{' '}
            <Text className="text-ink-700 font-semibold">{email || 'your email'}</Text>.
          </Text>
        </View>

        <View className="items-center mt-6">
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, CODE_LEN))}
            keyboardType="number-pad"
            maxLength={CODE_LEN}
            autoFocus
            style={{
              fontSize: 36,
              letterSpacing: 12,
              textAlign: 'center',
              minWidth: 240,
              color: '#272A33',
              fontVariant: ['tabular-nums'],
            }}
            placeholder="------"
            placeholderTextColor="#BCC1CA"
          />
        </View>

        <View className="flex-1" />

        <Button
          label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          variant="ghost"
          onPress={resend}
          loading={resending}
          disabled={cooldown > 0 || !email}
        />
        {submitting ? (
          <Text className="text-center text-muted-text">Verifying…</Text>
        ) : null}
      </View>
    </Screen>
  );
}
