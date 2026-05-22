import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { cssInterop } from 'nativewind';
import { Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import type { PaymentOrderSummary } from '@/api/types';

cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

const STATUS_COLOR: Record<string, string> = {
  settled: 'text-success',
  pending: 'text-warning',
  processing: 'text-warning',
  fulfilled: 'text-warning',
  validated: 'text-warning',
  cancelled: 'text-muted-subtle',
  expired: 'text-muted-subtle',
  refunded: 'text-danger',
  initiated: 'text-muted-subtle',
};

const STATUS_LABEL: Record<string, string> = {
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

export function TransactionRow({ order }: { order: PaymentOrderSummary }) {
  const time = format(new Date(order.created_at), 'h:mm a');
  return (
    <Pressable
      className="bg-surface-soft rounded-lg p-4 flex-row items-center justify-between active:bg-surface-subtle"
      onPress={() => router.push(`/(app)/transactions/${order.id}`)}
    >
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
          {formatNgn(order.amount)}
        </Text>
        <Text className={`text-xs ${STATUS_COLOR[order.status] ?? 'text-muted-text'}`}>
          {STATUS_LABEL[order.status] ?? order.status}
        </Text>
      </View>
      <Text className="text-xs text-muted-subtle">{time}</Text>
    </Pressable>
  );
}
