import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ordersApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import { TransactionRow } from '@/components/TransactionRow';

cssInterop(SafeAreaView, { className: { target: 'style' } });
cssInterop(ScrollView, { className: { target: 'style' }, contentClassName: { target: 'contentContainerStyle' } });
cssInterop(View, { className: { target: 'style' } });
cssInterop(Pressable, { className: { target: 'style' } });

export default function DashboardScreen() {
  const userEmail = useAuthStore((s) => s.user?.email ?? '');

  const statsQuery = useQuery({ queryKey: ['sender', 'stats'], queryFn: ordersApi.stats });
  const recentQuery = useQuery({
    queryKey: ['sender', 'orders', 'recent'],
    queryFn: () => ordersApi.list({ limit: 5 }),
  });

  const refreshing = statsQuery.isRefetching || recentQuery.isRefetching;

  async function onRefresh() {
    await Promise.all([statsQuery.refetch(), recentQuery.refetch()]);
  }

  const firstName = userEmail.split('@')[0] ?? 'there';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 py-4 pb-32"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-base text-muted-text">Hi, {firstName}</Text>
        </View>

        <View className="bg-surface-soft rounded-lg p-5 mb-6">
          <Text className="text-sm text-muted-text mb-1">Today's earnings</Text>
          <Text className="text-4xl font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
            {formatNgn(statsQuery.data?.today_amount ?? '0')}
          </Text>
          <Text className="text-sm text-muted-text mt-1">
            {statsQuery.data?.today_count ?? 0} payments
          </Text>
        </View>

        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-base font-semibold text-ink">Recent payments</Text>
          <Pressable onPress={() => router.push('/(app)/transactions')}>
            <Text className="text-sm text-ink">See all</Text>
          </Pressable>
        </View>

        <View className="gap-2">
          {recentQuery.isLoading ? (
            <Text className="text-muted-subtle">Loading…</Text>
          ) : recentQuery.data?.data.length === 0 ? (
            <View className="bg-surface-soft rounded-lg p-6 items-center">
              <Text className="text-muted-text text-center">
                No payments yet. Tap "New payment" to take your first.
              </Text>
            </View>
          ) : (
            (recentQuery.data?.data ?? []).map((order) => (
              <TransactionRow key={order.id} order={order} />
            ))
          )}
        </View>
      </ScrollView>

      {/* Floating action: New payment */}
      <Pressable
        className="absolute right-5 bottom-5 h-14 px-6 bg-brand-green rounded-2xl flex-row items-center gap-2 active:opacity-90"
        onPress={() => router.push('/(app)/new-payment')}
        style={{
          shadowColor: '#40FF00',
          shadowOpacity: 0.3,
          shadowOffset: { width: 0, height: 6 },
          shadowRadius: 12,
          elevation: 6,
        }}
      >
        <Plus color="#121212" size={20} />
        <Text className="text-ink-true font-semibold">New payment</Text>
      </Pressable>
    </SafeAreaView>
  );
}
