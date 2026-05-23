import { useMemo, useState } from 'react';
import { Pressable, View, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Delete, CreditCard, Smartphone, Receipt } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ordersApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Input, Text } from '@/ui';
import { formatNgn } from '@/ui/format';

cssInterop(SafeAreaView, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });
cssInterop(Pressable, { className: { target: 'style' } });

export default function DashboardScreen() {
  const userEmail = useAuthStore((s) => s.user?.email ?? '');
  const [amountStr, setAmountStr] = useState('');
  const [memo, setMemo] = useState('');

  const statsQuery = useQuery({ 
    queryKey: ['sender', 'stats'], 
    queryFn: ordersApi.stats,
    refetchOnWindowFocus: true
  });

  // Re-fetch stats when this screen comes back into focus
  useFocusEffect(() => {
    void statsQuery.refetch();
  });

  const display = useMemo(() => formatAmountForDisplay(amountStr), [amountStr]);
  const amountValid = Number.parseFloat(amountStr || '0') > 0;

  function press(key: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ amount: amountStr });
    if (memo) p.set('memo', memo);
    return p.toString();
  }, [amountStr, memo]);

  const handleTapCard = () => {
    if (!amountValid) return;
    router.push(`/(app)/tap-card?${queryParams}`);
  };

  const handlePayPhone = () => {
    if (!amountValid) return;
    router.push(`/(app)/broadcast?${queryParams}`);
  };

  const firstName = userEmail.split('@')[0] ?? 'there';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-white dark:bg-neutral-950">
      {/* Sleek POS Earnings Header */}
      <View className="px-5 py-3 flex-row items-center justify-between border-b border-line-divider/30 dark:border-white/5">
        <Pressable 
          onPress={() => router.push('/(app)/transactions')}
          className="bg-surface-soft dark:bg-white/5 border border-line-divider/50 dark:border-white/10 px-3 py-1.5 rounded-xl flex-row items-center gap-1.5 active:bg-surface-subtle"
        >
          <View className="w-1.5 h-1.5 rounded-full bg-brand-blue" />
          {statsQuery.isLoading ? (
            <ActivityIndicator size="small" color="#0065F5" />
          ) : (
            <Text className="text-xs text-ink font-semibold">
              Total: {formatNgn(statsQuery.data?.totalOrderVolume ?? '0')} ({statsQuery.data?.totalOrders ?? 0} pay)
            </Text>
          )}
        </Pressable>
        <Text className="text-xs font-semibold text-muted-text dark:text-white/40">Hi, {firstName}</Text>
      </View>

      {/* Large Numerical Display */}
      <View className="flex-1 items-center justify-center px-5">
        <Text className="text-xs font-medium uppercase tracking-wider text-muted-subtle mb-1">Enter Amount</Text>
        <Text
          className="text-6xl font-bold text-ink dark:text-white text-center"
          style={{ fontVariant: ['tabular-nums'] }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          ₦ {display}
        </Text>
      </View>

      {/* Note Input */}
      <View className="px-5 mb-4">
        <Input
          placeholder="Memo (optional)"
          value={memo}
          onChangeText={setMemo}
          maxLength={40}
          className="bg-surface-soft/60 dark:bg-white/5 border-line-divider/40 dark:border-white/10 text-center"
        />
      </View>

      {/* Premium Keypad Grid */}
      <View className="px-5 mb-5">
        <View className="flex-row flex-wrap justify-between" style={{ gap: 8 }}>
          {[
            '1', '2', '3',
            '4', '5', '6',
            '7', '8', '9',
            '.', '0', 'del',
          ].map((key) => (
            <Pressable
              key={key}
              onPress={() => press(key)}
              className="h-[56px] items-center justify-center bg-surface-soft dark:bg-white/5 rounded-xl active:bg-surface-subtle dark:active:bg-white/10"
              style={{ width: '31.5%' }}
            >
              {key === 'del' ? (
                <Delete size={20} color={useAuthStore.getState().user ? '#121212' : '#FFFFFF'} className="text-ink dark:text-white" />
              ) : (
                <Text className="text-xl font-semibold text-ink dark:text-white">{key}</Text>
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {/* Direct Payment CTAs */}
      <View className="px-5 pb-28 flex-row gap-3">
        <Button
          label="Tap Card"
          variant="primary"
          className="flex-1"
          disabled={!amountValid}
          onPress={handleTapCard}
          leadingIcon={<CreditCard size={18} color="#FFFFFF" />}
        />
        <Button
          label="Pay Phone"
          variant="secondary"
          className="flex-1"
          disabled={!amountValid}
          onPress={handlePayPhone}
          leadingIcon={<Smartphone size={18} color="#0065F5" />}
        />
      </View>
    </SafeAreaView>
  );
}

function formatAmountForDisplay(str: string): string {
  if (!str) return '0';
  const [whole, frac] = str.split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}
