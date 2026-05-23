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

  return (
    <Screen scrollable={false}>
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

      <FlatList
        data={flat}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <TransactionRow order={item} isLast={index === flat.length - 1} />
        )}
        className="bg-surface border border-line-divider rounded-3xl overflow-hidden"
        contentContainerStyle={{ flexGrow: 1 }}
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
