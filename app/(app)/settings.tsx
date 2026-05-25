import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { authApi, merchantApi } from "@/api/endpoints";
import { queryKeys } from "@/queries/keys";
import { useAuthStore } from "@/auth/store";
import { Header, Icon, Icons, Screen, Text } from "@/ui";
import { maskAccountNumber } from "@/ui/format";
import { colors } from "@/ui/theme";

cssInterop(Pressable, { className: { target: "style" } });

const SUPPORT_URLS = {
  help: "https://help.zoracle.xyz",
  terms: "https://zoracle.xyz/terms",
  privacy: "https://zoracle.xyz/privacy",
} as const;

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: authApi.me,
  });

  const bankQuery = useQuery({
    queryKey: queryKeys.merchant.bankAccount(),
    queryFn: merchantApi.getBankAccount,
  });

  function confirmSignOut() {
    Alert.alert("Sign out?", "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          setSigningOut(true);
          queryClient.clear();
          signOut();
          setSigningOut(false);
        },
      },
    ]);
  }

  async function openExternal(url: string) {
    const can = await Linking.canOpenURL(url);
    if (!can) {
      Alert.alert("Cannot open link", url);
      return;
    }
    await Linking.openURL(url);
  }

  const kycStatus = meQuery.data?.kyc_status;
  const kycLabel =
    kycStatus === "success"
      ? "Verified"
      : kycStatus
        ? kycStatus.charAt(0).toUpperCase() + kycStatus.slice(1)
        : "—";
  const kycColor = kycStatus === "success" ? colors.success : colors.textMuted;

  return (
    // scrollable=false so the Header stays pinned; the body content
    // scrolls inside its own ScrollView below.
    <Screen scrollable={false}>
      <Header title="Account" back={false} />

      <ScrollView
        style={{ flex: 1, marginHorizontal: -20 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Section title="Profile">
          <Row
            icon={Icons.IconName}
            label="Merchant Name"
            value={
              meQuery.data?.first_name || meQuery.data?.last_name
                ? `${meQuery.data?.first_name ?? ""} ${meQuery.data?.last_name ?? ""}`.trim()
                : "Add your name"
            }
            chevron
            onPress={() => router.push("/(app)/profile")}
          />
          <Row
            icon={Icons.IconEmail}
            label="Email"
            value={user?.email ?? "—"}
          />
          <Row
            icon={Icons.IconKycStatus}
            label="KYC"
            value={kycStatus === "success" ? `✓ ${kycLabel}` : kycLabel}
            valueColor={kycColor}
            last
          />
        </Section>

        <Section title="Payouts">
          <Row
            icon={Icons.IconBank}
            label="Bank account"
            value={
              bankQuery.data
                ? `${bankQuery.data.account_name} · ${maskAccountNumber(bankQuery.data.account_number)}`
                : "Not set"
            }
            chevron
            last
            onPress={() => router.push("/(onboarding)/bank-account")}
          />
        </Section>

        <Section title="Security">
          <Row
            icon={Icons.IconInfo}
            label="Change password"
            value=""
            chevron
            last
            onPress={() => router.push("/(app)/change-password")}
          />
        </Section>

        <Section title="Support">
          <Row
            icon={Icons.IconHelp}
            label="Help centre"
            value=""
            chevron
            onPress={() => openExternal(SUPPORT_URLS.help)}
          />
          <Row
            icon={Icons.IconTerms}
            label="Terms of service"
            value=""
            chevron
            onPress={() => openExternal(SUPPORT_URLS.terms)}
          />
          <Row
            icon={Icons.IconPrivacy}
            label="Privacy policy"
            value=""
            chevron
            last
            onPress={() => openExternal(SUPPORT_URLS.privacy)}
          />
        </Section>

        <Section title="About">
          <Row icon={Icons.IconInfo} label="Version" value="0.1.0" last />
        </Section>

        {/* ── Sign out ─────────────────────────────────────── */}
        <View className="mt-2 mb-8">
          <Pressable
            className="flex-row items-center justify-center gap-2.5 h-[52px] rounded-xl border active:bg-surface-subtle"
            style={{ borderColor: colors.border }}
            onPress={confirmSignOut}
            disabled={signingOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <LogOut size={16} color={colors.danger} strokeWidth={1.8} />
            <Text
              style={{
                fontSize: 15,
                fontFamily: "BricolageGrotesque-SemiBold",
                color: colors.danger,
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-5">
      <Text
        className="mb-2 px-1"
        style={{
          fontSize: 11,
          fontFamily: "BricolageGrotesque-SemiBold",
          color: colors.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {title}
      </Text>
      <View className="bg-surface rounded-2xl overflow-hidden border border-line">
        {children}
      </View>
    </View>
  );
}

// ─── Row item ────────────────────────────────────────────────────────────────

function Row({
  icon,
  label,
  value,
  chevron,
  last,
  onPress,
  valueColor,
}: {
  icon?: string;
  label: string;
  value: string;
  chevron?: boolean;
  last?: boolean;
  onPress?: () => void;
  valueColor?: string;
}) {
  const inner = (
    <View
      className="flex-row items-center px-4 py-3.5"
      style={{
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.divider,
      }}
    >
      {/* Left: icon + label */}
      <View className="flex-row items-center gap-3 flex-1">
        {icon ? <Icon xml={icon} size={18} color={colors.textMuted} /> : null}
        <Text
          style={{
            fontSize: 15,
            fontFamily: "BricolageGrotesque-Regular",
            color: colors.text,
          }}
        >
          {label}
        </Text>
      </View>

      {/* Right: value + chevron */}
      <View className="flex-row items-center gap-2" style={{ maxWidth: "55%" }}>
        {value ? (
          <Text
            numberOfLines={1}
            style={{
              fontSize: 13,
              fontFamily: "BricolageGrotesque-Regular",
              color: valueColor ?? colors.textMuted,
              textAlign: "right",
              flexShrink: 1,
            }}
          >
            {value}
          </Text>
        ) : null}
        {chevron ? (
          <View style={{ flexShrink: 0 }}>
            <ChevronRight
              size={15}
              color={colors.textMuted}
              strokeWidth={1.6}
            />
          </View>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="active:bg-surface-subtle"
    >
      {inner}
    </Pressable>
  );
}
