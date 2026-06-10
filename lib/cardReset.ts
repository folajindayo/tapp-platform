// Card reset / reclaim: return every cap's USDC to the holder's wallet, then
// delete the card rows so they can start fresh.
//
// Ordering matters and is safety-critical: we reclaim ON-CHAIN first (the
// holder signs destroy_and_reclaim per cap, which transfers the balance back
// to their wallet and deletes the cap object), THEN ask the backend to delete
// the rows. The backend refuses to delete while any cap still holds a balance,
// so funds can never be orphaned by a half-finished reset.

import { cardsApi } from "./api";
import type { Transaction } from "@mysten/sui/transactions";

export interface ResetResult {
  reclaimed: number;
  deleted: number;
}

export async function reclaimAndReset(
  jwt: string,
  onProgress?: (msg: string) => void,
): Promise<ResetResult> {
  const packageId = process.env.NEXT_PUBLIC_TAPP_PACKAGE_ID;
  if (!packageId || !/^0x[0-9a-f]{64}$/i.test(packageId)) {
    throw new Error("Card package isn't configured — can't reclaim on-chain.");
  }

  const zk = await import("./zklogin");
  await import("@mysten/sui/transactions"); // ensure the Transaction class is bundled

  const { caps } = await cardsApi.reclaimable(jwt);

  let reclaimed = 0;
  for (const cap of caps) {
    onProgress?.(`Returning funds to your wallet (${reclaimed + 1}/${caps.length})…`);
    await zk.executeZkLoginTx((tx: InstanceType<typeof Transaction>) => {
      // destroy_and_reclaim consumes the cap (a shared object the wallet owns),
      // pays its full balance back to the owner, and deletes it.
      tx.moveCall({
        target: `${packageId}::tapp_card::destroy_and_reclaim`,
        typeArguments: [cap.coin_type],
        arguments: [tx.object(cap.cap_object_id)],
      });
    }, { selfSponsor: true });
    reclaimed++;
  }

  onProgress?.("Clearing your cards…");
  const { deleted } = await cardsApi.reset(jwt);
  return { reclaimed, deleted };
}
