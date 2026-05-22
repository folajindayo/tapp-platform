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
  user: AuthUser | null;
  setSession: (access: string, refresh: string, user: AuthUser) => void;
  signOut: () => void;
  rehydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  setSession: (access, refresh, user) => {
    setTokens(access, refresh, user);
    set({ isAuthenticated: true, user });
  },
  signOut: () => {
    clearAuth();
    set({ isAuthenticated: false, user: null });
  },
  rehydrate: () => {
    const token = getAccessToken();
    const user = getUser();
    if (token && user) {
      set({ isAuthenticated: true, user });
    } else {
      set({ isAuthenticated: false, user: null });
    }
  },
}));
