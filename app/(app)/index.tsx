import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RnText,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight } from 'lucide-react-native';
import { ordersApi } from '@/api/endpoints';
import { Button, Icon, Icons, Text } from '@/ui';
import { formatNgn } from '@/ui/format';
import { AmountKeypad, type KeypadKey } from '@/ui/AmountKeypad';
import { DynamicAmount } from '@/ui/DynamicAmount';
import { useNetworkStatus, type NetworkStatus } from '@/hooks/useNetworkStatus';

const PAL = {
  bg:           '#0D0D0D',
  surface:      '#1A1A1C',
  surfaceSoft:  '#141416',
  hairline:     'rgba(255, 255, 255, 0.06)',
  border:       'rgba(255, 255, 255, 0.08)',
  text:         '#FFFFFF',
  textMuted:    'rgba(255, 255, 255, 0.55)',
  textSubtle:   'rgba(255, 255, 255, 0.30)',
  brand:        '#3B82F6',
  brandBg:      'rgba(59, 130, 246, 0.12)',
  netGood:      '#22C55E',
  netWeak:      '#F59E0B',
  netOff:       '#F43F5E',
} as const;

const NETWORK_ICON: Record<NetworkStatus, string> = {
  good: Icons.IconWifiGood,
  weak: Icons.IconWifiWeak,
  off:  Icons.IconWifiOff,
};

const NETWORK_COLOR: Record<NetworkStatus, string> = {
  good: PAL.netGood,
  weak: PAL.netWeak,
  off:  PAL.netOff,
};

const PRESETS = [5000, 10000, 50000];


export default function DashboardScreen() {
  const [amountStr, setAmountStr] = useState('');
  const network = useNetworkStatus();

  // "Today" pill — compute client-side from the recent orders list since
  // /v1/sender/stats only returns lifetime. Cheap (one extra request,
  // cached) and stays accurate without backend changes. Once Rails gains
  // a `since=today` filter we can swap to a dedicated endpoint.
  const todayOrdersQuery = useQuery({
    queryKey: ['sender', 'orders', 'today'],
    queryFn: () => ordersApi.list({ status: 'settled', limit: 100 }),
    refetchOnWindowFocus: true,
  });

  useFocusEffect(() => {
    void todayOrdersQuery.refetch();
  });

  const today = useMemo(() => {
    const orders = todayOrdersQuery.data?.orders ?? [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    let volume = 0;
    let count = 0;
    for (const o of orders) {
      const t = new Date(o.createdAt).getTime();
      if (Number.isNaN(t) || t < startMs) continue;
      volume += Number.parseFloat(o.amount) || 0;
      count += 1;
    }
    return { volume, count };
  }, [todayOrdersQuery.data]);

  const display = useMemo(() => formatAmountForDisplay(amountStr), [amountStr]);
  const amountValid = Number.parseFloat(amountStr || '0') > 0;

  function press(key: KeypadKey) {
    if (key.type === 'back') {
      setAmountStr((s) => s.slice(0, -1));
      return;
    }
    if (key.type === 'dot') {
      if (!amountStr.includes('.')) {
        setAmountStr((s) => (s.length === 0 ? '0.' : `${s}.`));
      }
      return;
    }
    // digit
    if (amountStr.includes('.')) {
      const [, frac] = amountStr.split('.');
      if ((frac?.length ?? 0) >= 2) return;
    }
    if (amountStr.length >= 9) return;
    setAmountStr((s) => (s === '0' ? key.value : `${s}${key.value}`));
  }

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ amount: amountStr });
    return p.toString();
  }, [amountStr]);

  return (
    <SafeAreaView edges={['top']} style={s.root}>
      {/* Header: centered Today pill + right-aligned connectivity dot.
          No greeting — POS screens stay focused on the transaction. */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.push('/(app)/transactions')}
          style={({ pressed }) => [s.todayPill, pressed && s.todayPillPressed]}
        >
          {todayOrdersQuery.isLoading ? (
            <ActivityIndicator size="small" color={PAL.brand} />
          ) : (
            <Text style={s.todayText}>
              Today · {formatNgn(today.volume)}
              <Text style={s.todayCount}>  ·  {today.count} {today.count === 1 ? 'sale' : 'sales'}</Text>
            </Text>
          )}
        </Pressable>
        <View style={s.netIcon}>
          <Icon
            xml={NETWORK_ICON[network]}
            size={18}
            color={NETWORK_COLOR[network]}
          />
        </View>
      </View>

      {/* Amount — focal point. DynamicAmount handles tier sizing, the
          analog-counter digit reels, comma slot stability, and reduced
          motion. We just pass it the formatted display string. */}
      <View style={s.amountWrap}>
        <Text style={s.amountLabel}>Enter amount to receive</Text>
        <DynamicAmount
          symbol="₦"
          formattedValue={display}
          active={amountValid}
          surface="dark"
        />
      </View>

      {/* Preset Amount Pills */}
      <View style={s.presetsRow}>
        {PRESETS.map((val) => {
          const valStr = val.toString();
          const isSelected = amountStr === valStr;
          return (
            <TouchableOpacity
              key={val}
              onPress={() => {
                if (amountStr === valStr) {
                  setAmountStr('');
                } else {
                  setAmountStr(valStr);
                }
              }}
              activeOpacity={0.7}
              style={[
                s.presetPill,
                isSelected && s.presetPillSelected,
              ]}
            >
              <RnText
                style={[
                  s.presetPillText,
                  isSelected && s.presetPillTextSelected,
                ]}
              >
                {formatNgn(val)}
              </RnText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Keypad — bare digits, users-app AmountKeypad pattern */}
      <View style={s.keypad}>
        <AmountKeypad onKeyPress={press} surface="dark" />
      </View>

      {/* Action — single CTA. The "/accept" screen presents both
          affordances (QR + NFC tap zone) so the customer self-selects. */}
      <View style={s.actions}>
        <Button
          label={amountValid ? `Accept ${formatNgn(amountStr)}` : 'Accept payment'}
          variant="primary"
          disabled={!amountValid}
          onPress={() => router.push(`/(app)/accept?${queryParams}`)}
          trailingIcon={<ArrowRight size={18} color="#FFFFFF" />}
          className="rounded-[16px]"
        />
      </View>
    </SafeAreaView>
  );
}

function formatAmountForDisplay(str: string): string {
  if (!str) return '0';
  const [whole, frac] = str.split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PAL.bg,
  },
  // Centered pill + trailing network icon. The pill is the only meaningful
  // content; the icon is positioned absolutely so the pill stays optically
  // centered regardless of icon presence/width.
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PAL.hairline,
  },
  todayPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: PAL.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PAL.border,
  },
  todayPillPressed: {
    backgroundColor: PAL.surfaceSoft,
  },
  todayText: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 12,
    color: PAL.text,
  },
  todayCount: {
    fontFamily: 'BricolageGrotesque-Regular',
    color: PAL.textMuted,
  },
  netIcon: {
    position: 'absolute',
    right: 20,
    top: 8,
    height: 32,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  amountLabel: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: PAL.textMuted,
    marginBottom: 12,
  },
  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  presetPill: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 999,
    backgroundColor: PAL.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  presetPillSelected: {
    backgroundColor: '#0065F5',
  },
  presetPillPressed: {
    opacity: 0.7,
  },
  presetPillText: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 14,
    color: PAL.textMuted,
  },
  presetPillTextSelected: {
    color: '#FFFFFF',
    fontFamily: 'BricolageGrotesque-SemiBold',
  },
  keypad: {
    paddingVertical: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
});
