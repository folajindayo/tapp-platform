import '../global.css';
import '@/ui/loadStyles';

import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  OpenSans_400Regular,
  OpenSans_500Medium,
  OpenSans_600SemiBold,
  OpenSans_700Bold,
} from '@expo-google-fonts/open-sans';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/auth/store';
import { useOnboardingState, type OnboardingStep } from '@/auth/useOnboardingState';

// Keep the native splash up until we are ready to show a screen.
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
  // Store is hydrated synchronously at module load (store.ts bottom).
  // Fonts load asynchronously — return null (native splash stays visible) until ready.
  const [fontsLoaded, fontError] = useFonts({
    'OpenSans-Regular':  OpenSans_400Regular,
    'OpenSans-Medium':   OpenSans_500Medium,
    'OpenSans-SemiBold': OpenSans_600SemiBold,
    'OpenSans-Bold':     OpenSans_700Bold,
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

/**
 * Drives routing and controls when the native splash is hidden.
 * Always renders a Stack so Expo Router never sees a non-navigator child.
 */
function Guard() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const segments = useSegments();
  const router = useRouter();
  const { step, loading } = useOnboardingState();

  // Keep the native splash visible until auth state is fully resolved.
  // This IS the loading screen — the user sees it while we check their session.
  useEffect(() => {
    if (isHydrated && !loading) {
      void SplashScreen.hideAsync();
    }
  }, [isHydrated, loading]);

  useEffect(() => {
    if (!isHydrated || loading) return;

    const target = targetRouteForStep(step);
    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    const inApp = segments[0] === '(app)';
    const currentGroup = inAuth ? 'auth' : inOnboarding ? 'onboarding' : inApp ? 'app' : 'none';

    // Allow free navigation within auth and onboarding groups.
    if (target.group === 'auth' && currentGroup === 'auth') return;
    if (target.group === 'onboarding' && currentGroup === 'onboarding') return;

    if (target.group !== currentGroup) {
      router.replace(target.routeFull as never);
    } else if (target.group !== 'auth' && segments.join('/') !== target.routeFull) {
      router.replace(target.routeFull as never);
    }
  }, [step, loading, segments, router, isHydrated]);

  return <Slot />;
}

function targetRouteForStep(step: OnboardingStep): {
  group: 'auth' | 'onboarding' | 'app';
  route: string;
  routeFull: string;
} {
  switch (step) {
    case 'sign-in':
      return { group: 'auth', route: 'sign-in', routeFull: '/(auth)/sign-in' };
    case 'kyb':
      return { group: 'onboarding', route: 'bank-account', routeFull: '/(onboarding)/bank-account' };
    case 'live':
      return { group: 'app', route: 'index', routeFull: '/(app)' };
  }
}
