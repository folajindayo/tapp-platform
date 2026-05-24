import { useEffect, useRef, useState } from 'react';
import { Alert, TextInput, View, useColorScheme } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Screen, Text } from '@/ui';
import { StepHeader } from '@/components/StepHeader';

const CODE_LEN = 6;

export default function VerifyEmailScreen() {
  const { email: paramEmail } = useLocalSearchParams<{ email?: string }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const storeEmail = useAuthStore((s) => s.user?.email);

  // Email is available from the auth store for authenticated users (signed in
  // via password), or from route params for unauthenticated users (just
  // registered but email not yet verified).
  const email = storeEmail ?? paramEmail ?? '';

  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === CODE_LEN) void submit(code);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function submit(token: string) {
    setSubmitting(true);
    try {
      // Rails requires both fields — the (token, email) pair scopes the
      // verification row uniquely so codes can't collide across users.
      if (!email) {
        Alert.alert('Email missing', 'Please go back and re-enter your email.');
        return;
      }
      await authApi.confirmAccount({ token, email });

      if (isAuthenticated) {
        // Authenticated path: invalidate /me so the Guard sees the updated
        // is_email_verified flag and advances to the next onboarding step.
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      } else {
        // Unauthenticated path: user registered but couldn't log in until now.
        // Route back to the password screen so they can sign in; a success
        // banner will tell them their email is verified.
        router.replace({
          pathname: '/(auth)/password',
          params: { email, verified: 'true' },
        });
      }
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
      await authApi.resendToken({ email, scope: 'emailVerification' });
      setCooldown(60);
      Alert.alert('Sent', 'We sent a new code to your email.');
    } catch (err) {
      Alert.alert('Could not resend', (err as { message?: string })?.message ?? 'Try again');
    } finally {
      setResending(false);
    }
  }

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(auth)/sign-up');
    }
  };

  return (
    <Screen scrollable={false} className="bg-surface-bg dark:bg-neutral-950 px-4">
      <View className="absolute top-0 left-0 right-0 bottom-0 overflow-hidden" pointerEvents="none">
        <View className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full bg-brand-blue/5 dark:bg-brand-blue/10 opacity-70" />
        <View className="absolute -bottom-20 -left-20 w-[320px] h-[320px] rounded-full bg-brand-blue/5 dark:bg-brand-blue/10 opacity-45" />
      </View>

      <StepHeader
        step={2}
        totalSteps={4}
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${email || 'your email'}.`}
        isFirstStep={true}
        onBack={handleBack}
      />

      <Animated.View
        entering={FadeInDown.duration(450).delay(100)}
        className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-[32px] p-6 gap-6 w-full mt-4 flex-1 justify-between"
      >
        <View className="flex-1 justify-center items-center">
          <Text className="text-sm text-center text-muted-text mb-6">
            Enter the 6-digit verification code below
          </Text>

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
              color: isDark ? '#FFFFFF' : '#121212',
              fontVariant: ['tabular-nums'],
              fontWeight: '700',
            }}
            placeholder="------"
            placeholderTextColor={isDark ? '#444444' : '#BCC1CA'}
          />
        </View>

        <View className="gap-4 w-full">
          {submitting ? (
            <Text className="text-center text-brand-blue font-semibold animate-pulse">Verifying…</Text>
          ) : (
            <View className="h-[20px]" />
          )}

          <Button
            label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            variant="ghost"
            onPress={resend}
            loading={resending}
            disabled={cooldown > 0 || !email}
          />
        </View>
      </Animated.View>
    </Screen>
  );
}
