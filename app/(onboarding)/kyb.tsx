import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Header, Screen, Text } from '@/ui';

export default function KybScreen() {
  return (
    <Screen scrollable={false}>
      <Header back={false} />
      <View className="flex-1 gap-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">Verify your identity</Text>
          <Text className="text-muted-text">
            Complete a quick verification to unlock payouts to your bank account.
          </Text>
        </View>

        <View className="gap-3 mt-4">
          <BulletRow text="Takes less than 2 minutes" />
          <BulletRow text="Your information is securely encrypted" />
          <BulletRow text="Required to enable bank payouts" />
        </View>

        <View className="flex-1" />

        <Button
          label="Start verification"
          onPress={() => router.push('/(onboarding)/bank-account')}
        />
      </View>
    </Screen>
  );
}

function BulletRow({ text }: { text: string }) {
  return (
    <View className="flex-row gap-3 items-start">
      <View className="h-1.5 w-1.5 rounded-full bg-brand mt-2.5" />
      <Text className="flex-1 text-ink-700">{text}</Text>
    </View>
  );
}

