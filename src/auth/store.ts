// Auth state held in zustand, hydrated from MMKV on startup.
// This is intentionally thin: persistence is the source of truth (MMKV);
// the store mirrors it for React's render path.

import { create } from 'zustand';
import { clearAuth, getAccessToken, getUser, setTokens } from '@/api/storage';

interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isHydrated: boolean;
  user: AuthUser | null;
  setSession: (access: string, refresh: string, user?: AuthUser) => void;
  signOut: () => void;
  rehydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isHydrated: false,
  user: null,
  setSession: (access, refresh, user) => {
    if (__DEV__) console.log('[auth] setSession — access:', access ? `${access.slice(0, 12)}…` : 'MISSING', '| user:', user);
    setTokens(access, refresh, user);
    set({ isAuthenticated: true, user: user ?? null });
  },
  signOut: () => {
    clearAuth();
    set({ isAuthenticated: false, user: null });
  },
  rehydrate: () => {
    const token = getAccessToken();
    const user = getUser();
    // user may not be stored (API doesn't always return it); token alone is
    // sufficient to consider the session active — /v1/me will fetch fresh state.
    set({ isAuthenticated: !!token, user: user ?? null, isHydrated: true });
  },
}));

// MMKV reads are synchronous — hydrate before the first React render so
// queries never fire with a missing token on cold start.
useAuthStore.getState().rehydrate();
