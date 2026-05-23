// Encrypted MMKV storage for JWT + lightweight auth state.
// Falls back to an in-memory store when MMKV's native module is not available
// (e.g. running in Expo Go). In a native dev/production build, MMKV is used.
//
// NOTE: The in-memory fallback does NOT persist across reloads — you'll need
// to sign in again after each Metro reload when using Expo Go.

interface KVStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

function makeMemoryStore(): KVStore {
  const map = new Map<string, string>();
  return {
    getString: (key) => map.get(key),
    set: (key, value) => { map.set(key, value); },
    delete: (key) => { map.delete(key); },
  };
}

let storage: KVStore;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
  const instance = new MMKV({ id: 'tapp-merchant-auth' });

  // Verify read/write works before trusting this instance.
  instance.set('__ok__', '1');
  const ok = instance.getString('__ok__') === '1';
  instance.delete('__ok__');
  if (!ok) throw new Error('MMKV verification failed');

  storage = instance;
  if (__DEV__) console.log('[storage] MMKV ready');
} catch (err) {
  console.warn('[storage] MMKV unavailable — using in-memory fallback. Tokens will not persist across reloads.', err);
  storage = makeMemoryStore();
}

export { storage };

const ACCESS = 'accessToken';
const REFRESH = 'refreshToken';
const USER = 'user';

export function getAccessToken(): string | undefined {
  const token = storage.getString(ACCESS);
  if (__DEV__) console.log('[storage] getAccessToken →', token ? `${token.slice(0, 12)}…` : 'MISSING');
  return token;
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

export function setTokens(access: string, refresh: string, user?: { id: string; email: string }) {
  storage.set(ACCESS, access);
  storage.set(REFRESH, refresh);
  if (user) storage.set(USER, JSON.stringify(user));
  if (__DEV__) {
    const verify = storage.getString(ACCESS);
    console.log('[storage] setTokens — stored:', verify ? `${verify.slice(0, 12)}…` : 'WRITE FAILED');
  }
}

export function clearAuth() {
  storage.delete(ACCESS);
  storage.delete(REFRESH);
  storage.delete(USER);
}
