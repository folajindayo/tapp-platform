"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { signOut, useSession } from "@/lib/auth";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { useLinkStore } from "@/lib/cardLinkStore";
import { bytesToHex } from "@/lib/cardCrypto";
import { cardsApi, ApiError } from "@/lib/api";

export default function LinkSignPage() {
  return (
    <Suspense fallback={<Screen centered />}>
      <Body />
    </Suspense>
  );
}

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_LINK === "1";

function Body() {
  const router = useRouter();
  const params = useSearchParams();
  const cardId = params.get("card");
  const { hydrated, session } = useSession();
  const link = useLinkStore();

  const [phase, setPhase] = useState<
    "ready" | "signing" | "submitting" | "done" | "error"
  >("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) router.replace("/wallet");
    if (hydrated && !session) {
      router.replace(`/sign-in?next=/link/sign?card=${cardId ?? ""}`);
    }
    if (
      !link.K ||
      !link.linkingProof ||
      !link.pinVerifier ||
      !link.cardPassword ||
      !link.rotationToken ||
      !link.cardUidHash
    ) {
      router.replace(`/link/configure?card=${cardId ?? ""}`);
    }
  }, [cardId, hydrated, session, link, router]);

  async function go() {
    if (!session) return;
    setError(null);
    setPhase("signing");

    try {
      let capObjectId: string;
      let coinType: string;
      let txDigest: string;

      if (DEMO_MODE) {
        capObjectId = "0xdemo_cap_" + (cardId ?? "").slice(0, 8);
        coinType = "0xdemo::usdc::USDC";
        txDigest = "demo-" + Date.now().toString(36);
      } else {
        const zk = await import("@/lib/zklogin");
        const { Transaction } = await import("@mysten/sui/transactions");
        const packageId = process.env.NEXT_PUBLIC_TAPP_PACKAGE_ID;
        if (!packageId) {
          throw new Error(
            "NEXT_PUBLIC_TAPP_PACKAGE_ID not set — deploy the Move package or use NEXT_PUBLIC_DEMO_LINK=1.",
          );
        }
        // A package id must be a full 32-byte address (0x + 64 hex). A shorter
        // value gets silently left-padded by the SDK into a *different*,
        // unpublished address that fails on-chain with a cryptic "package not
        // found" — so reject it up front with an actionable message.
        if (!/^0x[0-9a-f]{64}$/i.test(packageId)) {
          throw new Error(
            `NEXT_PUBLIC_TAPP_PACKAGE_ID must be a 32-byte 0x address (64 hex chars); got ${Math.max(0, packageId.length - 2)}. Looks truncated — check the deploy env var.`,
          );
        }
        const result = await zk.executeZkLoginTx((tx: InstanceType<typeof Transaction>) => {
          tx.moveCall({
            target: `${packageId}::tapp_card::create_cap`,
            typeArguments: [
              process.env.NEXT_PUBLIC_USDC_COIN_TYPE ??
                "0x2::coin::Coin<0x2::sui::SUI>",
            ],
            arguments: [
              tx.gas,
              tx.pure.u64(BigInt(link.dailyLimitSubunit)),
              tx.pure.u64(BigInt(link.perTapLimitSubunit)),
              tx.pure.vector("u8", Array.from(link.cardUidHash!)),
            ],
          });
        });
        const created =
          (result.effects as { created?: { reference: { objectId: string } }[] })
            ?.created ?? [];
        const cap = created[0];
        if (!cap) throw new Error("create_cap effects missing — check Move call args");
        capObjectId = cap.reference.objectId;
        coinType =
          process.env.NEXT_PUBLIC_USDC_COIN_TYPE ?? "unknown";
        txDigest = result.digest;
      }

      link.setChainResult({ capObjectId, coinType, txDigest });

      setPhase("submitting");
      await cardsApi.linkComplete(
        {
          card_uid_hash:             bytesToHex(link.cardUidHash!),
          cap_object_id:             capObjectId,
          coin_type:                 coinType,
          linking_proof:             bytesToHex(link.linkingProof!),
          pin_verifier:              bytesToHex(link.pinVerifier!),
          card_password:             bytesToHex(link.cardPassword!),
          current_token_ct:          bytesToHex(link.rotationToken!),
          tx_digest:                 txDigest,
          daily_limit_subunit:       link.dailyLimitSubunit,
          per_tap_limit_subunit:     link.perTapLimitSubunit,
          step_up_threshold_subunit: link.stepUpThresholdSubunit,
        },
        session.jwt,
      );

      link.reset();
      setPhase("done");
      router.replace("/settings/card");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.message}${err.code ? ` (${err.code})` : ""}`
          : err instanceof Error
            ? err.message
            : "Linking failed";
      setError(msg);
      setPhase("error");
    }
  }

  return (
    <Screen centered>
      <AnimatedComponent
        variant={slideInOut}
        className="flex flex-col items-center gap-8 text-center"
      >
        {phase === "ready" ? (
          <>
            <div className="space-y-3">
              <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
                Confirm &amp; fund your card
              </h1>
              <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
                Step 4 of 4 — Sign with Google to publish your spending cap
                on-chain.
                {DEMO_MODE ? " (demo mode — no Sui call)" : ""}
              </p>
            </div>

            {session && !session.zkLoginReady && (
              <InfoBanner tone="warning">
                <p className="font-medium text-neutral-900 dark:text-white">
                  Secure session expired or not ready
                </p>
                <p className="mt-1 text-xs">
                  To protect your wallet, on-chain sessions expire after 24 hours. Sign in again to authorize linking this card.
                </p>
                <Button
                  onClick={() => {
                    const email = session.email;
                    signOut();
                    router.replace(`/sign-in?next=/link/sign?card=${cardId ?? ""}&email=${encodeURIComponent(email)}`);
                  }}
                  className="mt-3 text-xs py-1.5 px-3"
                  fullWidth={false}
                >
                  Sign in again
                </Button>
              </InfoBanner>
            )}

            <Button onClick={go} disabled={!session || !session.zkLoginReady}>Sign &amp; finish</Button>
          </>
        ) : phase === "signing" ? (
          <>
            <div className="loader" />
            <p className="text-sm text-gray-500 dark:text-white/50">
              Signing on Sui…
            </p>
          </>
        ) : phase === "submitting" ? (
          <>
            <div className="loader" />
            <p className="text-sm text-gray-500 dark:text-white/50">
              Finalizing with Tapp…
            </p>
          </>
        ) : phase === "done" ? (
          <StatusChip tone="success" icon={<PiCheckCircleFill />}>
            Done — taking you to your card
          </StatusChip>
        ) : (
          <>
            <InputError message={error ?? "Linking failed"} />
            <Button onClick={go} variant="secondary">
              Try again
            </Button>
          </>
        )}
      </AnimatedComponent>
    </Screen>
  );
}
