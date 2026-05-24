import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ordersApi } from '@/api/endpoints';
import { Header, Screen, Text } from '@/ui';
import { formatNgn } from '@/ui/format';

const STATUS_TEXT: Record<string, string> = {
  settled: 'Settled',
  pending: 'Pending',
  processing: 'Processing',
  fulfilled: 'Fulfilled',
  validated: 'Validated',
  cancelled: 'Cancelled',
  expired: 'Expired',
  refunded: 'Refunded',
  initiated: 'Initiated',
};

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['sender', 'orders', id],
    queryFn: () => ordersApi.get(String(id)),
    enabled: !!id,
  });

  if (query.isLoading) {
    return (
      <Screen>
        <Header title="Payment detail" />
        <View className="items-center mt-12">
          <ActivityIndicator color="#0065F5" />
        </View>
      </Screen>
    );
  }

  if (!query.data) {
    return (
      <Screen>
        <Header title="Payment detail" />
        <Text className="text-muted-text">Couldn't load this transaction.</Text>
      </Screen>
    );
  }

  const order = query.data;
  // "settledAt" doesn't exist in Rails' response — we use updatedAt as a
  // proxy when status == "settled" (the row's last mutation is the
  // settlement event).
  const settledAt = order.status === 'settled' ? order.updatedAt : undefined;
  const subline = settledAt
    ? `${STATUS_TEXT[order.status] ?? order.status} · ${safeFormat(settledAt, 'h:mm a')}`
    : STATUS_TEXT[order.status] ?? order.status;

  return (
    <Screen>
      <Header title="Payment detail" />
      <View className="items-center mt-2 mb-6">
        <Text className="text-5xl font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
          {formatNgn(order.amount)}
        </Text>
        <Text className="text-muted-text mt-2">{subline}</Text>
      </View>

      {order.recipient?.memo ? <Field label="Memo" value={order.recipient.memo} /> : null}
      <Field
        label="Created"
        value={safeFormat(order.createdAt, 'MMM d, yyyy · h:mm a')}
      />
      {order.txHash ? <Field label="Settlement tx" value={order.txHash} mono /> : null}
      {order.gatewayId ? <Field label="On-chain order" value={order.gatewayId} mono /> : null}
    </Screen>
  );
}

function safeFormat(iso: string | undefined, pattern: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, pattern);
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="py-3 border-b border-line-divider">
      <Text className="text-xs uppercase tracking-wider text-muted-subtle">{label}</Text>
      <Text
        className="text-ink mt-1"
        numberOfLines={1}
        style={mono ? { fontFamily: 'Courier' } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}
