import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import NfcManager, { NfcEvents, NfcTech } from 'react-native-nfc-manager';
import { router } from 'expo-router';
import { merchantApi } from '@/api/endpoints';
import type { InitiateTapCardResponse } from '@/api/types';

type Phase =
  | { kind: 'starting' }
  | { kind: 'waiting' }
  | { kind: 'reading' }
  | { kind: 'charging'; cardUid: string }
  | { kind: 'settled'; response: InitiateTapCardResponse }
  | { kind: 'processing'; response: InitiateTapCardResponse } // backend stayed async
  | { kind: 'failed'; error: string; code?: string };

const READ_COOLDOWN_MS = 1500;

/**
 * Drives the Tap-Card flow: opens an NFC reader session, captures the
 * 7-byte UID, posts to /v1/sender/me/tap-card, resolves to settled or
 * failed. Caller renders UI based on `phase` and calls `cancel()` to back out.
 */
export function useTapCard(args: { amount: string; memo?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const lastReadRef = useRef<number>(0);
  const cancelledRef = useRef(false);
  const idempotencyRef = useRef(`card-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const start = useCallback(async () => {
    setPhase({ kind: 'starting' });
    try {
      const supported = await NfcManager.isSupported();
      if (!supported) {
        setPhase({ kind: 'failed', error: 'NFC is not supported on this device.' });
        return;
      }
      await NfcManager.start();

      if (Platform.OS === 'android') {
        // Android: arm a NfcTech.NfcA reader and listen for the system's
        // DiscoverTag event from the foreground dispatch.
        await NfcManager.requestTechnology(NfcTech.NfcA);
        const tag = await NfcManager.getTag();
        await handleTag(tag?.id ?? null);
      } else {
        // iOS: open NFCNDEFReaderSession via the library's MifareIOS tech;
        // the OS renders its own NFC sheet.
        setPhase({ kind: 'waiting' });
        await NfcManager.requestTechnology(NfcTech.MifareIOS, {
          alertMessage: 'Hold the card to the top of your iPhone',
          invalidateAfterFirstRead: true,
        });
        const tag = await NfcManager.getTag();
        await handleTag(tag?.id ?? null);
      }
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      const msg = (err as { message?: string })?.message ?? 'Could not read card';
      setPhase({ kind: 'failed', error: msg });
    } finally {
      try {
        await NfcManager.cancelTechnologyRequest();
      } catch {
        // ignore
      }
    }
  }, []);

  const handleTag = useCallback(
    async (rawUid: string | null) => {
      if (cancelledRef.current) return;
      const now = Date.now();
      if (now - lastReadRef.current < READ_COOLDOWN_MS) return;
      lastReadRef.current = now;

      const uid = (rawUid ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
      if (!/^[0-9A-F]{14}$/.test(uid)) {
        setPhase({ kind: 'failed', error: 'Not a Tapp Card.' });
        return;
      }
      setPhase({ kind: 'charging', cardUid: uid });
      try {
        const res = await merchantApi.initiateTapCard(
          { amount: args.amount, card_uid: uid, memo: args.memo },
          idempotencyRef.current,
        );
        if (res.status === 'settled') {
          setPhase({ kind: 'settled', response: res });
        } else {
          setPhase({ kind: 'processing', response: res });
        }
      } catch (err) {
        const e = err as { code?: string; message?: string };
        setPhase({
          kind: 'failed',
          code: e.code,
          error: friendlyMessage(e),
        });
      }
    },
    [args.amount, args.memo],
  );

  useEffect(() => {
    void start();
    return () => {
      cancelledRef.current = true;
      void NfcManager.cancelTechnologyRequest().catch(() => undefined);
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    };
  }, [start]);

  function cancel() {
    cancelledRef.current = true;
    void NfcManager.cancelTechnologyRequest().catch(() => undefined);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function retry() {
    cancelledRef.current = false;
    void start();
  }

  return { phase, cancel, retry };
}

function friendlyMessage(e: { code?: string; message?: string }): string {
  switch (e.code) {
    case 'CARD_NOT_LINKED':
      return 'This card isn’t registered yet. The customer needs to link it at zoracle.com/link.';
    case 'CARD_INSUFFICIENT_BALANCE':
      return 'Card balance is too low for this amount.';
    case 'CARD_DEBIT_AUTHORITY_EXPIRED':
      return 'The card’s authorization expired. The customer needs to re-link it.';
    case 'RATE_UNAVAILABLE':
      return 'Rates unavailable — try again in a moment.';
    default:
      return e.message ?? 'Could not charge the card. Try again.';
  }
}
