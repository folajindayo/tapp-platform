// Auth state held in zustand, hydrated from the secure-store-backed
// MMKV instance on startup. Persistence is the source of truth; the
// store mirrors it for React's render path.

import { create } from 'zustand';
import { authApi } from '@/api/endpoints';
import { clearAuth, getAccessToken, getRefreshToken, getUser, initStorage, setTokens } from '@/api/storage';

interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isHydrated: boolean;
  user: AuthUser | null;
  setSession: (access: string, refresh: string, user?: AuthUser) => void;
  setUser: (user: AuthUser | null) => void;
  signOut: () => void;
  /** Hydrates the encrypted MMKV instance from secure-store, then mirrors
   *  the persisted session into React state. Idempotent. Call once on
   *  app boot, before any protected screen renders. */
  hydrate: () => Promise<void>;
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
  setUser: (user) => {
    if (__DEV__) console.log('[auth] setUser — user:', user);
    const access = getAccessToken() ?? '';
    const refresh = getRefreshToken() ?? '';
    setTokens(access, refresh, user ?? undefined);
    set({ user: user ?? null });
  },
  signOut: () => {
    // Fire-and-forget server revocation. We don't block on it — the
    // client-side clear MUST happen even if the network call fails
    // (e.g. offline). Worst case, the refresh sits on the server until
    // its TTL elapses; it's useless without the access token.
    const refresh = getRefreshToken();
    void authApi.logout(refresh).catch(() => {});
    clearAuth();
    set({ isAuthenticated: false, user: null });
  },
  hydrate: async () => {
    await initStorage();
    const token = getAccessToken();
    const user = getUser();
    set({ isAuthenticated: !!token, user: user ?? null, isHydrated: true });
  },
}));
