import { MMKV } from 'react-native-mmkv';

// Encrypted MMKV storage for JWT + lightweight auth state.
// Pass-phrase is a build-time constant — adequate for v1; v2 should
// wrap with Android Keystore / iOS Keychain via expo-secure-store.
export const storage = new MMKV({
  id: 'tapp-merchant-auth',
  encryptionKey: 'tapp-merchant-v0-key',
});

const ACCESS = 'access_token';
const REFRESH = 'refresh_token';
const USER = 'user';

export function getAccessToken(): string | undefined {
  return storage.getString(ACCESS);
}
export function getRefreshToken(): string | undefined {
  return storage.getString(REFRESH);
}
export function getUser(): { id: string; email: string } | undefined {
  const raw = storage.getString(USER);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as { id: string; email: string };
  } catch {
    return undefined;
  }
}

export function setTokens(access: string, refresh: string, user: { id: string; email: string }) {
  storage.set(ACCESS, access);
  storage.set(REFRESH, refresh);
  storage.set(USER, JSON.stringify(user));
}

export function clearAuth() {
  storage.delete(ACCESS);
  storage.delete(REFRESH);
  storage.delete(USER);
}
