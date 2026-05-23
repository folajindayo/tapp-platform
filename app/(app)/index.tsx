import { memo, useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Plus,
  ArrowRight,
  Zap,
  History,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react-native";
import { format } from "date-fns";
import { SafeAreaView } from "react-native-safe-area-context";
import { cssInterop } from "nativewind";
import { ordersApi } from "@/api/endpoints";
import { useAuthStore } from "@/auth/store";
import { queryKeys } from "@/queries/keys";
import { useMe } from "@/queries/useMe";
import { Text } from "@/ui";
import { formatNgn, formatNumber } from "@/ui/format";
import { colors } from "@/ui/theme";
import type { PaymentOrderSummary } from "@/api/types";

cssInterop(SafeAreaView, { className: { target: "style" } });
cssInterop(Pressable, { className: { target: "style" } });
cssInterop(View, { className: { target: "style" } });
cssInterop(ScrollView, {
  className: { target: "style" },
  contentContainerClassName: { target: "contentContainerStyle" },
});

// ─── module-level constants (computed once, never per-render) ────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const GREETING = getGreeting();
const DATE_STR = format(new Date(), "EEEE d");
const MONTH_STR = format(new Date(), "MMMM yyyy");
const BAR_STEPS = 10;
const BAR_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const STATUS: Record<
  string,
  { label: string; color: string; bg: string; Icon: any }
> = {
  settled: {
    label: "Settled",
    color: colors.success,
    bg: colors.successBg,
    Icon: CheckCircle2,
  },
  fulfilled: {
    label: "Fulfilled",
    color: colors.success,
    bg: colors.successBg,
    Icon: CheckCircle2,
  },
  validated: {
    label: "Validated",
    color: colors.success,
    bg: colors.successBg,
    Icon: CheckCircle2,
  },
  pending: {
    label: "Pending",
    color: colors.warning,
    bg: colors.warningBg,
    Icon: Clock,
  },
  processing: {
    label: "Processing",
    color: colors.warning,
    bg: colors.warningBg,
    Icon: Clock,
  },
  initiated: {
    label: "Initiated",
    color: colors.warning,
    bg: colors.warningBg,
    Icon: Clock,
  },
  cancelled: {
    label: "Cancelled",
    color: colors.textMuted,
    bg: colors.surfaceMuted,
    Icon: AlertTriangle,
  },
  expired: {
    label: "Expired",
    color: colors.textMuted,
    bg: colors.surfaceMuted,
    Icon: AlertTriangle,
  },
  refunded: {
    label: "Refunded",
    color: colors.danger,
    bg: colors.dangerBg,
    Icon: AlertTriangle,
  },
};
const DEFAULT_STATUS = {
  label: "Pending",
  color: colors.warning,
  bg: colors.warningBg,
  Icon: Clock,
};

// ─── screen ──────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const meQuery = useMe();
  const statsQuery = useQuery({
    queryKey: queryKeys.orders.stats(),
    queryFn: ordersApi.stats,
    enabled: isAuthenticated,
  });
  const recentQuery = useQuery({
    queryKey: queryKeys.orders.recent(),
    queryFn: () => ordersApi.list({ limit: 8 }),
    enabled: isAuthenticated,
  });

  const refreshing = statsQuery.isRefetching || recentQuery.isRefetching;

  const onRefresh = useCallback(async () => {
    await Promise.all([
      meQuery.refetch(),
      statsQuery.refetch(),
      recentQuery.refetch(),
    ]);
  }, [meQuery, statsQuery, recentQuery]);

  const firstName = meQuery.data?.first_name;

  const totalCount = statsQuery.data?.totalOrders ?? 0;
  const totalAmount = statsQuery.data?.totalOrderVolume ?? "0";
  const filledBars = Math.min(totalCount, BAR_STEPS);

  const orders = useMemo(
    () => recentQuery.data?.orders ?? [],
    [recentQuery.data],
  );

  return (
    <SafeAreaView
      className="flex-1 bg-surface-bg border"
      edges={["top", "left", "right"]}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="pt-5"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
          />
        }
      >
        <View className="flex flex-col !gap-6 px-6">
          {/* ── Date header ─────────────────────────────────────── */}
          {/* <View className="flex-row items-start justify-between">
            <View>
              <View className="flex-row items-center gap-1.5">
                <Text className="text-[22px] font-bold text-white">
                  {DATE_STR}
                </Text>
                <View className="w-[7px] h-[7px] rounded-[4px] bg-brand mt-0.5" />
              </View>
              <Text className="text-sm font-sans text-muted-text mt-0.5">
                {MONTH_STR}
              </Text>
            </View>
            <Pressable
              className="w-[42px] h-[42px] rounded-full bg-surface border border-line items-center justify-center"
              hitSlop={8}
            >
              <Bell size={19} color={colors.text} />
            </Pressable>
          </View> */}
          <View className="w-full flex flex-row items-center justify-between">
            <View className="max-w-[60%] text-left flex flex-col">
              <Text className="text-[20px] font-[OpenSans-semibold] text-white leading-[28px]">
                Welcome back,
              </Text>
              <Text className="text-[20px] !font-[OpenSans-Bold] !text-brand leading-[28px]">
                {firstName}
              </Text>
            </View>
            <Pressable>
              <Bell size={26} color={colors.text} />
            </Pressable>
          </View>
          <View className="w-full bg-surface p-7 flex flex-col gap-6 rounded-[16px]">
            <View className="w-full flex flex-col items-left gap-2">
              <Text className="text-[13px] text-white/70 font-[OpenSans-semibold]">
                Available balance
              </Text>
              <Text className="text-white text-[42px] font-[OpenSans-Bold] leading-[48px]">
                ${formatNumber("12000")}
              </Text>
            </View>

            <View className="flex-row gap-2.5">
              <Pressable
                className="flex-row items-center gap-1.5 px-4 h-[38px] rounded-pill bg-brand"
                onPress={NAV.newPayment}
              >
                <Plus size={13} color="white" />
                <Text className="text-[13px] font-semibold text-white">
                  Request Payment
                </Text>
              </Pressable>
              <Pressable
                className="flex-row items-center gap-1.5 px-4 h-[38px] rounded-pill bg-surface border border-line"
                onPress={NAV.tapCard}
              >
                <Zap size={13} color={colors.textMuted} />
                <Text className="text-[13px] font-semibold text-muted-text">
                  Tap Card
                </Text>
              </Pressable>
              <Pressable
                className="flex-row items-center gap-1.5 px-4 h-[38px] rounded-pill bg-surface border border-line"
                onPress={NAV.transactions}
              >
                <History size={13} color={colors.textMuted} />
                <Text className="text-[13px] font-semibold text-muted-text">
                  History
                </Text>
              </Pressable>
            </View>
          </View>

          {/* ── Progress card ────────────────────────────────────── */}
          <View className="bg-surface rounded-[16px] h-auto p-5 flex-col gap-2">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center gap-2">
                <View className="w-2 h-2 rounded-[4px] bg-brand" />
                <Text className="text-[13px] font-semibold text-ink">
                  Payments
                </Text>
              </View>
              <View className="px-2.5 py-1 rounded-pill bg-brand/[0.15]">
                <Text className="text-[11px] font-semibold text-brand">
                  {totalCount} payment{totalCount !== 1 ? "s" : ""}
                </Text>
              </View>
            </View>

            <Text className="text-[28px] p-2 font-bold text-white">
              {formatNgn(totalAmount)}
            </Text>
            <Text className="text-xs font-sans text-muted-text mb-4">
              {totalCount === 0
                ? "No payments yet."
                : "You're on a roll! Keep taking payments."}
            </Text>

            <View className="flex-row gap-1">
              {BAR_INDICES.map((i) => (
                <View
                  key={i}
                  className="flex-1 h-1.5 rounded-[3px]"
                  style={{
                    backgroundColor:
                      i < filledBars ? colors.brand : colors.surfaceMuted,
                  }}
                />
              ))}
            </View>
          </View>

          {/* ── Recent payments ──────────────────────────────────── */}
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-white">
              Recent Payments
            </Text>
            <Pressable
              className="flex-row items-center gap-1"
              onPress={NAV.transactions}
              hitSlop={8}
            >
              <Text className="text-[13px] font-semibold text-brand">
                See all
              </Text>
              <ArrowRight size={13} color={colors.brand} />
            </Pressable>
          </View>

          {recentQuery.isLoading ? (
            <View className="flex flex-row items-center justify-center">
              <ActivityIndicator size={20} color={colors.brand} />
            </View>
          ) : orders.length === 0 ? (
            <View className="bg-surface rounded-[18px] p-7 items-center border border-line">
              <Text className="text-sm font-sans text-muted-text text-center">
                No payments yet.
              </Text>
              <Text className="text-xs font-sans text-muted-inactive mt-1 text-center">
                Tap "New Request" to take your first payment.
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3"
              decelerationRate="fast"
            >
              <View className="!w-full !flex !flex-col gap-3 items-start">
                {orders.map((o) => (
                  <PaymentCard key={o.id} order={o} />
                ))}
              </View>
            </ScrollView>
          )}

          <View className="h-[120px]" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── stable navigation handlers (module-level, never re-created) ─────────────

const NAV = {
  newPayment: () => router.push("/(app)/new-payment"),
  tapCard: () => router.push("/(app)/tap-card"),
  transactions: () => router.push("/(app)/transactions"),
};

// ─── payment card (memoized — only re-renders when its order changes) ─────────

const PaymentCard = memo(function PaymentCard({
  order,
}: {
  order: PaymentOrderSummary;
}) {
  const cfg = STATUS[order.status] ?? DEFAULT_STATUS;

  const onPress = useCallback(
    () => router.push(`/(app)/transactions/${order.id}`),
    [order.id],
  );

  const formattedDate = useMemo(() => {
    if (!order?.created_at) return "—";
    try {
      const date = new Date(order.created_at);
      if (isNaN(date.getTime())) return "—";
      return format(date, "MMM d, h:mm a");
    } catch {
      return "—";
    }
  }, [order?.created_at]);

  return (
    <Pressable
      className="!w-full flex flex-row items-center justify-between gap-2.5"
      onPress={onPress}
    >
      <View className="flex flex-row gap-3 items-center">
        <View
          className="w-16 h-16 rounded-full items-center justify-center bg-brand/40"
        ></View>
        <View className="flex flex-col gap-1 items-start">
          <Text className="text-xl font-bold text-white">
            {order.amount} {order.token}
          </Text>
          <Text className="text-[14px] text-white">
            {formattedDate}
          </Text>
        </View>
      </View>
      <View
        className="self-start px-2 py-[3px] rounded-pill"
        style={{ backgroundColor: cfg.bg }}
      >
        <Text
          className="text-[11px] font-semibold"
          style={{ color: cfg.color }}
        >
          {cfg.label}
        </Text>
      </View>
      <View className="flex-row items-center gap-1 mt-0.5">
        <Text className="text-xs font-semibold text-ink">View details</Text>
        <ArrowRight size={12} color={colors.text} />
      </View>
    </Pressable>
  );
});
