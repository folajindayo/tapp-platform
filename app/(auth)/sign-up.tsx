import { useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Link, router } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react-native";
import { authApi } from "@/api/endpoints";
import type { ApiError } from "@/api/types";
import { useAuthStore } from "@/auth/store";
import { Button, Icon, Icons, Screen, Text } from "@/ui";

const schema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a number"),
});

type FormValues = z.infer<typeof schema>;

const PAL = {
  cardBg: "#121214",
  cardBorder: "rgba(255, 255, 255, 0.08)",
  fieldBg: "#1F1F22",
  fieldBorder: "rgba(255, 255, 255, 0.10)",
  fieldFocus: "#3B82F6",
  text: "#FFFFFF",
  textValue: "rgba(255, 255, 255, 0.92)",
  textMuted: "rgba(255, 255, 255, 0.55)",
  textSubtle: "rgba(255, 255, 255, 0.45)",
  required: "#F43F5E",
  brand: "#3B82F6",
  badgeBg: "rgba(255, 255, 255, 0.08)",
  badgeIcon: "rgba(255, 255, 255, 0.65)",
} as const;

export default function SignUpScreen() {
  const setSession = useAuthStore((s) => s.setSession);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { firstName: "", lastName: "", email: "", password: "" },
    mode: "onChange",
  });

  const mutation = useMutation<void, ApiError, FormValues>({
    mutationFn: async (values) => {
      const tokens = await authApi.register(values);
      // If the backend returns tokens on register, set the session immediately.
      // The Guard will resolve the correct next step (verify-email or onboarding)
      // based on the /me response.
      if (tokens?.accessToken) {
        setSession(tokens.accessToken, tokens.refreshToken);
      } else {
        // Tokens absent — route to password screen to let them sign in.
        router.replace({
          pathname: "/(auth)/password",
          params: { email: values.email },
        });
      }
    },
    onError: (err) => {
      console.error("Sign up failed:", err);
      Alert.alert("Sign up failed", err.message ?? "Try again");
    },
  });

  function submit() {
    Keyboard.dismiss();
    handleSubmit((v) => mutation.mutate(v))();
  }

  return (
    <Screen scrollable={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.flex}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
        >
          <View style={s.badge}>
            <Icon xml={Icons.IconEmail} size={32} color={PAL.badgeIcon} />
          </View>

          <View style={s.headerBlock}>
            <Text style={s.title}>Create account</Text>
            <Text style={s.subtitle}>
              Receive crypto, get NGN in your bank.
            </Text>
          </View>

          <View style={s.formFields}>
            <View style={s.row}>
              <View style={s.rowCell}>
                <Controller
                  control={control}
                  name="firstName"
                  render={({ field, fieldState }) => (
                    <FormField
                      label="First name"
                      placeholder="Ada"
                      value={field.value}
                      onChangeText={field.onChange}
                      error={fieldState.error?.message}
                      autoCapitalize="words"
                      textContentType="givenName"
                    />
                  )}
                />
              </View>
              <View style={s.rowCell}>
                <Controller
                  control={control}
                  name="lastName"
                  render={({ field, fieldState }) => (
                    <FormField
                      label="Last name"
                      placeholder="Okafor"
                      value={field.value}
                      onChangeText={field.onChange}
                      error={fieldState.error?.message}
                      autoCapitalize="words"
                      textContentType="familyName"
                    />
                  )}
                />
              </View>
            </View>

            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <FormField
                  label="Email"
                  placeholder="you@example.com"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <PasswordField
                  label="Password"
                  placeholder="At least 8 characters"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  hint="8+ characters, 1 letter, 1 number"
                />
              )}
            />
          </View>

          <Button
            label="Create account"
            onPress={submit}
            loading={mutation.isPending}
            disabled={!formState.isValid || mutation.isPending}
          />

          <View style={{ flex: 1, minHeight: 40 }} />

          <View style={s.signinRow}>
            <Text style={s.signinHint}>Already have an account? </Text>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable hitSlop={6}>
                <Text style={s.signinLink}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

interface FormFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  keyboardType?: "default" | "email-address" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "off" | "email" | "password" | "name";
  textContentType?:
    | "emailAddress"
    | "password"
    | "newPassword"
    | "givenName"
    | "familyName"
    | "name"
    | "none";
  secureTextEntry?: boolean;
  rightSlot?: React.ReactNode;
}

function FormField(props: FormFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>
        {props.label}
        {props.required ? <Text style={s.required}> *</Text> : null}
      </Text>
      <View style={[s.control, focused && { borderColor: PAL.fieldFocus }]}>
        <TextInput
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          placeholderTextColor={PAL.textSubtle}
          keyboardType={props.keyboardType ?? "default"}
          autoCapitalize={props.autoCapitalize ?? "sentences"}
          autoComplete={props.autoComplete ?? "off"}
          textContentType={props.textContentType ?? "none"}
          secureTextEntry={props.secureTextEntry}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCorrect={false}
          spellCheck={false}
          style={s.input}
        />
        {props.rightSlot}
      </View>
      {props.error ? (
        <Text style={s.errorText}>{props.error}</Text>
      ) : props.hint ? (
        <Text style={s.hintText}>{props.hint}</Text>
      ) : null}
    </View>
  );
}

function PasswordField(
  props: Omit<FormFieldProps, "secureTextEntry" | "rightSlot">,
) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      {...props}
      autoCapitalize="none"
      autoComplete="password"
      textContentType="newPassword"
      secureTextEntry={!visible}
      rightSlot={
        <Pressable
          hitSlop={8}
          onPress={() => setVisible((v) => !v)}
          style={s.eyeButton}
        >
          {visible ? (
            <EyeOff size={18} color={PAL.textMuted} />
          ) : (
            <Eye size={18} color={PAL.textMuted} />
          )}
        </Pressable>
      }
    />
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    // justifyContent: 'center',
    gap: 24,
    paddingVertical: 24,
  },
  headerBlock: {
    gap: 6,
  },
  title: {
    fontFamily: "BricolageGrotesque-Bold",
    fontSize: 28,
    lineHeight: 32,
    color: PAL.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: "BricolageGrotesque-Regular",
    fontSize: 14,
    lineHeight: 19,
    color: PAL.textMuted,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: PAL.cardBorder,
    backgroundColor: PAL.cardBg,
    padding: 16,
    gap: 16,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  formFields: {
    gap: 16,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PAL.badgeBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  rowCell: {
    flex: 1,
  },
  field: {
    gap: 8,
  },
  label: {
    fontFamily: "BricolageGrotesque-SemiBold",
    fontSize: 14,
    color: PAL.text,
  },
  required: {
    color: PAL.required,
  },
  control: {
    height: 52,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: PAL.fieldBg,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    fontFamily: "BricolageGrotesque-Medium",
    fontSize: 15,
    color: PAL.textValue,
    padding: 0,
  },
  eyeButton: {
    paddingLeft: 10,
    paddingVertical: 4,
  },
  errorText: {
    fontFamily: "BricolageGrotesque-Regular",
    fontSize: 12,
    color: PAL.required,
  },
  hintText: {
    fontFamily: "BricolageGrotesque-Regular",
    fontSize: 12,
    color: PAL.textMuted,
  },
  signinRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
  },
  signinHint: {
    fontFamily: "BricolageGrotesque-Regular",
    fontSize: 14,
    color: PAL.textMuted,
  },
  signinLink: {
    fontFamily: "BricolageGrotesque-SemiBold",
    fontSize: 14,
    color: PAL.brand,
  },
});
