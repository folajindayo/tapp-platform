// Single long-lived SSE subscription for the signed-in merchant.
// Mounted inside the (app) group so the connection only exists while
// authenticated. Translates payment.* events into react-query cache
// updates so the dashboard, transactions list, and order detail screen
// re-render without an explicit refetch.

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { subscribePayments } from '@/api/sse';
import { useAuthStore } from '@/auth/store';
import type {
  OrderStatus,
  PaymentOrderSummary,
  SsePaymentEvent,
} from '@/api/types';

interface Props {
  children: React.ReactNode;
}

export function PaymentsRealtimeProvider({ children }: Props) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;
    const close = subscribePayments({
      onEvent: (evt) => applyEvent(qc, evt),
      onError: () => {
        // react-native-sse auto-reconnects; nothing actionable here.
      },
    });
    return close;
  }, [qc, userId]);

  return children as React.ReactElement;
}

function applyEvent(qc: QueryClient, evt: SsePaymentEvent) {
  const orderId = evt.data.order_id;

  // Patch the per-order detail cache if a screen is currently watching it.
  qc.setQueryData<PaymentOrderSummary | undefined>(
    ['sender', 'orders', orderId],
    (prev) => (prev ? applyToSummary(prev, evt) : prev),
  );

  // The transactions list uses useInfiniteQuery, which stores `{ pages, pageParams }`
  // rather than a flat array — surgical patching is fragile and there can be
  // multiple list queries open at once (different status filters). Invalidate
  // on terminal events only; intermediate transitions don't change which
  // rows are visible, only the per-row status, which the detail patch handles.
  if (isTerminal(evt.event)) {
    void qc.invalidateQueries({ queryKey: ['sender', 'orders', 'all'] });
    void qc.invalidateQueries({ queryKey: ['sender', 'stats'] });
  }
}

function applyToSummary(
  prev: PaymentOrderSummary,
  evt: SsePaymentEvent,
): PaymentOrderSummary {
  const next: PaymentOrderSummary = { ...prev, status: nextStatus(prev.status, evt) };
  if (evt.event === 'payment.settled') {
    next.txHash = evt.data.tx_hash;
    next.updatedAt = evt.data.settled_at;
  }
  return next;
}

function nextStatus(prev: OrderStatus, evt: SsePaymentEvent): OrderStatus {
  switch (evt.event) {
    case 'payment.deposited':
      return prev === 'initiated' ? 'pending' : prev;
    case 'payment.processing':
      return 'processing';
    case 'payment.fulfilled':
      return 'fulfilled';
    case 'payment.settled':
      return 'settled';
    case 'payment.refunded':
      return 'refunded';
  }
}

function isTerminal(name: SsePaymentEvent['event']): boolean {
  return name === 'payment.settled' || name === 'payment.refunded';
}
