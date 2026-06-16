import { useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Eye, EyeOff } from "lucide-react-native";
import { authApi } from "@/api/endpoints";
import type { ApiError } from "@/api/types";
import { useAuthStore } from "@/auth/store";
import { Button, Icon, Icons, Text } from "@/ui";
import { EarlyAccessModal } from "@/components/EarlyAccessModal";

const PAL = {
  bg: "#0D0D0D",
  badgeBg: "rgba(255, 255, 255, 0.08)",
  badgeIcon: "rgba(255, 255, 255, 0.65)",
  text: "#FFFFFF",
  textMuted: "rgba(255, 255, 255, 0.55)",
  textSubtle: "rgba(255, 255, 255, 0.35)",
  inputBg: "rgba(255, 255, 255, 0.06)",
  required: "#F43F5E",
  success: "#22C55E",
  successBg: "rgba(34, 197, 94, 0.10)",
  brand: "#3B82F6",
} as const;

export default function PasswordScreen() {
  const queryClient = useQueryClient();
  const { email, verified } = useLocalSearchParams<{
    email?: string;
    verified?: string;
  }>();
  const setSession = useAuthStore((s) => s.setSession);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earlyAccessVisible, setEarlyAccessVisible] = useState(false);

  const justVerified = verified === "true";
  const valid = password.length >= 6 && !!email;

  const mutation = useMutation<
    Awaited<ReturnType<typeof authApi.login>>,
    ApiError
  >({
    mutationFn: () => authApi.login({ email: email!, password }),
    onSuccess: (data) => {
      queryClient.clear();
      // Session set — Guard will route to the correct step based on /me response.
      setSession(data.accessToken, data.refreshToken);
    },
    onError: (err) => {
      const msg = (err?.message ?? "").toLowerCase();

      if (msg.includes("early access request is still pending") || msg.includes("early access")) {
        setEarlyAccessVisible(true);
        return;
      }

      // Show a visible error for wrong password / account not found
      setError(err?.message ?? "Could not sign in. Try again.");
    },
  });

  function submit() {
    if (!valid || mutation.isPending) return;
    Keyboard.dismiss();
    setError(null);
    mutation.mutate();
  }

  return (
    <SafeAreaView edges={["top"]} style={s.root}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable hitSlop={10} onPress={() => router.back()} style={s.backRow}>
          <ChevronLeft size={20} color={PAL.textMuted} />
          <Text style={s.backText}>Back</Text>
        </Pressable>

        {justVerified && (
          <View style={s.verifiedBanner}>
            <Text style={s.verifiedText}>
              Email verified — sign in to continue.
            </Text>
          </View>
        )}

        <View style={s.badge}>
          <Icon xml={Icons.IconKey} size={32} color={PAL.badgeIcon} />
        </View>

        <Text style={s.title}>Enter your password</Text>
        <Text style={s.subtitle} numberOfLines={1}>
          {email}
        </Text>

        <View
          style={[
            s.input,
            error ? { borderWidth: 1, borderColor: PAL.required } : null,
          ]}
        >
          <TextInput
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (error) setError(null);
            }}
            placeholder="Password"
            placeholderTextColor={PAL.textSubtle}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            style={s.inputText}
          />
          <Pressable
            hitSlop={8}
            onPress={() => setVisible((v) => !v)}
            style={s.eyeBtn}
          >
            {visible ? (
              <EyeOff size={18} color={PAL.textMuted} />
            ) : (
              <Eye size={18} color={PAL.textMuted} />
            )}
          </Pressable>
        </View>

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <View style={s.buttonWrap}>
          <Button
            label="Sign in"
            onPress={submit}
            loading={mutation.isPending}
            disabled={!valid || mutation.isPending}
            className="rounded-[16px]"
          />
        </View>

        <Pressable
          hitSlop={8}
          onPress={() =>
            router.push({
              pathname: "/(auth)/forgot-password",
              params: { email },
            })
          }
          style={s.forgotRow}
        >
          <Text style={s.forgotText}>Forgot password?</Text>
        </Pressable>

        <View style={{ flex: 1, minHeight: 40 }} />

        <View style={s.signupRow}>
          <Text style={s.signupHint}>Don't have an account? </Text>
          <Link
            href={{ pathname: "/(auth)/sign-up", params: { email } }}
            asChild
          >
            <Pressable hitSlop={6}>
              <Text style={s.signupLink}>Sign up</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>

      <EarlyAccessModal
        visible={earlyAccessVisible}
        onClose={() => {
          setEarlyAccessVisible(false);
          router.replace('/(auth)/sign-in');
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    flex: 1,
    backgroundColor: PAL.bg,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 36,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  backText: {
    fontFamily: "BricolageGrotesque-Medium",
    fontSize: 15,
    color: PAL.textMuted,
  },
  verifiedBanner: {
    backgroundColor: PAL.successBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  verifiedText: {
    fontFamily: "BricolageGrotesque-Medium",
    fontSize: 13,
    color: PAL.success,
    textAlign: "center",
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PAL.badgeBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontFamily: "BricolageGrotesque-Bold",
    fontSize: 28,
    lineHeight: 34,
    color: PAL.text,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: "BricolageGrotesque-Regular",
    fontSize: 15,
    lineHeight: 20,
    color: PAL.textMuted,
    marginBottom: 24,
  },
  input: {
    height: 56,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: PAL.inputBg,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  inputText: {
    flex: 1,
    color: PAL.text,
    fontFamily: "BricolageGrotesque-Medium",
    fontSize: 16,
    padding: 0,
  },
  eyeBtn: {
    paddingLeft: 10,
    paddingVertical: 4,
  },
  errorText: {
    marginTop: -16,
    marginBottom: 16,
    fontFamily: "BricolageGrotesque-Regular",
    fontSize: 13,
    color: PAL.required,
  },
  buttonWrap: {
    width: "100%",
  },
  forgotRow: {
    alignSelf: "center",
    marginTop: 20,
  },
  forgotText: {
    fontFamily: "BricolageGrotesque-Medium",
    fontSize: 14,
    color: PAL.textMuted,
  },
  signupRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
    marginTop: 20,
  },
  signupHint: {
    fontFamily: "BricolageGrotesque-Regular",
    fontSize: 14,
    color: PAL.textMuted,
  },
  signupLink: {
    fontFamily: "BricolageGrotesque-SemiBold",
    fontSize: 14,
    color: PAL.brand,
  },
});
