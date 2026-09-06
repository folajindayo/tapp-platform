// "Continue with Email" — step 1 of the auth flow.
// Pattern adapted from the Luma sign-in (Mobbin reference):
// circle icon badge → bold title → muted subtitle → single pill input
// → fixed-bottom rounded Next button. Dark-mode only for v1.
//
// Submitting routes to /(auth)/password with the email as a query param.
// We do NOT pre-check whether the email exists — the password screen
// attempts /login first and routes to sign-up on user-not-found.

import { useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { Button, Icon, Icons, Text } from '@/ui';

const PAL = {
  bg:         '#0D0D0D',
  badgeBg:    'rgba(255, 255, 255, 0.08)',
  badgeIcon:  'rgba(255, 255, 255, 0.65)',
  text:       '#FFFFFF',
  textMuted:  'rgba(255, 255, 255, 0.55)',
  textSubtle: 'rgba(255, 255, 255, 0.35)',
  inputBg:    'rgba(255, 255, 255, 0.06)',
  inputText:  '#FFFFFF',
  // Inline button — always visible. Brand blue, dimmed when disabled.
  button:        '#3B82F6',
  buttonText:    '#FFFFFF',
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInEmailScreen() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = EMAIL_RE.test(email.trim());

  async function next() {
    if (!valid || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    router.push({
      pathname: '/(auth)/password',
      params: { email: email.trim().toLowerCase() },
    });
    setBusy(false);
  }

  return (
    <SafeAreaView edges={['top']} style={s.root}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.badge}>
          <Icon xml={Icons.IconEmail} size={32} color={PAL.badgeIcon} />
        </View>

        <Text style={s.title}>Continue with Email</Text>
        <Text style={s.subtitle}>Sign in with your email.</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email Address"
          placeholderTextColor={PAL.textSubtle}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={next}
          style={s.input}
        />

        <View style={s.buttonWrap}>
          <Button
            label="Continue"
            onPress={next}
            loading={busy}
            disabled={!valid || busy}
            className="rounded-[16px]"
          />
        </View>

        <View style={{ flex: 1, minHeight: 40 }} />

        <View style={s.signupRow}>
          <Text style={s.signupHint}>Don't have an account? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable hitSlop={6}>
              <Text style={s.signupLink}>Sign up</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
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
    paddingTop: 24,
    paddingBottom: 24,
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
  input: {
    height: 56,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: PAL.inputBg,
    color: PAL.inputText,
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 16,
    marginBottom: 24,
  },
  buttonWrap: {
    width: '100%',
  },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginTop: 20,
  },
  signupHint: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 14,
    color: PAL.textMuted,
  },
  signupLink: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 14,
    color: PAL.button,
  },
});
