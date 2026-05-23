import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { cssInterop } from 'nativewind';
import { ArrowUpRight, Clock, AlertTriangle } from 'lucide-react-native';
import { Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import type { PaymentOrderSummary } from '@/api/types';

cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; icon: any }
> = {
  settled: { label: 'Settled', bg: 'bg-success/15', text: 'text-success', icon: ArrowUpRight },
  pending: { label: 'Pending', bg: 'bg-warning/15', text: 'text-warning', icon: Clock },
  processing: { label: 'Processing', bg: 'bg-warning/15', text: 'text-warning', icon: Clock },
  fulfilled: { label: 'Fulfilled', bg: 'bg-warning/15', text: 'text-warning', icon: Clock },
  validated: { label: 'Validated', bg: 'bg-warning/15', text: 'text-warning', icon: Clock },
  cancelled: { label: 'Cancelled', bg: 'bg-surface-soft', text: 'text-muted-text', icon: AlertTriangle },
  expired: { label: 'Expired', bg: 'bg-surface-soft', text: 'text-muted-text', icon: AlertTriangle },
  refunded: { label: 'Refunded', bg: 'bg-danger/15', text: 'text-danger', icon: AlertTriangle },
  initiated: { label: 'Initiated', bg: 'bg-surface-soft', text: 'text-muted-text', icon: Clock },
};

export function TransactionRow({ order }: { order: PaymentOrderSummary }) {
  let time = '—';
  if (order.created_at) {
    try {
      const d = new Date(order.created_at);
      if (!isNaN(d.getTime())) {
        time = format(d, 'MMM d, h:mm a');
      }
    } catch (e) {
      // safe fallback
    }
  }
  const config = STATUS_CONFIG[order.status] ?? {
    label: order.status,
    bg: 'bg-surface-soft',
    text: 'text-muted-text',
    icon: Clock,
  };
  const IconComponent = config.icon;

  return (
    <Pressable
      className="bg-surface rounded-2xl p-4 flex-row items-center gap-4 border border-line active:opacity-90"
      onPress={() => router.push(`/(app)/transactions/${order.id}`)}
    >
      <View className="h-11 w-11 rounded-full bg-surface-soft items-center justify-center border border-line">
        <IconComponent size={18} className={config.text} />
      </View>
      <View className="flex-1">
        <Text className="text-base font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
          {formatNgn(order.amount)}
        </Text>
        <Text className="text-xs text-muted-text mt-0.5">{time}</Text>
      </View>
      <View className={`px-3 py-1 rounded-full ${config.bg}`}>
        <Text className={`text-xs font-semibold ${config.text}`}>{config.label}</Text>
      </View>
    </Pressable>
  );
}
