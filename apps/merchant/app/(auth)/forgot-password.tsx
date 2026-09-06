import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ChevronLeft, Mail } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '@/api/endpoints';
import type { ApiError } from '@/api/types';
import { Button, Input, Text } from '@/ui';
import { colors } from '@/ui/theme';

const schema = z.object({ email: z.string().email('Enter a valid email') });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false);
  const { control, handleSubmit, formState, getValues } = useForm<FormValues>({
    defaultValues: { email: '' },
    mode: 'onChange',
  });

  const mutation = useMutation<{ ok: true }, ApiError, FormValues>({
    mutationFn: (values) => authApi.resetPasswordToken(values),
    onSuccess: () => setSent(true),
    onError: () => {},
  });

  const mutationError = mutation.error?.message;

  // ── Success state ────────────────────────────────────────────
  if (sent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.black }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
          {/* Icon */}
          <View style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 28,
          }}>
            <Mail size={32} color={colors.brand} />
          </View>

          <Text style={{
            fontSize: 28,
            fontFamily: 'BricolageGrotesque-Bold',
            color: colors.textStrong,
            textAlign: 'center',
            marginBottom: 12,
          }}>
            Check your inbox
          </Text>
          <Text style={{
            fontSize: 15,
            color: colors.textMuted,
            fontFamily: 'BricolageGrotesque-Regular',
            textAlign: 'center',
            lineHeight: 22,
            marginBottom: 40,
          }}>
            We sent reset instructions to{' '}
            <Text style={{ color: colors.text, fontFamily: 'BricolageGrotesque-SemiBold' }}>
              {getValues('email')}
            </Text>
            {'. Copy the token from the email and use it on the next screen.'}
          </Text>

          <View style={{ width: '100%', gap: 12 }}>
            <Button
              label="Enter reset token"
              onPress={() => router.push('/(auth)/reset-password')}
            />
            <Button
              label="Back to sign in"
              variant="ghost"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Email entry ──────────────────────────────────────────────
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
              <Mail size={24} color={colors.brand} />
            </View>

            <Text style={{
              fontSize: 30,
              fontFamily: 'BricolageGrotesque-Bold',
              color: colors.textStrong,
              lineHeight: 38,
              marginBottom: 8,
            }}>
              Reset password
            </Text>
            <Text style={{ fontSize: 15, color: colors.textMuted, fontFamily: 'BricolageGrotesque-Regular', lineHeight: 22 }}>
              Enter your email and we'll send you a reset link
            </Text>
          </View>

          {/* ── Form ──────────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 28, gap: 16 }}>
            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <Input
                  label="Email address"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
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
                <Text style={{ color: colors.danger, fontSize: 13, fontFamily: 'BricolageGrotesque-Medium' }}>
                  {mutationError}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ flex: 1, minHeight: 40 }} />

          {/* ── CTA ───────────────────────────────────────────── */}
          <View style={{ paddingHorizontal: 28, paddingBottom: 20 }}>
            <Button
              label="Send reset email"
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
