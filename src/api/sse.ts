// React Native SSE client for /v1/sender/me/payments/stream.
// Uses react-native-sse which (unlike the browser EventSource) supports
// custom request headers — we need Authorization: Bearer here.

import EventSource from 'react-native-sse';
import { API_BASE_URL } from './config';
import { getAccessToken } from './storage';
import type { SsePaymentEvent } from './types';

export type PaymentSseEventName = SsePaymentEvent['event'];

const ALL_EVENTS: PaymentSseEventName[] = [
  'payment.deposited',
  'payment.processing',
  'payment.fulfilled',
  'payment.settled',
  'payment.refunded',
];

export interface SubscribeOpts {
  onEvent: (evt: SsePaymentEvent) => void;
  onError?: (err: unknown) => void;
  /** Resume-from-event ID. Server replays from after this id. */
  lastEventId?: string;
}

/**
 * Open an SSE subscription for the authenticated sender's payment events.
 * Returns a close function. Caller is responsible for closing on screen unmount.
 */
export function subscribePayments(opts: SubscribeOpts): () => void {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.lastEventId) headers['Last-Event-ID'] = opts.lastEventId;

  // react-native-sse types the generic to the union of event names so
  // addEventListener is typesafe.
  const es = new EventSource<PaymentSseEventName>(
    `${API_BASE_URL}/v1/sender/me/payments/stream`,
    {
      headers,
      // Auto-reconnect interval; library default is 5s.
      timeout: 0,
    },
  );

  for (const name of ALL_EVENTS) {
    es.addEventListener(name, (raw) => {
      try {
        const data = JSON.parse(raw.data ?? '{}');
        opts.onEvent({ event: name, data } as SsePaymentEvent);
      } catch (err) {
        opts.onError?.(err);
      }
    });
  }

  es.addEventListener('error', (err) => {
    opts.onError?.(err);
  });

  return () => {
    es.removeAllEventListeners();
    es.close();
  };
}
