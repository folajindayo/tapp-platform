import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react-native';
import { authApi } from '@/api/endpoints';
import { useAuthStore } from '@/auth/store';
import { Button, Icon, Icons, Text } from '@/ui';
import { EarlyAccessModal } from '@/components/EarlyAccessModal';

const CODE_LEN = 6;

const PAL = {
  bg:         '#0D0D0D',
  badgeBg:    'rgba(255, 255, 255, 0.08)',
  badgeIcon:  'rgba(255, 255, 255, 0.65)',
  text:       '#FFFFFF',
  textMuted:  'rgba(255, 255, 255, 0.55)',
  textSubtle: 'rgba(255, 255, 255, 0.35)',
  inputBg:    'rgba(255, 255, 255, 0.06)',
  inputText:  '#FFFFFF',
  button:     '#3B82F6',
  buttonText: '#FFFFFF',
  required:   '#F43F5E',
} as const;

export default function VerifyEmailScreen() {
  const { email: paramEmail, password } = useLocalSearchParams<{
    email?: string;
    password?: string;
  }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const storeEmail = useAuthStore((s) => s.user?.email);

  // Email is available from the auth store for authenticated users (signed in
  // via password), or from route params for unauthenticated users (just
  // registered but email not yet verified).
  const email = storeEmail ?? paramEmail ?? '';

  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [earlyAccessVisible, setEarlyAccessVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === CODE_LEN) {
      Keyboard.dismiss();
      void submit(code);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function submit(token: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Rails requires both fields — the (token, email) pair scopes the
      // verification row uniquely so codes can't collide across users.
      if (!email) {
        Alert.alert('Email missing', 'Please go back and re-enter your email.');
        return;
      }
      await authApi.confirmAccount({ token, email });

      if (isAuthenticated) {
        // Authenticated path: invalidate /me so the Guard sees the updated
        // is_email_verified flag and advances to the next onboarding step.
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      } else if (password) {
        // Unauthenticated path with password: login automatically!
        try {
          const loginData = await authApi.login({ email, password });
          useAuthStore.getState().setSession(loginData.accessToken, loginData.refreshToken);
        } catch (loginErr) {
          const msg = ((loginErr as any)?.message ?? '').toLowerCase();
          if (msg.includes('early access request is still pending') || msg.includes('early access')) {
            setEarlyAccessVisible(true);
          } else {
            // Fallback to password screen if login fails for some reason
            router.replace({
              pathname: '/(auth)/password',
              params: { email, verified: 'true' },
            });
          }
        }
      } else {
        // Unauthenticated path: user registered but couldn't log in until now.
        // Show the early access pending modal.
        setEarlyAccessVisible(true);
      }
    } catch (err) {
      Alert.alert('Invalid code', (err as { message?: string })?.message ?? 'Try again');
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!email || cooldown > 0 || resending) return;
    setResending(true);
    try {
      await authApi.resendToken({ email, scope: 'emailVerification' });
      setCooldown(60);
      Alert.alert('Sent', 'We sent a new code to your email.');
    } catch (err) {
      Alert.alert('Could not resend', (err as { message?: string })?.message ?? 'Try again');
    } finally {
      setResending(false);
    }
  }

  const handleBack = () => {
    Keyboard.dismiss();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(auth)/sign-up');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={s.root}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable hitSlop={10} onPress={handleBack} style={s.backRow}>
          <ChevronLeft size={20} color={PAL.textMuted} />
          <Text style={s.backText}>Back</Text>
        </Pressable>

        <View style={s.badge}>
          <Icon xml={Icons.IconEmail} size={32} color={PAL.badgeIcon} />
        </View>

        <Text style={s.title}>Check your email</Text>
        <Text style={s.subtitle}>
          We sent a 6-digit code to <Text style={s.emailHighlight}>{email || 'your email'}</Text>.
        </Text>

        <View style={s.otpContainer}>
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, CODE_LEN))}
            keyboardType="number-pad"
            maxLength={CODE_LEN}
            autoFocus
            caretHidden
            selectionColor="transparent"
            style={s.hiddenInput}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
          />
          {Array.from({ length: CODE_LEN }).map((_, idx) => {
            const char = code[idx] || '';
            const isFocused = code.length === idx;
            const isFilled = code.length > idx;
            return (
              <View
                pointerEvents="none"
                key={idx}
                style={[
                  s.otpBox,
                  isFocused && s.otpBoxFocused,
                  isFilled && s.otpBoxFilled,
                ]}
              >
                <Text style={s.otpText}>{char}</Text>
              </View>
            );
          })}
        </View>

        <View style={{ flex: 1, minHeight: 40 }} />

        <View style={s.buttonWrap}>
          <Button
            label="Verify"
            onPress={() => submit(code)}
            loading={submitting}
            disabled={code.length < CODE_LEN || submitting}
            className="rounded-[16px]"
          />
        </View>

        <Pressable
          hitSlop={8}
          onPress={resend}
          disabled={cooldown > 0 || resending}
          style={s.resendRow}
        >
          <Text style={[s.resendText, cooldown > 0 ? { color: PAL.textSubtle } : null]}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </Text>
        </Pressable>
      </ScrollView>
      <EarlyAccessModal
        visible={earlyAccessVisible}
        title="Email Verified!"
        description="Your email has been verified, but your early access request is still pending. Please reach out to an admin on Telegram to get your account approved."
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 36,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  backText: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 15,
    color: PAL.textMuted,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PAL.badgeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'BricolageGrotesque-Bold',
    fontSize: 28,
    lineHeight: 34,
    color: PAL.text,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 15,
    lineHeight: 20,
    color: PAL.textMuted,
    marginBottom: 24,
  },
  emailHighlight: {
    fontFamily: 'BricolageGrotesque-Medium',
    color: PAL.text,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    height: 48,
    position: 'relative',
    marginBottom: 24,
  },
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.01,
    color: 'transparent',
    backgroundColor: 'transparent',
  },
  otpBox: {
    width: 44,
    height: 48,
    borderBottomWidth: 2,
    borderBottomColor: PAL.textSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxFocused: {
    borderBottomColor: PAL.button,
  },
  otpBoxFilled: {
    borderBottomColor: PAL.text,
  },
  otpText: {
    fontFamily: 'BricolageGrotesque-Bold',
    fontSize: 22,
    color: PAL.text,
  },
  buttonWrap: {
    width: '100%',
  },
  resendRow: {
    alignSelf: 'center',
    marginTop: 20,
  },
  resendText: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 14,
    color: PAL.textMuted,
  },
});
