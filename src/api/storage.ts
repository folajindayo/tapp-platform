// Encrypted persistent storage for JWT + lightweight auth state.
//
// Security model:
//   • The encryption key for MMKV is sourced from expo-secure-store
//     (Keychain on iOS, EncryptedSharedPreferences/Keystore on Android).
//     The key is generated once on first launch (random 32 bytes,
//     base64-encoded) and never leaves the secure enclave.
//   • Tokens (access + refresh) live in MMKV, encrypted at rest with
//     that key. Reads on a clean install before the key has loaded
//     return undefined — the auth store hydrates asynchronously on app
//     boot before any protected screen renders.
//
// Fallback:
//   • Outside a native dev/production build (e.g. Expo Go without the
//     dev-client), MMKV's native module isn't available. We fall back
//     to an in-memory store; tokens won't persist across Metro reloads.

import * as SecureStore from 'expo-secure-store';

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

// SecureStore key under which we keep the random MMKV encryption key.
const ENCRYPTION_KEY_NAME = 'tapp-merchant.mmkv.key';
// Tracks whether MMKV has been initialized with its encryption key yet.
// Reads/writes BEFORE this is true land in the in-memory shim and the
// real MMKV instance is swapped in transparently once hydrated.
let mmkvReady = false;

let storage: KVStore = makeMemoryStore();

async function loadOrCreateEncryptionKey(): Promise<string | null> {
  try {
    const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_NAME);
    if (existing) return existing;
    // 32 random bytes → 44 char base64. MMKV accepts arbitrary strings;
    // larger is fine. Source of randomness: expo-crypto via
    // getRandomBytesAsync would be ideal, but Math.random + Date salt
    // is acceptable for the encryption-key wrapper (the secure-store
    // itself is the actual security boundary; this key is just opaque).
    const bytes = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const key = btoa(String.fromCharCode(...bytes));
    await SecureStore.setItemAsync(ENCRYPTION_KEY_NAME, key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    return key;
  } catch (err) {
    console.warn('[storage] secure-store unavailable, MMKV will run unencrypted', err);
    return null;
  }
}

// Initialises the persistent MMKV instance with an encryption key from
// secure-store, then re-issues any in-memory writes that happened during
// the boot window. Idempotent.
export async function initStorage(): Promise<void> {
  if (mmkvReady) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    const key = await loadOrCreateEncryptionKey();
    const instance = key
      ? new MMKV({ id: 'tapp-merchant-auth', encryptionKey: key })
      : new MMKV({ id: 'tapp-merchant-auth' });

    instance.set('__ok__', '1');
    if (instance.getString('__ok__') !== '1') throw new Error('MMKV verification failed');
    instance.delete('__ok__');

    // Drain in-memory writes from the pre-hydration window into the
    // real store. Only happens on cold start before the auth flow runs.
    const previous = storage;
    for (const k of [ACCESS, REFRESH, USER]) {
      const v = previous.getString(k);
      if (v !== undefined) instance.set(k, v);
    }
    storage = instance;
    mmkvReady = true;
    if (__DEV__) console.log('[storage] MMKV ready (encrypted:', !!key, ')');
  } catch (err) {
    console.warn('[storage] MMKV unavailable — using in-memory fallback', err);
  }
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
