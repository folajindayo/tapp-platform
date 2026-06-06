import { useEffect, useMemo, useState } from 'react';
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
import { catalogApi, ordersApi } from '@/api/endpoints';
import { Button, Text, formatNumber } from '@/ui';
import { formatNgn } from '@/ui/format';
import { AmountKeypad, type KeypadKey } from '@/ui/AmountKeypad';
import { DynamicAmount } from '@/ui/DynamicAmount';
import { useAuthStore } from '@/auth/store';

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
} as const;

const PRESETS = [5000, 10000, 50000];

// Module-level cache for the exchange rate
let cachedExchangeRate: string | null = null;

export default function DashboardScreen() {
  const [amountStr, setAmountStr] = useState('');

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Today's running totals. Rails accepts ?period=today so we don't
  // have to hand-roll the aggregate client-side.
  const todayStatsQuery = useQuery({
    queryKey: ['sender', 'stats', 'today'],
    queryFn: () => ordersApi.stats('today'),
    enabled: isAuthenticated,
    refetchOnWindowFocus: true,
  });

  useFocusEffect(() => {
    void todayStatsQuery.refetch();
  });

  const today = useMemo(() => {
    const s = todayStatsQuery.data;
    return {
      volume: Number.parseFloat(s?.totalOrderVolume ?? '0') || 0,
      count: s?.totalOrders ?? 0,
    };
  }, [todayStatsQuery.data]);

  const display = useMemo(() => formatAmountForDisplay(amountStr), [amountStr]);
  const amountValid = Number.parseFloat(amountStr || '0') > 0;

  const [debouncedAmountStr, setDebouncedAmountStr] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedAmountStr(amountStr);
    }, 300);
    return () => clearTimeout(handler);
  }, [amountStr]);

  const rateQuery = useQuery({
    queryKey: ['rate', 'USDC', debouncedAmountStr, 'NGN'],
    queryFn: () => catalogApi.rates('USDC', debouncedAmountStr, 'NGN'),
    enabled: debouncedAmountStr !== '' && Number.parseFloat(debouncedAmountStr || '0') > 0,
  });

  useEffect(() => {
    if (rateQuery.data) {
      cachedExchangeRate = rateQuery.data;
    }
  }, [rateQuery.data]);

  const usdcValue = useMemo(() => {
    if (!amountStr) return null;
    const rateValStr = rateQuery.data || cachedExchangeRate;
    if (!rateValStr) return null;
    const fiatVal = Number.parseFloat(amountStr);
    const rateVal = Number.parseFloat(rateValStr);
    if (!fiatVal || !rateVal) return null;
    return fiatVal / rateVal;
  }, [amountStr, rateQuery.data]);

  const hintText = useMemo(() => {
    if (!amountValid) return '—';
    if (usdcValue === null) return '—';
    return `≈ ${formatNumber(usdcValue)} USDC`;
  }, [amountValid, usdcValue]);

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
      {/* Header: centered Today pill. POS-focused — no greeting, no
          extra glyphs. */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.push('/(app)/transactions')}
          style={({ pressed }) => [s.todayPill, pressed && s.todayPillPressed]}
        >
          {todayStatsQuery.isLoading ? (
            <ActivityIndicator size="small" color={PAL.brand} />
          ) : (
            <Text style={s.todayText}>
              Today · ${today.volume.toFixed(2)}
              <Text style={s.todayCount}>  ·  {today.count} {today.count === 1 ? 'sale' : 'sales'}</Text>
            </Text>
          )}
        </Pressable>
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
        <Text style={s.rateHint}>{hintText}</Text>
      </View>

      {/* Preset Amount Pills */}
      <View style={s.presetsRow}>
        {PRESETS.map((val) => {
          const valStr = val.toString();
          return (
            <TouchableOpacity
              key={val}
              onPress={() => setAmountStr(valStr)}
              activeOpacity={0.7}
              style={s.presetPill}
            >
              <RnText style={s.presetPillText}>
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
    fontSize: 14,
    color: PAL.text,
  },
  todayCount: {
    fontFamily: 'BricolageGrotesque-Regular',
    color: PAL.textMuted,
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
  rateHint: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 12,
    color: PAL.textMuted,
    marginTop: 12,
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
  presetPillPressed: {
    opacity: 0.7,
  },
  presetPillText: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 14,
    color: PAL.textMuted,
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
