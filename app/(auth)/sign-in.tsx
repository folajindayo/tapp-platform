import { Keyboard, Pressable, ScrollView, View } from 'react-native';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '@/api/endpoints';
import type { ApiError } from '@/api/types';
import { useAuthStore } from '@/auth/store';
import { Button, Input, Text } from '@/ui';
import { colors } from '@/ui/theme';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export default function SignInScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { email: '', password: '' },
    mode: 'onChange',
  });

  const mutation = useMutation<Awaited<ReturnType<typeof authApi.login>>, ApiError, FormValues>({
    mutationFn: (values) => authApi.login(values),
    onSuccess: (data) => {
      setSession(data.accessToken, data.refreshToken);
    },
    onError: (err) => {
      void err;
    },
  });

  const mutationError = mutation.error?.message;

  function submit() {
    Keyboard.dismiss();
    handleSubmit((v) => mutation.mutate(v))();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.black }} edges={['top', 'bottom']}>
      {/* ScrollView with automaticallyAdjustKeyboardInsets avoids the flicker
          that KeyboardAvoidingView causes when mutation loading state changes. */}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // @ts-ignore — available in RN 0.68+ / Expo 47+
        automaticallyAdjustKeyboardInsets
      >
        {/* ── Hero ───────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 28, paddingTop: 52, paddingBottom: 44 }}>
          <Text className="!text-[34px] !font-[OpenSans-Bold] leading-10 text-white mb-1.5">
            Welcome back
          </Text>
          <Text className="text-[14px] text-white/70 font-[OpenSans-Regular]">
            Sign in to start taking payments
          </Text>
        </View>

        {/* ── Form ───────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 28, gap: 16 }}>
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <Input
                label="Email address"
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                // Disable system autofill suggestions
                autoComplete="off"
                textContentType="none"
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
                label="Password"
                placeholder="Enter your password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                // Disable iOS credential manager bar
                autoComplete="off"
                textContentType="none"
                returnKeyType="done"
                onSubmitEditing={submit}
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />

          {/* Forgot password */}
          <View style={{ alignItems: 'flex-end', marginTop: -4 }}>
            <Link href="/(auth)/forgot-password" asChild>
              <Pressable hitSlop={8}>
                <Text style={{ color: colors.brand, fontSize: 13, fontFamily: 'OpenSans-SemiBold' }}>
                  Forgot password?
                </Text>
              </Pressable>
            </Link>
          </View>

          {/* API error */}
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

        {/* ── Footer CTA ─────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 28, paddingBottom: 20, gap: 14 }}>
          <Button
            label="Sign in"
            onPress={submit}
            loading={mutation.isPending}
            disabled={!formState.isValid || mutation.isPending}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ color: colors.textInactive, fontSize: 12, fontFamily: 'OpenSans-Regular' }}>
              or
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <Link href="/(auth)/sign-up" asChild>
            <Pressable style={{
              height: 52,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 15, color: colors.text, fontFamily: 'OpenSans-Medium' }}>
                Create an account
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
