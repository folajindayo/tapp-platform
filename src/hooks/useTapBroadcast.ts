import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Brightness from 'expo-brightness';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { merchantApi, ordersApi } from '@/api/endpoints';
import { subscribePayments } from '@/api/sse';
import { NfcHce } from '@/hce/NfcHce';
import type { InitiateTapResponse } from '@/api/types';

type Phase =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'broadcasting'; order: InitiateTapResponse; remainingMs: number }
  | { kind: 'detected'; order: InitiateTapResponse }
  | { kind: 'settled'; order: InitiateTapResponse; fiat_amount: string; tx_hash: string }
  | { kind: 'failed'; error: string };

/**
 * Encapsulates the phone-to-phone broadcast lifecycle:
 *   1. POST /v1/sender/me/tap to create the order
 *   2. Start HCE (Android) / lift brightness for QR (iOS)
 *   3. Subscribe to SSE for status updates
 *   4. On settle → stop, return result
 *   5. On cancel/expiry → call /cancel
 */
export function useTapBroadcast(args: { amount: string; memo?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const closedRef = useRef(false);
  const prevBrightnessRef = useRef<number | null>(null);
  const sseCloseRef = useRef<(() => void) | null>(null);
  const idempotencyRef = useRef<string>(`tap-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // ── 1. Create the order ──────────────────────────────────────────────
  const create = useMutation({
    mutationFn: () =>
      merchantApi.initiateTap(
        { amount: args.amount, memo: args.memo },
        idempotencyRef.current,
      ),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase({ kind: 'creating' });
      try {
        const order = await create.mutateAsync();
        if (cancelled) return;
        await startBroadcast(order);
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: 'failed',
          error: (err as { message?: string })?.message ?? 'Could not start payment',
        });
      }
    })();
    return () => {
      cancelled = true;
      void teardown();
    };
    // create.mutateAsync intentionally not in deps — single-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2/3/4. Broadcast + SSE ──────────────────────────────────────────
  async function startBroadcast(order: InitiateTapResponse) {
    const expiresAt = new Date(order.expires_at).getTime();
    const ttlMs = Math.max(0, expiresAt - Date.now());
    setPhase({ kind: 'broadcasting', order, remainingMs: ttlMs });

    // Platform-specific surface
    if (Platform.OS === 'android') {
      try {
        await NfcHce.start(order.checkout_url, ttlMs);
      } catch {
        // Non-fatal: user can still tap "Show QR instead" on the screen.
      }
    } else if (Platform.OS === 'ios') {
      try {
        prevBrightnessRef.current = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1.0);
      } catch {
        // Ignore brightness failures.
      }
    }

    // SSE
    sseCloseRef.current = subscribePayments({
      onEvent: (evt) => {
        if (evt.data.order_id !== order.order_id) return;
        if (evt.event === 'payment.deposited') {
          setPhase({ kind: 'detected', order });
        } else if (evt.event === 'payment.settled') {
          const d = evt.data;
          setPhase({
            kind: 'settled',
            order,
            fiat_amount: d.fiat_amount,
            tx_hash: d.tx_hash,
          });
          // Stop the broadcast surface — payment is in.
          void NfcHce.stop().catch(() => undefined);
        } else if (evt.event === 'payment.refunded') {
          setPhase({ kind: 'failed', error: 'Payment was refunded.' });
        }
      },
    });

    // Countdown tick (1s) — when 0, auto-cancel.
    const tickInterval = setInterval(() => {
      setPhase((p) => {
        if (p.kind !== 'broadcasting') {
          clearInterval(tickInterval);
          return p;
        }
        const remaining = Math.max(0, expiresAt - Date.now());
        if (remaining === 0) {
          clearInterval(tickInterval);
          void cancel();
          return p;
        }
        return { ...p, remainingMs: remaining };
      });
    }, 1000);
  }

  // ── 5. Cleanup ──────────────────────────────────────────────────────
  async function teardown() {
    if (closedRef.current) return;
    closedRef.current = true;
    sseCloseRef.current?.();
    sseCloseRef.current = null;
    await NfcHce.stop().catch(() => undefined);
    if (Platform.OS === 'ios' && prevBrightnessRef.current !== null) {
      await Brightness.setBrightnessAsync(prevBrightnessRef.current).catch(() => undefined);
      prevBrightnessRef.current = null;
    }
  }

  async function cancel() {
    const order = 'order' in phase ? phase.order : undefined;
    if (order) {
      try {
        await ordersApi.cancel(order.order_id);
      } catch {
        // Best effort — server-side reconciliation will handle stragglers.
      }
    }
    await teardown();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return { phase, cancel };
}
