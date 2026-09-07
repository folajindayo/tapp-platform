// useTapCard — orchestrates the Tap Card flow end-to-end.
//
// Two-tap UX (same on Android + iOS for consistency and because iOS's
// system NFC modal blocks our UI between read and write):
//
//   Tap 1 (read):
//     - NfcA session open → PWD_AUTH with the per-tap password from
//       the cardholder's PWA-set state (TODO: pre-fetch from server)
//     - read K (32 bytes) from pages 4-11
//     - read current rotation-token NDEF record
//     - close session
//     - sha256(UID) → card_uid_hash
//     - GET /tap-card/nonce → tier + server_nonce
//
//   Branch on tier:
//     - none    → POST /tap-card immediately (no auth)
//     - pin     → render PIN pad; on submit, compute HMAC and POST
//     - step_up → render step-up QR; poll; on grant, POST
//
//   Tap 2 (write):
//     - NfcA session open → PWD_AUTH with the new per-tap password
//       the server returned in /tap-card response
//     - write the new_card_token NDEF record
//     - POST /token-ack { written: true }
//     - on write failure → rescue UX "tap once more"
//
// All sensitive intermediates (K, current_token, computed pin_response)
// stay in a ref and are zeroed after use.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { router } from 'expo-router';
import { sha256 } from '@noble/hashes/sha2';
import { CHECKOUT_BASE_URL } from '@/api/config';
import { merchantApi } from '@/api/endpoints';
import type { TapCardDebitResponse, TapCardTier } from '@/api/types';
import { readCardPayload, writeCardPayload } from '@/hce/NfcCardIO';
import { bytesToHex, computePinResponse, hexToBytes } from './pinHmac';

export type TapCardPhase =
  | { kind: 'scanning' }
  | { kind: 'reading' }
  | { kind: 'resolving' }
  | { kind: 'charging-none' }
  | { kind: 'pin-required'; serverNonce: string }
  | { kind: 'charging-pin' }
  | { kind: 'step-up-required'; stepUpUrl: string; stepUpToken: string }
  | { kind: 'step-up-polling'; stepUpToken: string }
  | { kind: 'charging-step-up' }
  | { kind: 'writing'; response: TapCardDebitResponse }
  | { kind: 'write-retry'; response: TapCardDebitResponse; error: string }
  | { kind: 'settled'; response: TapCardDebitResponse }
  | { kind: 'processing'; response: TapCardDebitResponse }
  | { kind: 'failed'; error: string; code?: string };

interface UseTapCardArgs {
  amount: string;
  currency?: string;
  memo?: string;
  enabled?: boolean;
}

interface SessionState {
  K: Uint8Array | null;
  currentTokenHex: string;
  cardUidHash: string;
  serverNonce: string;
  cardPassword: string; // set during read; rotated server-side per debit
}

/**
 * Where the cardholder approves a large payment.
 *
 * Built here rather than returned by the server. The server does not know
 * which cardholder app this merchant's customers use, and having it hand back
 * a URL meant the deployment's PWA address was baked into an API response --
 * so pointing the two at different environments produced a QR code leading
 * somewhere the customer could not sign in.
 */
function stepUpUrlFor(reference: string): string {
  return `${CHECKOUT_BASE_URL}/cards/step-up?token=${encodeURIComponent(reference)}`;
}

export function useTapCard({ amount, currency = 'NGN', memo, enabled = true }: UseTapCardArgs) {
  const [phase, setPhase] = useState<TapCardPhase>({ kind: 'scanning' });
  const sessionRef = useRef<SessionState>({
    K: null,
    currentTokenHex: '',
    cardUidHash: '',
    serverNonce: '',
    cardPassword: '',
  });
  const cancelledRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Read flow (tap 1)
  // ---------------------------------------------------------------------------
  const beginRead = useCallback(async () => {
    setPhase({ kind: 'reading' });
    try {
      if (!(await NfcManager.isSupported())) {
        setPhase({ kind: 'failed', error: 'NFC is not supported on this device.' });
        return;
      }
      await NfcManager.start();

      const techOptions =
        Platform.OS === 'ios'
          ? { alertMessage: 'Hold the card to the top of your iPhone', invalidateAfterFirstRead: true }
          : undefined;
      await NfcManager.requestTechnology(NfcTech.NfcA, techOptions);

      const tag = await NfcManager.getTag();
      const uidHex = (tag?.id ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
      if (!uidHex) {
        setPhase({ kind: 'failed', error: 'Could not read card UID.' });
        return;
      }

      // PoC: card_password fetched per-card during linking and stored
      // server-side. For v1 we read it lazily via the existing /me
      // endpoint — wire that here when the linking flow lands.
      // For now we DO have an issue: without PWD_AUTH we can't read K.
      // Surface a clear error rather than pretending.
      //
      // TODO(post-poc): fetch card_password from a per-card record we
      // populate during PWA-side linking.
      let K: Uint8Array;
      let currentTokenBytes: Uint8Array;
      try {
        // The PWA writes one NDEF record: K(32) ‖ rotationToken(32) = 64 bytes.
        // No PWD — the card is provisioned over Web NFC which can't set one.
        // Split it: K drives the PIN response, the token is what we send +
        // the server matches against.
        const payload = await readCardPayload();
        if (payload.length < 64) {
          throw new Error('Unexpected card payload length');
        }
        K = payload.slice(0, 32);
        currentTokenBytes = payload.slice(32, 64);
      } catch {
        setPhase({
          kind: 'failed',
          code: 'card_locked',
          error: 'Card needs to be linked first. Open Zoracle on the cardholder\'s phone.',
        });
        return;
      }

      const uidBytes = hexToBytes(uidHex);
      const cardUidHash = bytesToHex(sha256(uidBytes));
      const currentTokenHex = bytesToHex(currentTokenBytes);

      sessionRef.current = {
        K,
        currentTokenHex,
        cardUidHash,
        serverNonce: '',
        cardPassword: '',
      };

      // Close NFC before showing the PIN pad — iOS modals would block us
      // and Android UX is cleaner with the tap explicitly separated
      // from the typing.
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);

      // Resolve the tier.
      setPhase({ kind: 'resolving' });
      const nonceResp = await merchantApi.tapCardNonce({
        amount,
        card_uid_hash: cardUidHash,
      });
      sessionRef.current.serverNonce = nonceResp.server_nonce;

      switch (nonceResp.tier) {
        case 'none':
          await doDebit(undefined, undefined);
          return;
        case 'pin':
          setPhase({ kind: 'pin-required', serverNonce: nonceResp.server_nonce });
          return;
        case 'step_up':
          if (!nonceResp.step_up_ref) {
            setPhase({ kind: 'failed', error: 'The server did not return an approval reference.' });
            return;
          }
          setPhase({
            kind: 'step-up-required',
            stepUpUrl: stepUpUrlFor(nonceResp.step_up_ref),
            stepUpToken: nonceResp.step_up_ref,
          });
          return;
        default:
          setPhase({ kind: 'failed', error: `Unknown tier: ${nonceResp.tier satisfies TapCardTier}` });
      }
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      const msg = (err as { message?: string })?.message ?? 'Could not read card';
      setPhase({ kind: 'failed', error: msg });
    } finally {
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    }
    // doDebit + writeRotation are stable in this closure scope by design;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  // ---------------------------------------------------------------------------
  // Debit submission (one of three entry points: none / pin / step-up)
  // ---------------------------------------------------------------------------
  const doDebit = useCallback(
    async (pinResponseHex: string | undefined, stepUpToken: string | undefined) => {
      const s = sessionRef.current;
      const chargingPhase: TapCardPhase = pinResponseHex
        ? { kind: 'charging-pin' }
        : stepUpToken
          ? { kind: 'charging-step-up' }
          : { kind: 'charging-none' };
      setPhase(chargingPhase);
      try {
        const resp = await merchantApi.tapCardDebit({
          card_uid_hash: s.cardUidHash,
          card_token:    s.currentTokenHex,
          amount,
          currency,
          server_nonce:  s.serverNonce,
          pin_response:  pinResponseHex,
          step_up_ref:   stepUpToken,
        });
        // Tap 2: write the new token back.
        //
        // No intermediate "processing" state any more. The debit either
        // charged the cardholder or it did not, and it commits before
        // answering -- the previous response could say "settled" for a Base
        // card while no money had moved at all.
        setPhase({ kind: 'writing', response: resp });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        setPhase({ kind: 'failed', code: e.code, error: e.message ?? 'Debit failed' });
      }
    },
    [amount, currency, memo],
  );

  // Called by the PIN pad after the 4th digit lands.
  const submitPin = useCallback(
    async (pin: string) => {
      const s = sessionRef.current;
      if (!s.K) {
        setPhase({ kind: 'failed', error: 'Card session expired — start over.' });
        return;
      }
      const nonceBytes = hexToBytes(s.serverNonce);
      const pinResp = computePinResponse(s.K, pin, nonceBytes);
      // Wipe K from the session immediately after use; only the
      // computed response leaves this device.
      s.K.fill(0);
      s.K = null;
      await doDebit(pinResp, undefined);
    },
    [doDebit],
  );

  // Called by the step-up QR component once polling reports `granted`.
  const submitStepUp = useCallback(
    async (stepUpToken: string) => {
      await doDebit(undefined, stepUpToken);
    },
    [doDebit],
  );

  // ---------------------------------------------------------------------------
  // Write-back (tap 2)
  // ---------------------------------------------------------------------------
  const performWrite = useCallback(async () => {
    if (phase.kind !== 'writing' && phase.kind !== 'write-retry') return;
    const resp = phase.response;
    try {
      // Write-back must use the Ndef technology — ndefHandler.writeNdefMessage
      // can't run on a raw NfcA session (android.nfc.tech.NfcA cannot be cast
      // to android.nfc.tech.Ndef). getTag() still returns the cached NDEF
      // message under Ndef, so the K re-read below works too.
      await NfcManager.requestTechnology(
        NfcTech.Ndef,
        Platform.OS === 'ios'
          ? { alertMessage: 'Hold the card again to finalize', invalidateAfterFirstRead: true }
          : undefined,
      );
      // Preserve K: re-read the current payload (K ‖ oldToken), keep K, and
      // write K ‖ newToken. The backend's new_card_token is just the 32-byte
      // rotation token; K never leaves the card so we splice it back in.
      const existing = await readCardPayload();
      const K = existing.slice(0, 32);
      const newToken = hexToBytes(resp.new_card_token);
      const newPayload = new Uint8Array(64);
      newPayload.set(K, 0);
      newPayload.set(newToken, 32);
      await writeCardPayload(newPayload);
      await merchantApi.tapCardTokenAck(resp.tap_id, { written: true });
      setPhase({ kind: 'settled', response: resp });
    } catch (err) {
      // Best-effort ack — server keeps the previous token valid for
      // the cardholder's next PWA-driven resync.
      void merchantApi
        .tapCardTokenAck(resp.tap_id, { written: false })
        .catch(() => undefined);
      setPhase({
        kind: 'write-retry',
        response: resp,
        error: (err as { message?: string }).message ?? 'Could not write to card.',
      });
    } finally {
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    }
  }, [phase]);

  // Auto-prompt the write-back as soon as we transition into 'writing'.
  // The user sees "Tap once more to finalize" and we open the NFC tech
  // immediately so the next tap lands.
  useEffect(() => {
    if (phase.kind === 'writing') {
      void performWrite();
    }
  }, [phase.kind, performWrite]);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (enabled) {
      cancelledRef.current = false;
      setPhase({ kind: 'scanning' });
      void beginRead();
    } else {
      cancelledRef.current = true;
      void NfcManager.cancelTechnologyRequest().catch(() => undefined);
      const s = sessionRef.current;
      if (s.K) {
        s.K.fill(0);
        s.K = null;
      }
    }
    return () => {
      cancelledRef.current = true;
      void NfcManager.cancelTechnologyRequest().catch(() => undefined);
      // Final wipe in case the user navigates away mid-flow.
      const s = sessionRef.current;
      if (s.K) {
        s.K.fill(0);
        s.K = null;
      }
    };
  }, [beginRead, enabled]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    void NfcManager.cancelTechnologyRequest().catch(() => undefined);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const retry = useCallback(() => {
    cancelledRef.current = false;
    void beginRead();
  }, [beginRead]);

  const retryWrite = useCallback(() => {
    if (phase.kind === 'write-retry') {
      setPhase({ kind: 'writing', response: phase.response });
    }
  }, [phase]);

  return { phase, submitPin, submitStepUp, cancel, retry, retryWrite };
}
