import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Header, Input, Screen, Text } from '@/ui';

const schema = z.object({
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
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { email: '', password: '' },
    mode: 'onChange',
  });

  async function onSubmit(values: FormValues) {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      Alert.alert('Invalid input', parsed.error.issues[0]?.message ?? 'Check your details');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.register({ ...parsed.data, scope: 'sender' });
      setSession(res.access_token, res.refresh_token, res.user);
      router.replace('/(auth)/verify-email');
    } catch (err) {
      Alert.alert('Sign up failed', (err as { message?: string })?.message ?? 'Try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scrollable={false}>
      <Header back={false} />
      <View className="flex-1 gap-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">Create your Tapp account</Text>
          <Text className="text-muted-text">Receive crypto, get NGN in your bank.</Text>
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
              placeholder="At least 8 characters"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              hint="8+ characters, 1 number, 1 letter"
            />
          )}
        />

        <View className="flex-1" />

        <Button
          label="Sign up"
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={!formState.isValid}
        />
        <Text className="text-center text-muted-text">
          Already have an account?{' '}
          <Link href="/(auth)/sign-in" className="text-ink font-semibold">
            Sign in
          </Link>
        </Text>
      </View>
    </Screen>
  );
}
