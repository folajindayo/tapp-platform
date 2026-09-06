import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authApi, merchantApi } from '@/api/endpoints';
import { useAuthStore } from './store';

export type OnboardingStep =
  | 'sign-in'      // not authenticated
  | 'verify-email' // authenticated, email not verified
  | 'kyb'          // authenticated + email verified, KYC not complete
  | 'bank-account' // authenticated + email verified + KYC done, no bank account
  | 'live';        // fully onboarded

export interface OnboardingState {
  step: OnboardingStep;
  loading: boolean;
}

export function useOnboardingState(): OnboardingState {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: 1,
  });

  const me = meQuery.data;
  // const kycDone = me?.kyc_status === 'success';

  useEffect(() => {
    if (me) {
      const storeUser = useAuthStore.getState().user;
      if (!storeUser || storeUser.id !== me.id || storeUser.email !== me.email) {
        useAuthStore.getState().setUser({
          id: me.id,
          email: me.email,
        });
      }
    }
  }, [me]);

  // Fetch bank account as soon as email is verified — KYC and bank-account
  // setup can proceed in parallel from the user's perspective.
  const bankQuery = useQuery({
    queryKey: ['merchant', 'bank-account'],
    queryFn: merchantApi.getBankAccount,
    enabled: isAuthenticated && !!me && me.is_email_verified,
    staleTime: 30_000,
    retry: (_, error) => {
      const code = (error as { code?: string })?.code;
      return code !== 'HTTP_404' && code !== 'HTTP_401';
    },
  });

  if (__DEV__) {
    console.log('[useOnboardingState] meQuery — data:', meQuery.data, '| error:', meQuery.error, '| isLoading:', meQuery.isLoading);
    console.log('[useOnboardingState] bankQuery — data:', bankQuery.data, '| error:', bankQuery.error, '| isLoading:', bankQuery.isLoading);
  }

  if (!isAuthenticated) return { step: 'sign-in', loading: false };
  if (meQuery.isLoading) return { step: 'sign-in', loading: true };

  const user = meQuery.data;
  if (!user) return { step: 'sign-in', loading: false };

  if (!user.is_email_verified) return { step: 'verify-email', loading: false };

  if (bankQuery.isLoading) return { step: 'bank-account', loading: true };

  // A saved bank account means onboarding is complete regardless of KYC state.
  if (bankQuery.data) return { step: 'live', loading: false };

  // No bank account yet — show kyb first so the user completes identity
  // verification before setting up payouts.
  // KYC is temporarily bypassed from the onboarding flow:
  // if (!kycDone) return { step: 'kyb', loading: false };

  return { step: 'bank-account', loading: false };
}
