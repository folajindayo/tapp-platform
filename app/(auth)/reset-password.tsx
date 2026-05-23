import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ChevronLeft, CheckCircle, KeyRound } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '@/api/endpoints';
import type { ApiError } from '@/api/types';
import { Button, Input, Text } from '@/ui';
import { colors } from '@/ui/theme';

const schema = z.object({
  token: z.string().min(1, 'Enter the token from your email'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/[0-9]/, 'Include a number'),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: "Passwords don't match",
  path: ['confirm'],
});

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordScreen() {
  const [done, setDone] = useState(false);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { token: '', password: '', confirm: '' },
    mode: 'onChange',
  });

  const mutation = useMutation<{ ok: true }, ApiError, FormValues>({
    mutationFn: ({ token, password }) => authApi.resetPassword({ token, password }),
    onSuccess: () => setDone(true),
    onError: () => {},
  });

  const mutationError = mutation.error?.message;

  // ── Success state ────────────────────────────────────────────
  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.black }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
          <View style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            backgroundColor: colors.successBg,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 28,
          }}>
            <CheckCircle size={36} color={colors.success} />
          </View>

          <Text style={{
            fontSize: 28,
            fontFamily: 'OpenSans-Bold',
            color: colors.textStrong,
            textAlign: 'center',
            marginBottom: 12,
          }}>
            Password updated
          </Text>
          <Text style={{
            fontSize: 15,
            color: colors.textMuted,
            fontFamily: 'OpenSans-Regular',
            textAlign: 'center',
            lineHeight: 22,
            marginBottom: 40,
          }}>
            You can now sign in with your new password.
          </Text>

          <View style={{ width: '100%' }}>
            <Button
              label="Sign in"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Form ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.black }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ────────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <Pressable
              onPress={router.back}
              hitSlop={12}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChevronLeft size={22} color={colors.text} />
            </Pressable>
          </View>

          {/* ── Hero ──────────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 28, paddingTop: 32, paddingBottom: 40 }}>
            <View style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
            }}>
              <KeyRound size={24} color={colors.brand} />
            </View>

            <Text style={{
              fontSize: 30,
              fontFamily: 'OpenSans-Bold',
              color: colors.textStrong,
              lineHeight: 38,
              marginBottom: 8,
            }}>
              Set new password
            </Text>
            <Text style={{ fontSize: 15, color: colors.textMuted, fontFamily: 'OpenSans-Regular', lineHeight: 22 }}>
              Paste the token from your email, then choose a new password
            </Text>
          </View>

          {/* ── Form ──────────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 28, gap: 16 }}>
            <Controller
              control={control}
              name="token"
              render={({ field, fieldState }) => (
                <Input
                  label="Reset token"
                  placeholder="Paste token from email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <Input
                  label="New password"
                  placeholder="At least 8 characters"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  returnKeyType="next"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  hint="8+ characters, 1 letter, 1 number"
                />
              )}
            />

            <Controller
              control={control}
              name="confirm"
              render={({ field, fieldState }) => (
                <Input
                  label="Confirm password"
                  placeholder="Same as above"
                  secureTextEntry
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit((v) => mutation.mutate(v))}
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />

            {mutationError ? (
              <View style={{
                backgroundColor: colors.dangerBg,
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
              }}>
                <Text style={{ color: colors.danger, fontSize: 13, fontFamily: 'OpenSans-Medium' }}>
                  {mutationError}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ flex: 1, minHeight: 40 }} />

          {/* ── CTA ───────────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 28, paddingBottom: 20 }}>
            <Button
              label="Update password"
              onPress={handleSubmit((v) => mutation.mutate(v))}
              loading={mutation.isPending}
              disabled={!formState.isValid || mutation.isPending}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
