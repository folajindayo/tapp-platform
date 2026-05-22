// Resolves which onboarding step (if any) the authenticated merchant is on,
// driving the route-guard redirect logic in app/_layout.tsx.

import { useQuery } from '@tanstack/react-query';
import { authApi, merchantApi } from '@/api/endpoints';
import { useAuthStore } from './store';

export type OnboardingStep =
  | 'sign-in' // not authenticated
  | 'verify-email' // authed but email_verified=false
  | 'kyb' // email verified but kyc !== success
  | 'bank-account' // KYC done but no bank account saved
  | 'live'; // good to go

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

  const bankQuery = useQuery({
    queryKey: ['merchant', 'bank-account'],
    queryFn: merchantApi.getBankAccount,
    enabled: isAuthenticated && meQuery.data?.kyc_status === 'success',
    staleTime: 30_000,
    retry: (_, error) => {
      // 404 = not yet set; don't retry
      const code = (error as { code?: string })?.code;
      return code !== 'NOT_FOUND';
    },
  });

  if (!isAuthenticated) {
    return { step: 'sign-in', loading: false };
  }
  if (meQuery.isLoading) return { step: 'sign-in', loading: true };
  const me = meQuery.data;
  if (!me) return { step: 'sign-in', loading: false };

  if (!me.email_verified) return { step: 'verify-email', loading: false };
  if (me.kyc_status !== 'success') return { step: 'kyb', loading: false };

  if (bankQuery.isLoading) return { step: 'bank-account', loading: true };
  const hasBank = !!bankQuery.data?.verified_at;
  if (!hasBank) return { step: 'bank-account', loading: false };

  return { step: 'live', loading: false };
}
