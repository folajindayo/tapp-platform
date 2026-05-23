import { useQuery } from '@tanstack/react-query';
import { authApi, merchantApi } from '@/api/endpoints';
import { useAuthStore } from './store';

export type OnboardingStep =
  | 'sign-in' // not authenticated
  | 'kyb'     // authenticated, bank account not yet set up
  | 'live';   // authenticated + bank account saved → home/dashboard

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

  // Only run once we know the user is real (me succeeded).
  const bankQuery = useQuery({
    queryKey: ['merchant', 'bank-account'],
    queryFn: merchantApi.getBankAccount,
    enabled: isAuthenticated && meQuery.isSuccess,
    staleTime: 30_000,
    retry: (_, error) => {
      // 404 = no bank account yet; don't retry
      const code = (error as { code?: string })?.code;
      return code !== 'HTTP_404';
    },
  });

  if (!isAuthenticated) return { step: 'sign-in', loading: false };
  if (meQuery.isLoading) return { step: 'sign-in', loading: true };

  const me = meQuery.data;
  if (!me) return { step: 'sign-in', loading: false };

  if (bankQuery.isLoading) return { step: 'kyb', loading: true };

  // A saved bank account = fully onboarded → home
  if (bankQuery.data) return { step: 'live', loading: false };

  return { step: 'kyb', loading: false };
}
