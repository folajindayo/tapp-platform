import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { catalogApi, merchantApi, verifyApi } from "@/api/endpoints";
import type { ApiError, SaveBankAccountRequest } from "@/api/types";
import { queryKeys } from "@/queries/keys";
import { Button, Header, Icon, Icons, Input, Screen, Text } from "@/ui";

cssInterop(Pressable, { className: { target: "style" } });

const CURRENCY = "NGN";

export default function BankAccountScreen() {
  const queryClient = useQueryClient();
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [picker, setPicker] = useState(false);

  const institutionsQuery = useQuery({
    queryKey: queryKeys.catalog.institutions(CURRENCY),
    queryFn: () => catalogApi.institutions(CURRENCY),
    staleTime: 10 * 60 * 1000,
  });

  const bank = useMemo(
    () => institutionsQuery.data?.find((i) => i.code === bankCode),
    [institutionsQuery.data, bankCode],
  );

  const resolveQuery = useQuery({
    queryKey: queryKeys.verify.account(bankCode ?? "", accountNumber),
    queryFn: () =>
      verifyApi.account({
        institution: bankCode!,
        account_identifier: accountNumber,
        currency: CURRENCY,
      }),
    enabled: !!bankCode && accountNumber.length === 10,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Auto-fill account name from verification; user can still type manually
  const verifiedName = resolveQuery.data ?? "";
  const displayName = verifiedName || accountName;

  const saveMutation = useMutation<unknown, ApiError, SaveBankAccountRequest>({
    mutationFn: (data) => merchantApi.saveBankAccount(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.merchant.bankAccount(),
      });
    },
    onError: (err) => {
      Alert.alert("Could not save", err.message ?? "Try again");
    },
  });

  function handleSave() {
    if (!bankCode || !displayName || accountNumber.length !== 10) return;
    saveMutation.mutate({
      currency: CURRENCY,
      bank_code: bankCode,
      account_number: accountNumber,
      account_name: displayName,
    });
  }

  const resolveError =
    resolveQuery.isError && !verifiedName
      ? ((resolveQuery.error as unknown as ApiError)?.message ??
        "Could not verify account")
      : undefined;

  const canSave =
    !!bankCode &&
    accountNumber.length === 10 &&
    !!displayName &&
    !resolveQuery.isFetching &&
    !saveMutation.isPending;

  return (
    <Screen>
      <Header back={false} />
      <View className="gap-6">
        <View className="gap-2">
          <View className="h-14 w-14 rounded-2xl bg-brand/15 items-center justify-center mb-2">
            <Icon xml={Icons.IconBank} size={28} />
          </View>
          <Text className="text-3xl font-bold text-ink">
            Where should we send your money?
          </Text>
        </View>

        {/* Bank picker */}
        <View className="gap-2">
          <Text className="text-sm font-medium text-ink-700">Bank</Text>
          <Pressable
            className="h-[54px] rounded-xl px-4 flex-row items-center justify-between bg-surface border-2 border-line-muted"
            onPress={() => setPicker(true)}
          >
            <Text className={`text-base ${bank ? "text-ink" : "text-muted-subtle"}`}>
              {bank ? bank.name : "Choose your bank"}
            </Text>
            <ChevronDown size={20} color="#9A9A9A" />
          </Pressable>
        </View>

        {/* Account number */}
        <Input
          label="Account number"
          placeholder="10-digit NUBAN"
          keyboardType="number-pad"
          value={accountNumber}
          onChangeText={(t) => {
            setAccountNumber(t.replace(/[^0-9]/g, "").slice(0, 10));
          }}
        />

        {/* Account name — auto-filled from verification, editable as fallback */}
        {resolveQuery.isFetching ? (
          <Text className="text-sm text-muted-text -mt-2">Verifying account…</Text>
        ) : verifiedName ? (
          <View className="flex-row items-center gap-2 bg-success-bg rounded-lg px-3 py-2.5 -mt-2">
            <Text className="text-success font-semibold">✓ {verifiedName}</Text>
          </View>
        ) : (
          <Input
            label="Account name"
            placeholder="Enter account name"
            autoCapitalize="words"
            value={accountName}
            onChangeText={setAccountName}
            error={resolveError}
          />
        )}

        <Button
          label="Save bank account"
          onPress={handleSave}
          loading={saveMutation.isPending}
          disabled={!canSave}
        />
      </View>

      {picker ? (
        <BankPicker
          institutions={institutionsQuery.data ?? []}
          loading={institutionsQuery.isLoading}
          onSelect={(code) => {
            setBankCode(code);
            setPicker(false);
            setAccountNumber("");
            setAccountName("");
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
      <View className="bg-surface rounded-t-2xl p-4 max-h-[70%]">
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
