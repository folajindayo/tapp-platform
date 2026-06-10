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
      // Idempotency guard — the whole point of this fix. create_cap moves
      // real USDC, so it must run AT MOST ONCE per holder. If they already
      // have a live, funded card (e.g. they re-entered linking because the
      // balance showed 0), do NOT fund a second cap — send them to the card
      // they already have. This is what was double-charging users.
      const existing = await cardsApi.me(session.jwt).catch(() => null);
      if (existing && existing.status === "live" && existing.cap_object_id) {
        router.replace("/settings/card");
        return;
      }

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
        // The card is denominated in USDC (matches the rails settlement
        // system). T must be the bare coin type (…::usdc::USDC), NOT Coin<…>.
        const usdcCoinType = process.env.NEXT_PUBLIC_USDC_COIN_TYPE;
        if (!usdcCoinType || !/^0x[0-9a-f]{1,64}::[^:]+::[^:]+$/i.test(usdcCoinType)) {
          throw new Error(
            "NEXT_PUBLIC_USDC_COIN_TYPE must be a coin type like 0x…::usdc::USDC — set it for this network.",
          );
        }
        // Seed the cap's balance from the holder's USDC. `fundingSubunit` is
        // micro-USDC (6 dp). If they chose an amount, select their USDC coins
        // up front and remember the ids; if it's 0 we mint a zero coin in the
        // PTB so the cap still gets created (they top up later).
        const fundingMicro = BigInt(link.fundingSubunit);
        let usdcCoinIds: string[] = [];
        if (fundingMicro > BigInt(0)) {
          const owner = zk.readSession()?.suiAddress;
          if (!owner) throw new Error("No wallet address — please sign in again.");
          const { data: coins } = await zk.suiClient().getCoins({
            owner,
            coinType: usdcCoinType,
          });
          const total = coins.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
          if (total < fundingMicro) {
            const usd = (m: bigint) => `$${(Number(m) / 1e6).toFixed(2)}`;
            throw new Error(
              `Not enough USDC to fund this card — need ${usd(fundingMicro)}, wallet has ${usd(total)}. Lower the funding amount and try again (you can top up later).`,
            );
          }
          usdcCoinIds = coins.map((c) => c.coinObjectId);
        }

        // The cap is USDC-denominated (balance + debits are in USDC subunit),
        // so its on-chain limits must be too — otherwise the Move per-tap check
        // compares USDC-subunit debits against NGN-kobo limits and rejects
        // legitimate taps. Convert the NGN-kobo limits to USDC subunit via the
        // live rate. The off-chain (NGN) limits still live on the card row.
        const ratesRes = await fetch("/api/rates", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null);
        const ngnPerUsdc = Number(ratesRes?.ngn_per_usdc);
        if (!ngnPerUsdc || ngnPerUsdc <= 0) {
          throw new Error("Couldn't load the NGN/USDC rate — try again in a moment.");
        }
        const koboToUsdcMicro = (kobo: number) =>
          BigInt(Math.max(1, Math.round((kobo / 100 / ngnPerUsdc) * 1_000_000)));
        const dailyLimitUsdc = koboToUsdcMicro(link.dailyLimitSubunit);
        const perTapLimitUsdc = koboToUsdcMicro(link.perTapLimitSubunit);

        const result = await zk.executeZkLoginTx((tx: InstanceType<typeof Transaction>) => {
          // create_cap wants a Coin<T> to seed the balance. (tx.gas is
          // Coin<SUI> and can't fund a USDC cap — that was the arg-0
          // TypeMismatch.)
          let funding;
          if (fundingMicro > BigInt(0)) {
            // Merge the holder's USDC into one coin, then split the exact
            // funding amount off it.
            const primary = tx.object(usdcCoinIds[0]);
            if (usdcCoinIds.length > 1) {
              tx.mergeCoins(
                primary,
                usdcCoinIds.slice(1).map((id) => tx.object(id)),
              );
            }
            funding = tx.splitCoins(primary, [tx.pure.u64(fundingMicro)])[0];
          } else {
            funding = tx.moveCall({
              target: "0x2::coin::zero",
              typeArguments: [usdcCoinType],
            });
          }
          tx.moveCall({
            target: `${packageId}::tapp_card::create_cap`,
            typeArguments: [usdcCoinType],
            arguments: [
              funding,
              tx.pure.u64(dailyLimitUsdc),
              tx.pure.u64(perTapLimitUsdc),
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
        coinType = usdcCoinType;
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
