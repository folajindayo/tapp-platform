import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Header, Input, Screen, Text } from '@/ui';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export default function SignInScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { email: '', password: '' },
    mode: 'onChange',
  });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    try {
      const res = await authApi.login(values);
      setSession(res.access_token, res.refresh_token, res.user);
      // The root layout guard will redirect to the right next step.
    } catch (err) {
      Alert.alert('Sign in failed', (err as { message?: string })?.message ?? 'Check your credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scrollable={false}>
      <Header back={false} />
      <View className="flex-1 gap-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">Welcome back</Text>
          <Text className="text-muted-text">Sign in to start taking payments.</Text>
        </View>

        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <Input
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
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
              placeholder="Your password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        <View className="flex-1" />

        <Button
          label="Sign in"
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={!formState.isValid}
        />
        <Text className="text-center text-muted-text">
          New to Tapp?{' '}
          <Link href="/(auth)/sign-up" className="text-ink font-semibold">
            Create an account
          </Link>
        </Text>
      </View>
    </Screen>
  );
}
