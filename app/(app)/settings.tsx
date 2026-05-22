import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { authApi, merchantApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Header, Icon, Icons, Screen, Text } from '@/ui';
import { maskAccountNumber } from '@/ui/format';

cssInterop(Pressable, { className: { target: 'style' } });

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const meQuery = useQuery({ queryKey: ['auth', 'me'], queryFn: authApi.me });
  const bankQuery = useQuery({
    queryKey: ['merchant', 'bank-account'],
    queryFn: merchantApi.getBankAccount,
  });

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          queryClient.clear();
          signOut();
          setSigningOut(false);
        },
      },
    ]);
  }

  return (
    <Screen>
      <Header title="Settings" back={false} />

      <Section title="Profile">
        <Row icon={Icons.IconEmail} label="Email" value={user?.email ?? '—'} />
        <Row
          icon={Icons.IconKycStatus}
          label="KYC"
          value={meQuery.data?.kyc_status === 'success' ? '✓ Verified' : meQuery.data?.kyc_status ?? '—'}
          last
        />
      </Section>

      <Section title="Payouts">
        <Row
          icon={Icons.IconBank}
          label="Bank"
          value={
            bankQuery.data
              ? `${bankQuery.data.account_name} · ${maskAccountNumber(bankQuery.data.account_number)}`
              : 'Not set'
          }
          chevron
          last
        />
      </Section>

      <Section title="Security">
        <Row icon={Icons.IconAppPin} label="App PIN" value="—" chevron />
        <Row icon={Icons.IconBiometrics} label="Biometrics" value="—" chevron />
        <Row icon={Icons.IconSessions} label="Sessions" value="" chevron last />
      </Section>

      <Section title="Support">
        <Row icon={Icons.IconHelp} label="Help" value="" chevron />
        <Row icon={Icons.IconTerms} label="Terms of service" value="" chevron />
        <Row icon={Icons.IconPrivacy} label="Privacy policy" value="" chevron last />
      </Section>

      <Section title="About">
        <Row icon={Icons.IconInfo} label="Version" value="0.1.0" last />
      </Section>

      <View className="h-6" />

      <Button
        label="Sign out"
        variant="secondary"
        onPress={confirmSignOut}
        loading={signingOut}
        leadingIcon={<Icon xml={Icons.IconLogout} size={20} />}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-xs uppercase tracking-wider text-muted-subtle mb-2">{title}</Text>
      <View className="bg-surface-soft rounded-lg overflow-hidden">{children}</View>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  chevron,
  last,
}: {
  icon?: string;
  label: string;
  value: string;
  chevron?: boolean;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between p-4 ${last ? '' : 'border-b border-line-divider'}`}
    >
      <View className="flex-row items-center gap-3 flex-1">
        {icon ? <Icon xml={icon} size={20} /> : null}
        <Text className="text-ink-700">{label}</Text>
      </View>
      <View className="flex-row items-center gap-2 max-w-[60%]">
        {value ? (
          <Text className="text-ink text-right" numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {chevron ? <ChevronRight size={16} color="#8B919C" /> : null}
      </View>
    </View>
  );
}
