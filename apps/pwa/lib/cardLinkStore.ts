"use client";

import { create } from "zustand";

/**
 * Scratch state for the multi-step linking flow.
 *
 * Lives in-memory only — no persistence. Everything sensitive (K, PIN,
 * derived proofs) stays in JS heap and is `reset()` after the flow
 * completes or the user navigates away. Hard-refresh during linking
 * loses progress and restarts; that's acceptable for a flow the user
 * runs once per card.
 */

export interface LinkState {
  /**
   * The server-side session driving this ceremony. Everything below is
   * scratch state for the current screen; this is what lets a client that
   * lost its place ask the server where it got to instead of starting over.
   */
  sessionId: string | null;
  cardId: string | null;
  // Limits the user dialed in.
  dailyLimitSubunit: number;
  perTapLimitSubunit: number;
  stepUpThresholdSubunit: number;
  fundingSubunit: number;
  // Sensitive material — populated during step 2/3 only.
  K: Uint8Array | null;
  pin: string | null;
  linkingProof: Uint8Array | null;
  pinVerifier: Uint8Array | null;
  cardPassword: Uint8Array | null;
  cardUidHash: Uint8Array | null;
  /**
   * The token the SERVER issued for this card, to be written to the chip.
   *
   * Generated server-side rather than here: it is the value a later tap is
   * checked against, and client entropy is the weaker source. Held so the
   * write and the activation that confirms it use the same bytes.
   */
  rotationToken: Uint8Array | null;

  setSession: (sessionId: string, cardId: string) => void;
  setCardId: (id: string) => void;
  setLimits: (l: {
    daily: number;
    perTap: number;
    stepUp: number;
    funding?: number;
    pin: string;
  }) => void;
  setCryptoMaterial: (m: {
    K: Uint8Array;
    linkingProof: Uint8Array;
    pinVerifier: Uint8Array;
    cardPassword: Uint8Array;
  }) => void;
  setCardUidHash: (h: Uint8Array) => void;
  setRotationToken: (t: Uint8Array) => void;
  reset: () => void;
}

export const useLinkStore = create<LinkState>((set) => ({
  sessionId: null,
  cardId: null,
  dailyLimitSubunit: 0,
  perTapLimitSubunit: 0,
  stepUpThresholdSubunit: 0,
  fundingSubunit: 0,
  K: null,
  pin: null,
  linkingProof: null,
  pinVerifier: null,
  cardPassword: null,
  cardUidHash: null,
  rotationToken: null,

  setSession: (sessionId, cardId) => set({ sessionId, cardId }),
  setCardId: (id) => set({ cardId: id }),
  setLimits: (l) =>
    set({
      dailyLimitSubunit: l.daily,
      perTapLimitSubunit: l.perTap,
      stepUpThresholdSubunit: l.stepUp,
      fundingSubunit: l.funding ?? 0,
      pin: l.pin,
    }),
  setCryptoMaterial: (m) =>
    set({
      K: m.K,
      linkingProof: m.linkingProof,
      pinVerifier: m.pinVerifier,
      cardPassword: m.cardPassword,
    }),
  setCardUidHash: (h) => set({ cardUidHash: h }),
  setRotationToken: (t) => set({ rotationToken: t }),
  reset: () => {
    // Best-effort wipe of sensitive buffers before drop.
    set((s) => {
      s.K?.fill(0);
      s.linkingProof?.fill(0);
      s.pinVerifier?.fill(0);
      s.cardPassword?.fill(0);
      s.rotationToken?.fill(0);
      return {
        sessionId: null,
        cardId: null,
        dailyLimitSubunit: 0,
        perTapLimitSubunit: 0,
        stepUpThresholdSubunit: 0,
        fundingSubunit: 0,
        K: null,
        pin: null,
        linkingProof: null,
        pinVerifier: null,
        cardPassword: null,
        cardUidHash: null,
        rotationToken: null,
      };
    });
  },
}));
