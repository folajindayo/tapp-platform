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
    queryFn: ({ pageParam }) => ordersApi.list({ status: filter, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const flat: PaymentOrderSummary[] = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.data),
    [query.data],
  );

  return (
    <Screen scrollable={false}>
      <Header title="Transactions" back={false} />
      <View className="flex-row gap-2 mb-3">
        {FILTERS.map((f) => {
          const active = (filter ?? undefined) === f.value;
          return (
            <Pressable
              key={f.label}
              onPress={() => setFilter(f.value)}
              className={`px-3 h-9 rounded-full items-center justify-center ${active ? 'bg-brand-green' : 'bg-surface-subtle'}`}
            >
              <Text className={`text-sm ${active ? 'text-ink-true font-semibold' : 'text-ink-700'}`}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={flat}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransactionRow order={item} />}
        ItemSeparatorComponent={() => <View className="h-2" />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          query.isLoading ? null : (
            <View className="bg-surface-soft rounded-lg p-6 mt-2">
              <Text className="text-center text-muted-text">No transactions yet.</Text>
            </View>
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View className="py-6">
              <ActivityIndicator color="#40FF00" />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}
