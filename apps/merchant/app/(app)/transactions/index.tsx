import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { cssInterop } from 'nativewind';
import { ordersApi } from '@/api/endpoints';
import { Header, Screen, Text } from '@/ui';
import { TransactionRow } from '@/components/TransactionRow';
import type { OrderStatus, PaymentOrderSummary } from '@/api/types';

cssInterop(Pressable, { className: { target: 'style' } });

const FILTERS: Array<{ label: string; value?: OrderStatus }> = [
  { label: 'All', value: undefined },
  { label: 'Settled', value: 'settled' },
  { label: 'Pending', value: 'pending' },
  { label: 'Refunded', value: 'refunded' },
];

interface MonthlyGroup {
  monthYear: string;
  orders: PaymentOrderSummary[];
}

export default function TransactionsScreen() {
  const [filter, setFilter] = useState<OrderStatus | undefined>();

  const query = useInfiniteQuery({
    queryKey: ['sender', 'orders', 'all', filter ?? 'any'],
    queryFn: ({ pageParam }) => ordersApi.list({ status: filter, page: pageParam, limit: 30 }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.orders && last.orders.length === last.pageSize) {
        return last.page + 1;
      }
      return undefined;
    },
  });

  const flat: PaymentOrderSummary[] = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.orders ?? []),
    [query.data],
  );

  // Group transactions by month
  const monthlyGroups = useMemo<MonthlyGroup[]>(() => {
    const groups: Record<string, PaymentOrderSummary[]> = {};

    for (const order of flat) {
      const date = new Date(order.createdAt);
      if (Number.isNaN(date.getTime())) continue;

      const monthYear = date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });

      if (!groups[monthYear]) {
        groups[monthYear] = [];
      }
      groups[monthYear].push(order);
    }

    return Object.entries(groups).map(([monthYear, orders]) => ({
      monthYear,
      orders,
    }));
  }, [flat]);

  return (
    <Screen scrollable={false}>
      {/* Fixed header and filter pill bar */}
      <Header title="Transactions" back={false} />
      
      <View className="flex-row gap-2 mb-4">
        {FILTERS.map((f) => {
          const active = (filter ?? undefined) === f.value;
          return (
            <Pressable
              key={f.label}
              onPress={() => setFilter(f.value)}
              className={`px-3.5 h-9 rounded-xl items-center justify-center ${active ? 'bg-brand-blue' : 'bg-surface-subtle'}`}
            >
              <Text className={`text-sm ${active ? 'text-white font-semibold' : 'text-ink-700'}`}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Scrolling transaction page */}
      <FlatList
        data={monthlyGroups}
        keyExtractor={(item) => item.monthYear}
        refreshing={query.isRefetching}
        onRefresh={() => {
          void query.refetch();
        }}
        renderItem={({ item }) => (
          <View className="mb-6">
            {/* Month Header label */}
            <Text className="text-xs font-semibold text-muted-text uppercase tracking-wider mb-2 px-1">
              {item.monthYear}
            </Text>
            
            {/* Rounded group card container */}
            <View className="bg-surface border border-line-divider rounded-3xl overflow-hidden">
              {item.orders.map((order, index) => (
                <TransactionRow 
                  key={order.id} 
                  order={order} 
                  isLast={index === item.orders.length - 1} 
                />
              ))}
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          query.isLoading ? (
            <View className="flex-1 items-center justify-center py-10">
              <ActivityIndicator color="#0065F5" />
            </View>
          ) : (
            <View className="p-6 items-center justify-center flex-1">
              <Text className="text-center text-muted-text">No transactions yet.</Text>
            </View>
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View className="py-6">
              <ActivityIndicator color="#0065F5" />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}
