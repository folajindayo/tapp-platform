import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

export const dynamic = "force-dynamic";

interface CoinObject {
  coinType: string;
  coinObjectId: string;
  version: string;
  digest: string;
  balance: string;
}

interface CoinPage {
  data: CoinObject[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

function activeNetwork() {
  return (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
    | "mainnet"
    | "testnet"
    | "devnet";
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(getJsonRpcFullnodeUrl(activeNetwork()), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method,
      params,
    }),
  });
  const body = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (!res.ok || body.error || body.result == null) {
    throw new Error(body.error?.message ?? `Sui RPC ${method} failed`);
  }
  return body.result;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const owner = url.searchParams.get("owner")?.trim();
  const coinType = url.searchParams.get("coinType")?.trim();
  if (!owner || !coinType) {
    return Response.json(
      { error: "owner and coinType are required" },
      { status: 400 },
    );
  }

  try {
    const balance = await rpc<{ totalBalance: string }>("suix_getBalance", [
      owner,
      coinType,
    ]);
    const coins: CoinObject[] = [];
    let cursor: string | null = null;
    do {
      const page: CoinPage = await rpc<CoinPage>("suix_getCoins", [
        owner,
        coinType,
        cursor,
        50,
      ]);
      coins.push(...page.data);
      cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);

    return Response.json({
      data: {
        totalBalance: balance.totalBalance,
        coins,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not fetch coins" },
      { status: 502 },
    );
  }
}
