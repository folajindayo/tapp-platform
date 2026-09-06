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
  // After the customer pays — the on-chain deposit landed. Bridge has not
  // run yet; we're waiting for Rails to advance state.
  | { kind: 'detected'; order: InitiateTapResponse }
  // Bridge is in flight (LiFi quote + source-chain tx submitted).
  | { kind: 'processing'; order: InitiateTapResponse }
  // LP has filled the order on the destination chain; settlement is
  // imminent.
  | { kind: 'fulfilled'; order: InitiateTapResponse; fiat_amount: string }
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
export function useTapBroadcast(args: { amount: string; memo?: string; enabled?: boolean }) {
  // Gate: don't create the phone-to-phone order until this path is actually
  // chosen. Otherwise just opening the accept screen creates a (Route-B, NGN)
  // order that's orphaned the moment the customer pays by card instead.
  const enabled = args.enabled ?? true;
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
    if (!enabled) return;
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
    // create.mutateAsync intentionally not in deps — single-shot per enable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

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

    // SSE — Rails emits the full lifecycle so the UI can show the
    // customer + merchant where things are in real-time:
    //
    //   deposited → processing → fulfilled → settled
    //
    // Bridge stalls usually surface as `processing` lasting longer than
    // expected; refunds end on `refunded`. Anything we don't recognise
    // we ignore so future Rails events don't break the hook.
    sseCloseRef.current = subscribePayments({
      onEvent: (evt) => {
        if (evt.data.order_id !== order.order_id) return;
        switch (evt.event) {
          case 'payment.deposited':
            setPhase({ kind: 'detected', order });
            // The customer tap is in — close the HCE broadcast so the
            // tag doesn't keep advertising the (now-paid) URL.
            void NfcHce.stop().catch(() => undefined);
            return;
          case 'payment.processing':
            setPhase({ kind: 'processing', order });
            return;
          case 'payment.fulfilled':
            setPhase({
              kind: 'fulfilled',
              order,
              fiat_amount: evt.data.fiat_amount,
            });
            return;
          case 'payment.settled':
            setPhase({
              kind: 'settled',
              order,
              fiat_amount: evt.data.fiat_amount,
              tx_hash: evt.data.tx_hash,
            });
            void NfcHce.stop().catch(() => undefined);
            return;
          case 'payment.refunded':
            setPhase({ kind: 'failed', error: 'Payment was refunded.' });
            return;
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
