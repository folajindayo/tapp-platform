import { useState } from 'react';
import { Alert, View, TouchableOpacity, useColorScheme, Keyboard } from 'react-native';
import { Link, router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import Animated, { FadeInDown, Easing } from 'react-native-reanimated';
import { Sparkles, X } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { authApi } from '@/api/endpoints';
import type { ApiError } from '@/api/types';
import { useAuthStore } from '@/auth/store';
import { Button, Input, Screen, Text } from '@/ui';
import { colors } from '@/ui/theme';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

const EASY_OUT = Easing.bezier(0.32, 0.72, 0, 1).factory();

const GoogleIcon = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <Path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <Path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <Path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </Svg>
);

const AppleIcon = ({ size = 20, color = '#000000' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.21.67-2.93 1.49-.62.69-1.16 1.84-1.01 2.96 1.12.09 2.27-.57 2.95-1.39" />
  </Svg>
);

export default function SignInScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

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
      Alert.alert('Sign in failed', err.message ?? 'Check your credentials');
    },
  });

  function submit() {
    Keyboard.dismiss();
    handleSubmit((v) => mutation.mutate(v))();
  }

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)');
    }
  };

  return (
    <Screen scrollable={false} className="justify-center bg-surface-bg dark:bg-neutral-950 px-4">
      {/* Ambient Background Glows */}
      <View className="absolute top-0 left-0 right-0 bottom-0 overflow-hidden" pointerEvents="none">
        <View className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full bg-brand-blue/5 dark:bg-brand-blue/10 opacity-70" />
        <View className="absolute -bottom-20 -left-20 w-[320px] h-[320px] rounded-full bg-brand-blue/5 dark:bg-brand-blue/10 opacity-45" />
      </View>

      <Animated.View
        entering={FadeInDown.duration(450).easing(EASY_OUT)}
        className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-white/10 rounded-[32px] p-6 gap-6 w-full"
      >
        {/* Top Badges Row */}
        <View className="flex-row justify-between items-center w-full">
          {/* Logo Badge */}
          <View className="w-12 h-12 rounded-full bg-surface-soft dark:bg-white/5 border border-line-divider/40 dark:border-white/10 items-center justify-center">
            <Sparkles size={22} color={colors.brand} />
          </View>
          
          {/* Close Button */}
          <TouchableOpacity
            onPress={handleClose}
            activeOpacity={0.7}
            className="w-9 h-9 rounded-full bg-surface-soft dark:bg-white/5 border border-line-divider/40 dark:border-white/10 items-center justify-center"
          >
            <X size={18} color={isDark ? '#FFFFFF' : '#121212'} />
          </TouchableOpacity>
        </View>

        {/* Title & Subtitle Stack */}
        <View className="gap-1 mt-2">
          <Text className="text-[28px] font-bold text-ink dark:text-white tracking-tight leading-tight">Welcome back</Text>
          <Text className="text-sm text-muted-text">Sign in to start taking payments.</Text>
        </View>

        {/* Form Inputs Stack */}
        <View className="gap-4">
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <Input
                label="Email"
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="off"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                className="text-base"
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <Input
                label="Password"
                placeholder="Your password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="off"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                className="text-base"
              />
            )}
          />

          {/* Forgot password redirect */}
          <View className="align-self-end mt-[-8px]">
            <Link href="/(auth)/forgot-password" asChild>
              <TouchableOpacity activeOpacity={0.7}>
                <Text className="text-xs font-semibold text-brand">Forgot password?</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>

        {/* Actions Stack */}
        <View className="gap-4 mt-2">
          <Button
            label="Sign in"
            onPress={submit}
            loading={mutation.isPending}
            disabled={!formState.isValid || mutation.isPending}
          />

          {/* Social Divider */}
          <View className="flex-row items-center gap-3 py-1">
            <View className="flex-1 h-[1px] bg-line-divider/40 dark:bg-white/10" />
            <Text className="text-xs text-muted-subtle font-medium uppercase tracking-wider">or</Text>
            <View className="flex-1 h-[1px] bg-line-divider/40 dark:bg-white/10" />
          </View>

          {/* Apple & Google Side-by-Side Row */}
          <View className="flex-row gap-3">
            <Button
              label=""
              variant="secondary"
              leadingIcon={<AppleIcon size={20} color={isDark ? '#FFFFFF' : '#121212'} />}
              onPress={() => Alert.alert('Sign in with Apple', 'This feature is coming soon.')}
              className="flex-1"
            />
            <Button
              label=""
              variant="secondary"
              leadingIcon={<GoogleIcon size={20} />}
              onPress={() => Alert.alert('Sign in with Google', 'This feature is coming soon.')}
              className="flex-1"
            />
          </View>

          <Text className="text-center text-sm text-muted-text mt-2">
            New to Tapp?{' '}
            <Link href="/(auth)/sign-up" className="text-brand font-semibold">
              Create an account
            </Link>
          </Text>
        </View>
      </Animated.View>
    </Screen>
  );
}
