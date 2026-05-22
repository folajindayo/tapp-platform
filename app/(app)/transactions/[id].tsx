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
          <ActivityIndicator color="#40FF00" />
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
  const subline = order.settled_at
    ? `${STATUS_TEXT[order.status] ?? order.status} · ${format(new Date(order.settled_at), 'h:mm a')}`
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

      {order.memo ? <Field label="Memo" value={order.memo} /> : null}
      <Field
        label="Created"
        value={format(new Date(order.created_at), 'MMM d, yyyy · h:mm a')}
      />
      {order.tx_hash ? <Field label="Settlement tx" value={order.tx_hash} mono /> : null}
      {order.gateway_id ? <Field label="On-chain order" value={order.gateway_id} mono /> : null}
    </Screen>
  );
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
