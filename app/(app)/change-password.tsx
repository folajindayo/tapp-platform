import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { authApi } from '@/api/endpoints';
import type { ApiError } from '@/api/types';
import { Button, Header, Input, Screen, Text } from '@/ui';

const schema = z.object({
  old_password: z.string().min(1, 'Enter your current password'),
  new_password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/[0-9]/, 'Include a number'),
  confirm: z.string(),
}).refine((d) => d.new_password === d.confirm, {
  message: "Passwords don't match",
  path: ['confirm'],
});

type FormValues = z.infer<typeof schema>;

export default function ChangePasswordScreen() {
  const { control, handleSubmit, formState, reset } = useForm<FormValues>({
    defaultValues: { old_password: '', new_password: '', confirm: '' },
    mode: 'onChange',
  });

  const mutation = useMutation<{ ok: true }, ApiError, FormValues>({
    mutationFn: ({ old_password, new_password }) =>
      authApi.changePassword({ oldPassword: old_password, newPassword: new_password }),
    onSuccess: () => {
      Alert.alert('Password updated', 'Your password has been changed.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      reset();
    },
    onError: (err) => {
      Alert.alert('Failed', err.message ?? 'Check your current password and try again');
    },
  });

  return (
    <Screen scrollable={false}>
      <Header title="Change password" />

      <View className="flex-1 gap-6">
        <Text className="text-muted-text text-sm">
          Choose a strong password with at least 8 characters, one letter, and one number.
        </Text>

        <View className="gap-4">
          <Controller
            control={control}
            name="old_password"
            render={({ field, fieldState }) => (
              <Input
                label="Current password"
                placeholder="Your current password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="new_password"
            render={({ field, fieldState }) => (
              <Input
                label="New password"
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
          <Controller
            control={control}
            name="confirm"
            render={({ field, fieldState }) => (
              <Input
                label="Confirm new password"
                placeholder="Same as above"
                secureTextEntry
                autoCapitalize="none"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        </View>

        <View className="flex-1" />

        <Button
          label="Update password"
          onPress={handleSubmit((values) => mutation.mutate(values))}
          loading={mutation.isPending}
          disabled={!formState.isValid || mutation.isPending}
        />
      </View>
    </Screen>
  );
}
