import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { kycApi } from "@/api/endpoints";
import { useAuthStore } from "@/auth/store";
import { Button } from "@/ui";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

// ─── Colors (same palette as bank-account) ───────────────────────────────────
const C = {
  bg: "#0A0A0C",
  textPrimary: "#F5F5F7",
  textSecondary: "rgba(255,255,255,0.60)",
  accent: "#3B82F6",
  accentSoft: "rgba(59,130,246,0.15)",
  green: "#34D399",
  greenSoft: "rgba(52,211,153,0.12)",
} as const;

export default function KybScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [pollUntil, setPollUntil] = useState<number | null>(null);

  const isPolling = !!pollUntil && Date.now() < pollUntil;
  const statusQuery = useQuery({
    queryKey: ["kyc", "status", userId],
    queryFn: () => kycApi.status(userId ?? ""),
    enabled: !!userId && isPolling,
    refetchInterval: isPolling ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    if (statusQuery.data.status === "success") {
      setPollUntil(null);
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    } else if (statusQuery.data.status === "failed") {
      setPollUntil(null);
      Alert.alert("Verification failed", "Try again or use a different ID.");
    }
  }, [statusQuery.data, queryClient]);

  const startVerification = () => {
    router.replace("/(onboarding)/bank-account");
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(auth)/sign-in");
    }
  };

  return (
    <SafeAreaView style={$.safeArea} edges={["top", "left", "right"]}>
      <View style={$.container}>
        {/* ── Top bar (same as bank-account) ──────────── */}
        <View style={$.topBar}>
          <Pressable onPress={handleBack} hitSlop={14} style={$.backCircle}>
            <Text style={$.backArrow}>‹</Text>
          </Pressable>
          <View style={$.dots}>
            <View style={[$.dot, $.dotDone]} />
            <View style={[$.dot, $.dotDone]} />
            <View style={[$.dot, $.dotActive]} />
            <View style={$.dot} />
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* ── Title ──────────────────────────────────────── */}
        <Text style={$.heading}>Verify your identity</Text>
        <Text style={$.subheading}>
          We use your BVN to confirm your identity.{"\n"}Takes about 30 seconds.
        </Text>

        {/* ── Bullet points ─────────────────────────────── */}
        <View style={$.bullets}>
          <BulletRow text="Your BVN is never stored on our servers" />
          <BulletRow text="You won't be charged" />
          <BulletRow text="Required to enable bank payouts" />
        </View>

        {/* Spacer */}
        <View style={$.flex} />

        {/* ── Status text ───────────────────────────────── */}
        {isPolling && (
          <Text style={$.pollingText}>
            Verifying — this can take up to a minute.
          </Text>
        )}

        {/* ── CTA ───────────────────────────────────────── */}
        <Button
          label={isPolling ? "Verifying…" : "Start verification"}
          onPress={startVerification}
          loading={starting || isPolling}
          disabled={isPolling}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── Bullet row ──────────────────────────────────────────────────────────────
function BulletRow({ text }: { text: string }) {
  return (
    <View style={$.bulletRow}>
      <View style={$.bulletDot} />
      <Text style={$.bulletText}>{text}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const $ = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, paddingHorizontal: 20, paddingBottom: 32 },
  flex: { flex: 1 },

  // Top bar — identical to bank-account
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    marginBottom: 28,
  },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  backArrow: {
    fontSize: 22,
    color: C.textPrimary,
    marginTop: -2,
  },
  dots: { flexDirection: "row", gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  dotDone: { backgroundColor: "rgba(59,130,246,0.45)" },
  dotActive: { backgroundColor: C.accent },

  // Title
  heading: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
    lineHeight: 36,
    marginBottom: 8,
  },
  subheading: {
    fontSize: 15,
    fontWeight: "400",
    color: C.textSecondary,
    lineHeight: 22,
    marginBottom: 28,
  },

  // Bullets
  bullets: { gap: 14 },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.accent,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "400",
    color: C.textPrimary,
    lineHeight: 22,
  },

  // Polling text
  pollingText: {
    fontSize: 14,
    fontWeight: "400",
    color: C.textSecondary,
    textAlign: "center",
    marginBottom: 12,
  },
});
