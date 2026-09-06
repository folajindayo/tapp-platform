"use client";

export type PaymentPlan = {
  path: "usdc" | "combined";
  targetUsdcSubunit: number;
  haveUsdcSubunit: number;
  shortfallUsdcSubunit: number;
  suiNeededMist: number;
  suiQuoteMist: number;
  gasReservationMist: number;
  breakdown: {
    usdcPaid: number;
    suiPaid: number; // in MIST
    suiPaidInUsdc: number; // shortfall in USDC subunits
    slippageBufferUsdc: number;
    swapFeeUsdc: number;
    gasFeeSui: number; // in MIST
  };
};

/**
 * Calculates the payment plan based on order target and user balances.
 * 
 * Fees factored in:
 *  - Swap fee: Cetus pool swap fee of 0.25% (2500 basis points)
 *  - Slippage buffer: 0.5% price protection buffer
 *  - Gas: ~0.01 SUI (10,000,000 MIST) reserved for self-sponsored gas fees
 */
import { clientLogger } from "./client-logger";

export function calculatePaymentPlan(
  targetUsdcSubunit: number,
  haveUsdcSubunit: number,
  haveSuiMist: number,
  suiUsdcRate: number, // USDC per 1 SUI (spot rate)
): PaymentPlan | null {
  const gasReservationMist = 10_000_000; // 0.01 SUI for gas

  clientLogger.debug("payment-plan", "calculating plan", {
    targetUsdcSubunit,
    haveUsdcSubunit,
    haveSuiMist,
    suiUsdcRate,
  });

  // Path A: User has enough USDC to pay directly.
  if (haveUsdcSubunit >= targetUsdcSubunit) {
    const plan: PaymentPlan = {
      path: "usdc",
      targetUsdcSubunit,
      haveUsdcSubunit,
      shortfallUsdcSubunit: 0,
      suiNeededMist: 0,
      suiQuoteMist: 0,
      gasReservationMist: 0,
      breakdown: {
        usdcPaid: targetUsdcSubunit,
        suiPaid: 0,
        suiPaidInUsdc: 0,
        slippageBufferUsdc: 0,
        swapFeeUsdc: 0,
        gasFeeSui: 0,
      },
    };
    clientLogger.info("payment-plan", "pure USDC path selected", { plan });
    return plan;
  }

  const shortfallUsdcSubunit = targetUsdcSubunit - haveUsdcSubunit;

  // Swap fee = 0.25%
  // Slippage buffer = 0.5%
  // Total swap premium = 0.75%
  const swapFeeUsdc = Math.round(shortfallUsdcSubunit * 0.0025);
  const slippageBufferUsdc = Math.round(shortfallUsdcSubunit * 0.005);
  const totalNeededUsdc = shortfallUsdcSubunit + swapFeeUsdc + slippageBufferUsdc;

  // Convert USDC subunits (6 decimals) to SUI MIST (9 decimals) -> scale by 1000
  if (!suiUsdcRate || suiUsdcRate <= 0) {
    clientLogger.warn("payment-plan", "invalid exchange rate, cannot compute combined plan", { suiUsdcRate });
    return null;
  }
  const suiQuoteMist = Math.round((shortfallUsdcSubunit / suiUsdcRate) * 1000);
  const suiNeededMist = Math.round((totalNeededUsdc / suiUsdcRate) * 1000);

  clientLogger.debug("payment-plan", "calculated raw swap amounts", {
    shortfallUsdcSubunit,
    swapFeeUsdc,
    slippageBufferUsdc,
    totalNeededUsdc,
    suiQuoteMist,
    suiNeededMist,
  });

  // We must have enough SUI to cover the swap amount + gas reservation
  if (haveSuiMist < suiNeededMist + gasReservationMist) {
    clientLogger.info("payment-plan", "insufficient SUI balance for combined path", {
      haveSuiMist,
      suiNeededMist,
      gasReservationMist,
      required: suiNeededMist + gasReservationMist,
    });
    return null; // Insufficient SUI balance to cover the plan
  }

  const plan: PaymentPlan = {
    path: "combined",
    targetUsdcSubunit,
    haveUsdcSubunit,
    shortfallUsdcSubunit,
    suiNeededMist,
    suiQuoteMist,
    gasReservationMist,
    breakdown: {
      usdcPaid: haveUsdcSubunit,
      suiPaid: suiNeededMist,
      suiPaidInUsdc: shortfallUsdcSubunit,
      slippageBufferUsdc,
      swapFeeUsdc,
      gasFeeSui: gasReservationMist,
    },
  };
  clientLogger.info("payment-plan", "combined SUI + USDC path selected", { plan });
  return plan;
}
