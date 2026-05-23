import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react-native';
import { ordersApi } from '@/api/endpoints';
import { queryKeys } from '@/queries/keys';
import { Header, Screen, Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import { colors } from '@/ui/theme';

const STATUS_CFG: Record<
  string,
  { label: string; color: string; bg: string; Icon: any }
> = {
  settled:    { label: 'Settled',    color: colors.success,    bg: colors.successBg, Icon: CheckCircle2  },
  fulfilled:  { label: 'Fulfilled',  color: colors.success,    bg: colors.successBg, Icon: CheckCircle2  },
  validated:  { label: 'Validated',  color: colors.success,    bg: colors.successBg, Icon: CheckCircle2  },
  pending:    { label: 'Pending',    color: colors.warning,    bg: colors.warningBg, Icon: Clock         },
  processing: { label: 'Processing', color: colors.warning,    bg: colors.warningBg, Icon: Clock         },
  initiated:  { label: 'Initiated',  color: colors.warning,    bg: colors.warningBg, Icon: Clock         },
  cancelled:  { label: 'Cancelled',  color: colors.textMuted,  bg: colors.surfaceMuted, Icon: AlertTriangle },
  expired:    { label: 'Expired',    color: colors.textMuted,  bg: colors.surfaceMuted, Icon: AlertTriangle },
  refunded:   { label: 'Refunded',   color: colors.danger,     bg: colors.dangerBg,  Icon: AlertTriangle },
};

const DEFAULT_CFG = {
  label: 'Unknown',
  color: colors.textMuted,
  bg: colors.surfaceMuted,
  Icon: Clock,
};

function safeFormat(dateStr: string | undefined | null, formatStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '—' : format(d, formatStr);
  } catch {
    return '—';
  }
}

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({
    queryKey: queryKeys.orders.detail(String(id)),
    queryFn: () => ordersApi.get(String(id)),
    enabled: !!id,
  });

  if (query.isLoading) {
    return (
      <Screen scrollable={false}>
        <Header title="Payment detail" />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }

  if (!query.data) {
    return (
      <Screen>
        <Header title="Payment detail" />
        <View className="bg-surface rounded-2xl p-6 border border-line mt-4">
          <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 14 }}>
            Couldn't load this transaction.
          </Text>
        </View>
      </Screen>
    );
  }

  const order = query.data;
  const cfg = STATUS_CFG[order.status] ?? DEFAULT_CFG;
  const { Icon } = cfg;

  const settledTime = order.settled_at
    ? safeFormat(order.settled_at, 'h:mm a')
    : null;

  return (
    <Screen>
      <Header title="Payment detail" />

      {/* ── Hero: amount + status ──────────────────────────── */}
      <View className="items-center pt-2 pb-8">
        <Text
          style={{
            fontSize: 52,
            fontFamily: 'OpenSans-Bold',
            color: colors.textStrong,
            fontVariant: ['tabular-nums'],
            letterSpacing: -1,
            lineHeight: 60,
          }}
        >
          {formatNgn(order.amount)}
        </Text>

        {/* Status badge */}
        <View
          className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full mt-3"
          style={{ backgroundColor: cfg.bg }}
        >
          <Icon size={13} color={cfg.color} strokeWidth={2} />
          <Text
            style={{
              fontSize: 13,
              fontFamily: 'OpenSans-SemiBold',
              color: cfg.color,
            }}
          >
            {cfg.label}
            {settledTime ? ` · ${settledTime}` : ''}
          </Text>
        </View>
      </View>

      {/* ── Field list ────────────────────────────────────── */}
      <View className="bg-surface rounded-2xl border border-line overflow-hidden">
        {order.memo ? (
          <Field label="Note" value={order.memo} />
        ) : null}
        <Field
          label="Created"
          value={safeFormat(order.created_at, 'MMM d, yyyy · h:mm a')}
        />
        {order.settled_at ? (
          <Field
            label="Settled"
            value={safeFormat(order.settled_at, 'MMM d, yyyy · h:mm a')}
          />
        ) : null}
        {order.tx_hash ? (
          <Field label="Settlement tx" value={order.tx_hash} mono last={!order.gateway_id} />
        ) : null}
        {order.gateway_id ? (
          <Field label="On-chain order" value={order.gateway_id} mono last />
        ) : null}
        {!order.tx_hash && !order.gateway_id ? (
          <Field label="Created" value={safeFormat(order.created_at, 'MMM d, yyyy · h:mm a')} last />
        ) : null}
      </View>
    </Screen>
  );
}

function Field({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View
      className="px-4 py-3.5"
      style={{
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.divider,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontFamily: 'OpenSans-SemiBold',
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 14,
          fontFamily: mono ? 'Courier' : 'OpenSans-Regular',
          color: colors.text,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
