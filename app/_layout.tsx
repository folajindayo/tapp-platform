import '../global.css';

import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot, Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/auth/store';
import { useOnboardingState, type OnboardingStep } from '@/auth/useOnboardingState';

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
  // Hydrate auth state from MMKV exactly once on app start.
  useEffect(() => {
    useAuthStore.getState().rehydrate();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <Guard />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

/**
 * Drives the routing guard: redirects the user to the right onboarding step
 * (or to the app tabs) whenever the resolved state changes.
 */
function Guard() {
  const segments = useSegments();
  const router = useRouter();
  const { step, loading } = useOnboardingState();

  useEffect(() => {
    if (loading) return;
    const target = targetRouteForStep(step);
    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    const inApp = segments[0] === '(app)';
    const currentGroup = inAuth ? 'auth' : inOnboarding ? 'onboarding' : inApp ? 'app' : 'none';
    if (target.group !== currentGroup || (target.route && segments.join('/') !== target.routeFull)) {
      router.replace(target.routeFull as never);
    }
  }, [step, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Slot />
    </Stack>
  );
}

function targetRouteForStep(step: OnboardingStep): {
  group: 'auth' | 'onboarding' | 'app';
  route: string;
  routeFull: string;
} {
  switch (step) {
    case 'sign-in':
      return { group: 'auth', route: 'sign-in', routeFull: '/(auth)/sign-in' };
    case 'verify-email':
      return { group: 'auth', route: 'verify-email', routeFull: '/(auth)/verify-email' };
    case 'kyb':
      return { group: 'onboarding', route: 'kyb', routeFull: '/(onboarding)/kyb' };
    case 'bank-account':
      return { group: 'onboarding', route: 'bank-account', routeFull: '/(onboarding)/bank-account' };
    case 'live':
      return { group: 'app', route: 'index', routeFull: '/(app)' };
  }
}
