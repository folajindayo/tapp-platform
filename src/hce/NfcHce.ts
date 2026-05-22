// Thin TS facade over the custom Android HCE native module.
// On iOS, all methods are safe no-ops — HCE isn't allowed on Apple platforms.
//
// The Kotlin side lives at `plugins/withNfcHce/android/NfcHceModule.kt` and
// is registered with React Native as the "NfcHce" module name.

import { NativeModules, Platform } from 'react-native';

interface NfcHceNative {
  isHceSupported(): Promise<boolean>;
  start(payloadUrl: string, ttlMs: number): Promise<void>;
  stop(): Promise<void>;
}

const noop: NfcHceNative = {
  isHceSupported: async () => false,
  start: async () => undefined,
  stop: async () => undefined,
};

const native = (NativeModules as Record<string, unknown>)?.['NfcHce'] as
  | NfcHceNative
  | undefined;

export const NfcHce: NfcHceNative =
  Platform.OS === 'android' && native ? native : noop;
