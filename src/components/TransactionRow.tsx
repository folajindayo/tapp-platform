import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { cssInterop } from 'nativewind';
import { ArrowDownLeft, Clock, XCircle } from 'lucide-react-native';
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

export function TransactionRow({ order, isLast }: { order: PaymentOrderSummary; isLast?: boolean }) {
  const time = format(new Date(order.created_at), 'h:mm a');
  const isSettled = order.status === 'settled';
  const isFailed = order.status === 'cancelled' || order.status === 'expired' || order.status === 'refunded';
  
  // Icon and Colors based on status
  const IconComponent = isFailed ? XCircle : (isSettled ? ArrowDownLeft : Clock);
  const iconBgClass = isFailed 
    ? 'bg-danger/10' 
    : (isSettled ? 'bg-brand-blue/10' : 'bg-warning/10');
  const iconColor = isFailed 
    ? '#C9252D' 
    : (isSettled ? '#0065F5' : '#FF6B00');

  return (
    <Pressable
      className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-subtle ${isLast ? '' : 'border-b border-line-divider/50 border-dashed'}`}
      onPress={() => router.push(`/(app)/transactions/${order.id}`)}
    >
      <View className={`w-10 h-10 rounded-full items-center justify-center ${iconBgClass}`}>
        <IconComponent size={20} color={iconColor} strokeWidth={2} />
      </View>
      
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-semibold text-ink" numberOfLines={1}>
          {order.memo || 'Payment Received'}
        </Text>
        <Text className="text-xs text-muted-text">
          <Text className={`${STATUS_COLOR[order.status] ?? 'text-muted-text'} font-medium`}>
            {STATUS_LABEL[order.status] ?? order.status}
          </Text>
          {' · '}{time}
        </Text>
      </View>

      <View className="items-end">
        <Text className="text-base font-semibold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
          {formatNgn(order.amount)}
        </Text>
      </View>
    </Pressable>
  );
}
