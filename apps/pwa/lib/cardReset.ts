// Card reset: delete the holder's card rows so they can link again.
//
// This used to be a two-stage ceremony. The holder signed a
// `destroy_and_reclaim` Move call per on-chain cap -- returning that cap's
// USDC to their wallet and deleting the object -- and only then did the
// backend delete the rows, refusing while any cap still held a balance so
// funds could not be orphaned.
//
// None of that applies now. Money lives in the ledger, keyed to the person
// rather than to the card, so deleting a card row cannot orphan anything and
// there is no on-chain object to reclaim. What is left is one call.

import { cardsApi } from "./api";

export interface ResetResult {
  deleted: number;
}

export async function resetCards(
  jwt: string,
  onProgress?: (msg: string) => void,
): Promise<ResetResult> {
  onProgress?.("Clearing your cards…");
  const { deleted } = await cardsApi.reset(jwt);
  return { deleted };
}
