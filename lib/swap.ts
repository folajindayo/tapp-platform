// SUI <-> USDC swap via Cetus CLMM (mainnet SUI/USDC 0.25% pool).
//
// Lets a holder convert SUI into USDC to fund their card (and back). Quotes
// come from Cetus `preSwap`; the swap itself is built with
// `createSwapWithoutTransferCoinsPayload` and the proceeds are transferred back
// to the holder, then submitted via zkLogin (self-sponsored — the holder pays
// gas from their SUI, which they have in the primary SUI->USDC case).

import { SUI_COIN_TYPE, USDC_COIN_TYPE, suiReadClient } from "./sui-client";
import { executeZkLoginTx, readSession } from "./zklogin";
import type { Transaction } from "@mysten/sui/transactions";

// Mainnet SUI/USDC 0.25% pool. coin A = USDC (6dp), coin B = SUI (9dp).
const POOL_ID =
  "0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105";
export const USDC_DECIMALS = 6;
export const SUI_DECIMALS = 9;

export type SwapDirection = "SUI_TO_USDC" | "USDC_TO_SUI";

export interface SwapQuote {
  amountInBase: bigint;
  amountOutBase: bigint;
  feeBase: bigint;
  isExceed: boolean;
}

// a2b means A(USDC) -> B(SUI). So USDC_TO_SUI is a2b=true; SUI_TO_USDC a2b=false.
function isA2b(direction: SwapDirection): boolean {
  return direction === "USDC_TO_SUI";
}

export function inCoinType(direction: SwapDirection): string {
  return direction === "SUI_TO_USDC" ? SUI_COIN_TYPE : USDC_COIN_TYPE;
}
export function outCoinType(direction: SwapDirection): string {
  return direction === "SUI_TO_USDC" ? USDC_COIN_TYPE : SUI_COIN_TYPE;
}
export function inDecimals(direction: SwapDirection): number {
  return direction === "SUI_TO_USDC" ? SUI_DECIMALS : USDC_DECIMALS;
}
export function outDecimals(direction: SwapDirection): number {
  return direction === "SUI_TO_USDC" ? USDC_DECIMALS : SUI_DECIMALS;
}

function senderOrThrow(): string {
  const s = readSession()?.suiAddress;
  if (!s) throw new Error("No wallet — please sign in again.");
  return s;
}

async function getSdk(sender: string) {
  const { CetusClmmSDK, clmmMainnet } = await import("@cetusprotocol/sui-clmm-sdk");
  const sdk = new CetusClmmSDK(clmmMainnet);
  sdk.setSenderAddress(sender);
  return sdk;
}

/** Estimate the output (base units of the output coin) for an input amount. */
export async function quoteSwap(
  direction: SwapDirection,
  amountInBase: bigint,
): Promise<SwapQuote> {
  if (amountInBase <= BigInt(0)) {
    return { amountInBase, amountOutBase: BigInt(0), feeBase: BigInt(0), isExceed: false };
  }
  const sdk = await getSdk(senderOrThrow());
  const pool = await sdk.Pool.getPool(POOL_ID);
  const pre = await sdk.Swap.preSwap({
    pool,
    current_sqrt_price: Number(pool.current_sqrt_price),
    decimals_a: USDC_DECIMALS,
    decimals_b: SUI_DECIMALS,
    a2b: isA2b(direction),
    by_amount_in: true,
    amount: amountInBase.toString(),
    coin_type_a: USDC_COIN_TYPE,
    coin_type_b: SUI_COIN_TYPE,
  });
  return {
    amountInBase,
    amountOutBase: BigInt(pre.estimated_amount_out),
    feeBase: BigInt(pre.estimated_fee_amount),
    isExceed: pre.is_exceed,
  };
}

/** Execute the swap and send the proceeds (+ any change) back to the holder. */
export async function executeSwap(
  direction: SwapDirection,
  amountInBase: bigint,
  slippagePct = 1,
): Promise<{ digest: string; minOutBase: bigint }> {
  const sender = senderOrThrow();
  const sdk = await getSdk(sender);
  const a2b = isA2b(direction);

  // Quote → slippage-protected minimum output.
  const pool = await sdk.Pool.getPool(POOL_ID);
  const pre = await sdk.Swap.preSwap({
    pool,
    current_sqrt_price: Number(pool.current_sqrt_price),
    decimals_a: USDC_DECIMALS,
    decimals_b: SUI_DECIMALS,
    a2b,
    by_amount_in: true,
    amount: amountInBase.toString(),
    coin_type_a: USDC_COIN_TYPE,
    coin_type_b: SUI_COIN_TYPE,
  });
  if (pre.is_exceed) {
    throw new Error("Amount is larger than the pool can fill — try a smaller amount.");
  }
  const estOut = BigInt(pre.estimated_amount_out);
  const minOut = (estOut * BigInt(Math.round((100 - slippagePct) * 100))) / BigInt(10000);

  const swapRes = await sdk.Swap.createSwapWithoutTransferCoinsPayload({
    pool_id: POOL_ID,
    a2b,
    by_amount_in: true,
    amount: amountInBase.toString(),
    amount_limit: minOut.toString(),
    coin_type_a: USDC_COIN_TYPE,
    coin_type_b: SUI_COIN_TYPE,
  });

  const tx = swapRes.tx as InstanceType<typeof Transaction>;
  // Both the swapped coin and any leftover input change go back to the holder.
  tx.transferObjects(
    [swapRes.coin_ab_s[0], swapRes.coin_ab_s[1]],
    tx.pure.address(sender),
  );

  const result = await executeZkLoginTx(tx, { selfSponsor: true });
  return { digest: result.digest, minOutBase: minOut };
}

/** Holder's total spendable balance (base units) of a coin type. */
export async function coinBalanceBase(coinType: string): Promise<bigint> {
  const { data } = await suiReadClient().getCoins({
    owner: senderOrThrow(),
    coinType,
  });
  return data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
}

// ---- decimal-string <-> base-unit helpers (float-free) ----

export function toBaseUnits(amount: string, decimals: number): bigint {
  if (!amount) return BigInt(0);
  const cleaned = amount.replace(/,/g, "").trim();
  if (!/^\d*\.?\d*$/.test(cleaned)) return BigInt(0);
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * BigInt(10) ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function fromBaseUnits(base: bigint, decimals: number, maxDp = 6): string {
  const d = BigInt(10) ** BigInt(decimals);
  const whole = base / d;
  const frac = (base % d).toString().padStart(decimals, "0").slice(0, maxDp).replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}
