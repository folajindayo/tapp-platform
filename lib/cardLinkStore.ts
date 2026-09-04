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
  rotationToken: Uint8Array | null;
  // Set after the create_cap PTB lands.
  capObjectId: string | null;
  coinType: string | null;
  txDigest: string | null;

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
    rotationToken: Uint8Array;
  }) => void;
  setCardUidHash: (h: Uint8Array) => void;
  setChainResult: (r: { capObjectId: string; coinType: string; txDigest: string }) => void;
  reset: () => void;
}

export const useLinkStore = create<LinkState>((set) => ({
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
  capObjectId: null,
  coinType: null,
  txDigest: null,

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
      rotationToken: m.rotationToken,
    }),
  setCardUidHash: (h) => set({ cardUidHash: h }),
  setChainResult: (r) =>
    set({
      capObjectId: r.capObjectId,
      coinType: r.coinType,
      txDigest: r.txDigest,
    }),
  reset: () => {
    // Best-effort wipe of sensitive buffers before drop.
    set((s) => {
      s.K?.fill(0);
      s.linkingProof?.fill(0);
      s.pinVerifier?.fill(0);
      s.cardPassword?.fill(0);
      s.rotationToken?.fill(0);
      return {
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
        capObjectId: null,
        coinType: null,
        txDigest: null,
      };
    });
  },
}));
