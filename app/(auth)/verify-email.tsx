import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '@/api/endpoints';
import type { ApiError } from '@/api/types';
import { useAuthStore } from '@/auth/store';
import { queryKeys } from '@/queries/keys';
import { Button, Text } from '@/ui';
import { colors } from '@/ui/theme';

const CODE_LEN = 6;

export default function VerifyEmailScreen() {
  const email = useAuthStore((s) => s.user?.email ?? '');
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [confirmError, setConfirmError] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const confirmMutation = useMutation<{ ok: true }, ApiError, string>({
    mutationFn: (token) => authApi.confirmAccount({ token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
    },
    onError: (err) => {
      setConfirmError(err.message ?? 'Invalid code. Try again.');
      setCode('');
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  });

  const resendMutation = useMutation<{ ok: true }, ApiError>({
    mutationFn: () => authApi.resendToken({ email }),
    onSuccess: () => setCooldown(60),
    onError: () => {},
  });

  function handleCodeChange(text: string) {
    const cleaned = text.replace(/[^0-9]/g, '').slice(0, CODE_LEN);
    setCode(cleaned);
    setConfirmError('');
    if (cleaned.length === CODE_LEN) {
      confirmMutation.mutate(cleaned);
    }
  }

  const isVerifying = confirmMutation.isPending;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.black }} edges={['top', 'bottom']}>
      {/* Hidden real input */}
      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={handleCodeChange}
        keyboardType="number-pad"
        maxLength={CODE_LEN}
        editable={!isVerifying}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
        autoFocus
      />

      <View style={{ flex: 1, paddingHorizontal: 28 }}>
        {/* ── Hero ────────────────────────────────────────────── */}
        <View style={{ paddingTop: 52, paddingBottom: 44 }}>
          <View style={{
            position: 'absolute',
            top: 20,
            left: -28,
            width: 200,
            height: 200,
            borderRadius: 100,
            backgroundColor: colors.brand,
            opacity: 0.06,
          }} />

          {/* Icon */}
          <View style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            backgroundColor: colors.brand,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 28,
            shadowColor: colors.brand,
            shadowOpacity: 0.45,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 20,
            elevation: 10,
          }}>
            <Text style={{ fontSize: 26, lineHeight: 32 }}>✉️</Text>
          </View>

          <Text style={{
            fontSize: 30,
            fontFamily: 'OpenSans-Bold',
            color: colors.textStrong,
            lineHeight: 38,
            marginBottom: 8,
          }}>
            Check your email
          </Text>
          <Text style={{ fontSize: 15, color: colors.textMuted, fontFamily: 'OpenSans-Regular', lineHeight: 22 }}>
            We sent a 6-digit code to{' '}
            <Text style={{ color: colors.text, fontFamily: 'OpenSans-SemiBold' }}>
              {email || 'your email'}
            </Text>
          </Text>
        </View>

        {/* ── OTP digit boxes ─────────────────────────────────── */}
        <Pressable
          onPress={() => inputRef.current?.focus()}
          style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}
        >
          {Array.from({ length: CODE_LEN }).map((_, i) => {
            const char = code[i] ?? '';
            const isCursor = i === code.length && !isVerifying;
            const hasError = !!confirmError;

            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 60,
                  borderRadius: 14,
                  backgroundColor: colors.surface,
                  borderWidth: 2,
                  borderColor: hasError
                    ? colors.danger
                    : isCursor
                    ? colors.brand
                    : char
                    ? colors.borderStrong
                    : colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isCursor && !char ? (
                  // Blinking cursor indicator
                  <View style={{
                    width: 2,
                    height: 24,
                    borderRadius: 1,
                    backgroundColor: colors.brand,
                  }} />
                ) : (
                  <Text style={{
                    fontSize: 22,
                    fontFamily: 'OpenSans-Bold',
                    color: hasError ? colors.danger : colors.textStrong,
                    lineHeight: 28,
                  }}>
                    {char}
                  </Text>
                )}
              </View>
            );
          })}
        </Pressable>

        {/* Status / error */}
        <View style={{ height: 32, marginTop: 12, alignItems: 'center', justifyContent: 'center' }}>
          {isVerifying ? (
            <Text style={{ color: colors.textMuted, fontSize: 13, fontFamily: 'OpenSans-Regular' }}>
              Verifying…
            </Text>
          ) : confirmError ? (
            <Text style={{ color: colors.danger, fontSize: 13, fontFamily: 'OpenSans-Medium' }}>
              {confirmError}
            </Text>
          ) : null}
        </View>

        <View style={{ flex: 1 }} />

        {/* ── Resend ──────────────────────────────────────────── */}
        <View style={{ paddingBottom: 20, gap: 12 }}>
          <Text style={{
            textAlign: 'center',
            fontSize: 14,
            color: colors.textMuted,
            fontFamily: 'OpenSans-Regular',
          }}>
            Didn't receive it?
          </Text>
          <Button
            label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            variant="secondary"
            onPress={() => resendMutation.mutate()}
            loading={resendMutation.isPending}
            disabled={cooldown > 0 || !email || resendMutation.isPending}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
