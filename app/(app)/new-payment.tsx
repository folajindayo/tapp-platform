import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Delete, X, Smartphone } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, Icons, Input, Text } from '@/ui';

cssInterop(SafeAreaView, { className: { target: 'style' } });
cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

export default function NewPaymentScreen() {
  const [amountStr, setAmountStr] = useState('');
  const [memo, setMemo] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const display = useMemo(() => formatAmountForDisplay(amountStr), [amountStr]);
  const amountValid = Number.parseFloat(amountStr || '0') > 0;

  function press(key: string) {
    if (key === 'del') {
      setAmountStr((s) => s.slice(0, -1));
    } else if (key === '.') {
      if (!amountStr.includes('.')) setAmountStr((s) => (s.length === 0 ? '0.' : `${s}.`));
    } else {
      // Limit to two decimals + reasonable length
      if (amountStr.includes('.')) {
        const [, frac] = amountStr.split('.');
        if ((frac?.length ?? 0) >= 2) return;
      }
      if (amountStr.length >= 9) return;
      setAmountStr((s) => (s === '0' ? key : `${s}${key}`));
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-white">
      <View className="px-5 py-4 flex-row items-center justify-between">
        <Pressable
          className="h-10 w-10 -ml-2 items-center justify-center rounded-md active:bg-surface-subtle"
          onPress={() => router.back()}
          hitSlop={8}
        >
          <X size={22} color="#272A33" />
        </Pressable>
        <Text className="text-base font-semibold text-ink">New payment</Text>
        <View className="w-10" />
      </View>

      <View className="flex-1 items-center justify-center">
        <Text
          className="text-7xl font-bold text-ink"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          ₦ {display}
        </Text>
      </View>

      <View className="px-5">
        <Input
          placeholder="Memo (optional)"
          value={memo}
          onChangeText={setMemo}
          maxLength={40}
        />
      </View>

      <View className="px-5 mt-4">
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {[
            '1', '2', '3',
            '4', '5', '6',
            '7', '8', '9',
            '.', '0', 'del',
          ].map((key) => (
            <Pressable
              key={key}
              onPress={() => press(key)}
              className="h-14 items-center justify-center bg-surface-soft rounded-md active:bg-surface-subtle"
              style={{ width: '32%' }}
            >
              {key === 'del' ? (
                <Delete size={22} color="#272A33" />
              ) : (
                <Text className="text-xl font-medium text-ink">{key}</Text>
              )}
            </Pressable>
          ))}
        </View>
      </View>

      <View className="px-5 pt-4 pb-6">
        <Button
          label="Tap to take"
          onPress={() => setPickerOpen(true)}
          disabled={!amountValid}
        />
      </View>

      {pickerOpen ? (
        <MethodPicker
          amount={amountStr}
          memo={memo}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function MethodPicker({
  amount,
  memo,
  onClose,
}: {
  amount: string;
  memo: string;
  onClose: () => void;
}) {
  const query = useMemo(() => {
    const p = new URLSearchParams({ amount });
    if (memo) p.set('memo', memo);
    return p.toString();
  }, [amount, memo]);

  return (
    <View className="absolute inset-0 bg-black/40 justify-end">
      <Pressable className="flex-1" onPress={onClose} />
      <SafeAreaView edges={['bottom', 'left', 'right']} className="bg-white rounded-t-2xl">
        <View className="px-5 py-5">
          <Text className="text-center text-lg font-semibold text-ink mb-4">
            How are they paying?
          </Text>

          <Pressable
            className="flex-row items-center gap-4 bg-surface-soft rounded-lg p-4 active:bg-surface-subtle"
            onPress={() => {
              onClose();
              router.push(`/(app)/broadcast?${query}`);
            }}
          >
            <View className="h-12 w-12 bg-brand-green/15 rounded-md items-center justify-center">
              <Smartphone size={22} color="#121212" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-ink">Phone-to-phone</Text>
              <Text className="text-sm text-muted-text">They tap their phone or scan a QR.</Text>
            </View>
          </Pressable>

          <View className="h-3" />

          <Pressable
            className="flex-row items-center gap-4 bg-surface-soft rounded-lg p-4 active:bg-surface-subtle"
            onPress={() => {
              onClose();
              router.push(`/(app)/tap-card?${query}`);
            }}
          >
            <View className="h-12 w-12 bg-brand-green/15 rounded-md items-center justify-center">
              <Icon xml={Icons.IconContactlessCard} width={18} height={26} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-ink">Tap Card</Text>
              <Text className="text-sm text-muted-text">They tap a physical Tapp Card.</Text>
            </View>
          </Pressable>

          <View className="h-4" />

          <Pressable className="items-center py-3" onPress={onClose}>
            <Text className="text-muted-text">Cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function formatAmountForDisplay(str: string): string {
  if (!str) return '0';
  const [whole, frac] = str.split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}
