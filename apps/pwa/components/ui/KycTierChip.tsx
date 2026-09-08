"use client";

import { PiCheckCircleFill, PiShieldCheckBold } from "react-icons/pi";
import { StatusChip } from "./StatusChip";
import type { KycStatus } from "@/lib/api";

/**
 * The chip for a verification tier: what it is called, and how settled it
 * looks. Shared by the settings list and the verification screen so the two
 * never disagree about what "verified" looks like.
 */
export function KycTierChip({ status }: { status: Pick<KycStatus, "tier" | "tier_name"> }) {
  if (status.tier >= 2) {
    return (
      <StatusChip tone="success" icon={<PiCheckCircleFill />}>
        {status.tier_name}
      </StatusChip>
    );
  }
  if (status.tier === 1) {
    return (
      <StatusChip tone="pending" icon={<PiShieldCheckBold />}>
        {status.tier_name}
      </StatusChip>
    );
  }
  return <StatusChip>{status.tier_name || "Not verified"}</StatusChip>;
}
