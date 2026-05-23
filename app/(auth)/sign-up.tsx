import { Keyboard, Pressable, ScrollView, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ChevronLeft } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '@/api/endpoints';
import type { ApiError } from '@/api/types';
import { useAuthStore } from '@/auth/store';
import { Button, Input, Text } from '@/ui';
import { colors } from '@/ui/theme';

const schema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/[0-9]/, 'Include a number'),
});

type FormValues = z.infer<typeof schema>;

export default function SignUpScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { firstName: '', lastName: '', email: '', password: '' },
    mode: 'onChange',
  });

  const mutation = useMutation<Awaited<ReturnType<typeof authApi.register>>, ApiError, FormValues>({
    mutationFn: (values) => authApi.register(values),
    onSuccess: ({ accessToken, refreshToken }) => {
      setSession(accessToken, refreshToken);
    },
    onError: () => {},
  });

  const mutationError = mutation.error?.message;

  function submit() {
    Keyboard.dismiss();
    handleSubmit((v) => mutation.mutate(v))();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.black }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // @ts-ignore — available in RN 0.68+ / Expo 47+
        automaticallyAdjustKeyboardInsets
      >
        {/* ── Back button ───────────────────────────────────── */}
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
        <View style={{ paddingHorizontal: 28, paddingTop: 24, paddingBottom: 36 }}>
          <Text style={{
            fontSize: 34,
            fontFamily: 'OpenSans-Bold',
            color: colors.textStrong,
            lineHeight: 42,
            marginBottom: 8,
          }}>
            Create account
          </Text>
          <Text style={{ fontSize: 15, color: colors.textMuted, fontFamily: 'OpenSans-Regular', lineHeight: 22 }}>
            Receive crypto, get NGN in your bank account
          </Text>
        </View>

        {/* ── Form ───────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 28, gap: 16 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Controller
                control={control}
                name="firstName"
                render={({ field, fieldState }) => (
                  <Input
                    label="First name"
                    placeholder="Ada"
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="none"
                    returnKeyType="next"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Controller
                control={control}
                name="lastName"
                render={({ field, fieldState }) => (
                  <Input
                    label="Last name"
                    placeholder="Okafor"
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="none"
                    returnKeyType="next"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
            </View>
          </View>

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
                placeholder="At least 8 characters"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                returnKeyType="done"
                onSubmitEditing={submit}
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                hint="8+ characters, 1 letter, 1 number"
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

        {/* ── Footer CTA ─────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 28, paddingBottom: 20, gap: 14 }}>
          <Button
            label="Create account"
            onPress={submit}
            loading={mutation.isPending}
            disabled={!formState.isValid || mutation.isPending}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ color: colors.textInactive, fontSize: 12, fontFamily: 'OpenSans-Regular' }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <Link href="/(auth)/sign-in" asChild>
            <Pressable style={{
              height: 52,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 15, color: colors.text, fontFamily: 'OpenSans-Medium' }}>
                Sign in instead
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
