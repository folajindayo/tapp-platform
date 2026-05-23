import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { cssInterop } from 'nativewind';
import { ordersApi } from '@/api/endpoints';
import { queryKeys } from '@/queries/keys';
import { Header, Screen, Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import { TransactionRow } from '@/components/TransactionRow';
import { colors } from '@/ui/theme';
import type { OrderStatus, PaymentOrderSummary } from '@/api/types';

cssInterop(Pressable, { className: { target: 'style' } });

const FILTERS: Array<{ label: string; value?: OrderStatus }> = [
  { label: 'All',      value: undefined  },
  { label: 'Settled',  value: 'settled'  },
  { label: 'Pending',  value: 'pending'  },
  { label: 'Refunded', value: 'refunded' },
];

export default function TransactionsScreen() {
  const [filter, setFilter] = useState<OrderStatus | undefined>();

  const query = useInfiniteQuery({
    queryKey: queryKeys.orders.list(filter),
    queryFn: ({ pageParam }) =>
      ordersApi.list({ status: filter, page: pageParam, limit: 30 }),
    initialPageParam: 1,
    getNextPageParam: (last, _all, lastPageParam) => {
      const { total, pageSize, orders } = last;
      return (orders?.length ?? 0) === pageSize && lastPageParam * pageSize < total
        ? lastPageParam + 1
        : undefined;
    },
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.orders.stats(),
    queryFn: ordersApi.stats,
  });

  const flat: PaymentOrderSummary[] = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.orders ?? []),
    [query.data],
  );

  const totalCount = query.data?.pages[0]?.total ?? 0;

  return (
    <Screen scrollable={false}>
      <Header title="History" back={false} />

      {/* ── Summary strip ──────────────────────────────────── */}
      {statsQuery.data && (
        <View className="flex-row gap-3 mb-4">
          <SummaryChip
            label="Volume"
            value={formatNgn(statsQuery.data.totalOrderVolume)}
            count={statsQuery.data.totalOrders}
          />
          <SummaryChip
            label="Earnings"
            value={formatNgn(statsQuery.data.totalFeeEarnings)}
            count={statsQuery.data.totalOrders}
          />
        </View>
      )}

      {/* ── Filter tabs ────────────────────────────────────── */}
      <View className="flex-row gap-2 mb-4">
        {FILTERS.map((f) => {
          const active = (filter ?? undefined) === f.value;
          return (
            <Pressable
              key={f.label}
              onPress={() => setFilter(f.value)}
              className="px-3.5 h-9 rounded-full items-center justify-center"
              style={{
                backgroundColor: active ? colors.brand : colors.surfaceSubtle,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: active ? 'OpenSans-SemiBold' : 'OpenSans-Regular',
                  color: active ? '#fff' : colors.textMuted,
                }}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Result count ───────────────────────────────────── */}
      {!query.isLoading && totalCount > 0 && (
        <Text
          className="mb-3"
          style={{
            fontSize: 12,
            fontFamily: 'OpenSans-Regular',
            color: colors.textMuted,
          }}
        >
          {totalCount} transaction{totalCount !== 1 ? 's' : ''}
        </Text>
      )}

      {/* ── List ───────────────────────────────────────────── */}
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
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          query.isLoading ? (
            <View className="items-center mt-12">
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <View className="bg-surface rounded-2xl p-8 mt-2 border border-line items-center">
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: 'OpenSans-SemiBold',
                  color: colors.text,
                  marginBottom: 6,
                }}
              >
                No transactions yet
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: 'OpenSans-Regular',
                  color: colors.textMuted,
                  textAlign: 'center',
                }}
              >
                {filter
                  ? `No ${filter} transactions found.`
                  : 'Go to Charge to accept your first payment.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View className="py-6">
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

function SummaryChip({
  label,
  value,
  count,
}: {
  label: string;
  value: string;
  count: number;
}) {
  return (
    <View
      className="flex-1 bg-surface rounded-2xl px-4 py-3 border border-line"
    >
      <Text
        style={{
          fontSize: 11,
          fontFamily: 'OpenSans-SemiBold',
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 17,
          fontFamily: 'OpenSans-Bold',
          color: colors.textStrong,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontFamily: 'OpenSans-Regular',
          color: colors.textMuted,
          marginTop: 2,
        }}
      >
        {count} payment{count !== 1 ? 's' : ''}
      </Text>
    </View>
  );
}
