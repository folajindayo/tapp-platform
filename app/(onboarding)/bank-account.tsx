import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { catalogApi, merchantApi, verifyApi } from '@/api/endpoints';
import { Button, Icon, Icons, Input, Screen, Text } from '@/ui';
import { StepHeader } from '@/components/StepHeader';

cssInterop(Pressable, { className: { target: 'style' } });

const CURRENCY = 'NGN';

export default function BankAccountScreen() {
  const queryClient = useQueryClient();
  const institutionsQuery = useQuery({
    queryKey: ['catalog', 'institutions', CURRENCY],
    queryFn: () => catalogApi.institutions(CURRENCY),
  });

  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  const bank = useMemo(
    () => institutionsQuery.data?.find((i) => i.code === bankCode),
    [institutionsQuery.data, bankCode],
  );

  useEffect(() => {
    setResolvedName(null);
    setError(null);
    if (!bankCode || accountNumber.length !== 10) return;
    const handle = setTimeout(async () => {
      setResolving(true);
      try {
        const res = await verifyApi.account({
          institution: bankCode,
          account_identifier: accountNumber,
          currency: CURRENCY,
        });
        setResolvedName(res);
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? 'Could not verify account';
        setError(msg);
      } finally {
        setResolving(false);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [bankCode, accountNumber]);

  async function save() {
    if (!bankCode || !resolvedName || accountNumber.length !== 10) return;
    setSaving(true);
    try {
      await merchantApi.saveBankAccount({
        currency: CURRENCY,
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: resolvedName,
      });
      await queryClient.invalidateQueries({ queryKey: ['merchant', 'bank-account'] });
    } catch (err) {
      Alert.alert('Could not save', (err as { message?: string })?.message ?? 'Try again');
    } finally {
      setSaving(false);
    }
  }

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(onboarding)/kyb');
    }
  };

  return (
    <Screen>
      <StepHeader
        step={4}
        totalSteps={4}
        title="Where should we send your money?"
        onBack={handleBack}
      />
      <View className="gap-6 mt-4">
        <View className="h-14 w-14 rounded-2xl bg-brand-blue/15 items-center justify-center">
          <Icon xml={Icons.IconBank} size={28} />
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium text-ink-700">Bank</Text>
          <Pressable
            className="h-[52px] rounded-xl px-4 flex-row items-center justify-between bg-surface-soft border border-line-muted"
            onPress={() => setPicker(true)}
          >
            <Text className={`text-base ${bank ? 'text-ink' : 'text-muted-subtle'}`}>
              {bank ? bank.name : 'Choose your bank'}
            </Text>
            <ChevronDown size={20} color="#5E6470" />
          </Pressable>
        </View>

        <Input
          label="Account number"
          placeholder="10-digit NUBAN"
          keyboardType="number-pad"
          value={accountNumber}
          onChangeText={(t) => setAccountNumber(t.replace(/[^0-9]/g, '').slice(0, 10))}
          error={error ?? undefined}
        />

        {resolving ? (
          <Text className="text-sm text-muted-text">Verifying…</Text>
        ) : resolvedName ? (
          <View className="flex-row items-center gap-2 bg-success-bg rounded-md px-3 py-2 self-start">
            <Text className="text-success font-semibold">✓ {resolvedName}</Text>
          </View>
        ) : null}

        <View className="h-2" />

        <Button
          label="Save"
          onPress={save}
          loading={saving}
          disabled={!resolvedName || resolving}
        />
      </View>

      {picker ? (
        <BankPicker
          institutions={institutionsQuery.data ?? []}
          loading={institutionsQuery.isLoading}
          onSelect={(code) => {
            setBankCode(code);
            setPicker(false);
            setResolvedName(null);
          }}
          onClose={() => setPicker(false)}
        />
      ) : null}
    </Screen>
  );
}

function BankPicker({
  institutions,
  loading,
  onSelect,
  onClose,
}: {
  institutions: { code: string; name: string }[];
  loading: boolean;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  return (
    <View className="absolute inset-0 bg-black/40 justify-end" pointerEvents="auto">
      <Pressable className="flex-1" onPress={onClose} />
      <View className="bg-white rounded-t-2xl p-4 max-h-[70%]">
        <Text className="text-lg font-semibold text-ink mb-3">Pick your bank</Text>
        {loading ? (
          <Text className="text-muted-text">Loading…</Text>
        ) : (
          <View>
            {institutions.map((i) => (
              <Pressable
                key={i.code}
                className="py-3 border-b border-line-divider active:bg-surface-soft"
                onPress={() => onSelect(i.code)}
              >
                <Text className="text-base text-ink">{i.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
