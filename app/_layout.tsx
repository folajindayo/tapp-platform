import '../global.css';
import '@/ui/loadStyles';

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  OpenSans_400Regular,
  OpenSans_500Medium,
  OpenSans_600SemiBold,
  OpenSans_700Bold,
} from '@expo-google-fonts/open-sans';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/auth/store';
import { useOnboardingState, type OnboardingStep } from '@/auth/useOnboardingState';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'BricolageGrotesque-Regular':  BricolageGrotesque_400Regular,
    'BricolageGrotesque-Medium':   BricolageGrotesque_500Medium,
    'BricolageGrotesque-SemiBold': BricolageGrotesque_600SemiBold,
    'BricolageGrotesque-Bold':     BricolageGrotesque_700Bold,
    'OpenSans-Regular':            OpenSans_400Regular,
    'OpenSans-Medium':             OpenSans_500Medium,
    'OpenSans-SemiBold':           OpenSans_600SemiBold,
    'OpenSans-Bold':               OpenSans_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <Guard />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

function Guard() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const segments = useSegments();
  const router = useRouter();
  const { step, loading } = useOnboardingState();

  const ready = isHydrated && !loading;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!isHydrated || loading) return;

    const target = targetForStep(step);
    const seg0 = (segments[0] ?? '') as string;
    const seg1 = (segments[1] ?? '') as string;

    const currentGroup =
      seg0 === '(auth)' ? 'auth'
      : seg0 === '(onboarding)' ? 'onboarding'
      : seg0 === '(app)' ? 'app'
      : 'none';

    // ── Allow free navigation within the unauthenticated sign-in flow ──
    // sign-in → password → sign-up → forgot-password are all valid to visit
    // when target is sign-in; don't redirect mid-flow.
    const signInScreens = new Set(['sign-in', 'password', 'sign-up', 'forgot-password', 'reset-password']);
    if (step === 'sign-in' && currentGroup === 'auth' && signInScreens.has(seg1)) return;

    // ── Allow verify-email only when that is the resolved target ──
    if (step === 'verify-email' && currentGroup === 'auth' && seg1 === 'verify-email') return;

    // ── Allow free navigation within the onboarding group ──
    if (target.group === 'onboarding' && currentGroup === 'onboarding') return;

    // ── Already on the right screen ──
    if (target.group === currentGroup) return;

    router.replace(target.route as never);
  }, [step, loading, segments, router, isHydrated]);

  return (
    <View style={{ flex: 1 }}>
      <Slot />
      {!ready && <LoadingOverlay />}
    </View>
  );
}

function LoadingOverlay() {
  return (
    <View style={styles.loadingRoot} pointerEvents="none">
      <View style={styles.loadingInner}>
        <View style={styles.loadingBadge}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
        <View style={styles.loadingDots}>
          <View style={[styles.dot, { opacity: 1 }]} />
          <View style={[styles.dot, { opacity: 0.5 }]} />
          <View style={[styles.dot, { opacity: 0.25 }]} />
        </View>
      </View>
    </View>
  );
}

function targetForStep(step: OnboardingStep): { group: string; route: string } {
  switch (step) {
    case 'sign-in':
      return { group: 'auth', route: '/(auth)/sign-in' };
    case 'verify-email':
      return { group: 'auth', route: '/(auth)/verify-email' };
    case 'kyb':
      return { group: 'onboarding', route: '/(onboarding)/kyb' };
    case 'bank-account':
      return { group: 'onboarding', route: '/(onboarding)/bank-account' };
    case 'live':
      return { group: 'app', route: '/(app)' };
  }
}

const styles = StyleSheet.create({
  loadingRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0D0D0D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingInner: {
    alignItems: 'center',
    gap: 32,
  },
  loadingBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },
});
