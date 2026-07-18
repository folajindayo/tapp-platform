import { jsonError, railsPublicGet } from "@/lib/offramp/rails";

export const dynamic = "force-dynamic";

export interface OfframpQuote {
  rate: string;
  rateId?: string;
  token: string;
  currency: string;
  expiresAt?: string;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "USDC").toUpperCase();
  const fiat = (url.searchParams.get("fiat") ?? "NGN").toUpperCase();
  const amount = url.searchParams.get("amount");

  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return Response.json({ error: "amount must be greater than zero" }, { status: 400 });
  }

  try {
    const data = await railsPublicGet<OfframpQuote>(
      `/v1/rates/${encodeURIComponent(token)}/${encodeURIComponent(amount)}/${encodeURIComponent(fiat)}`,
    );
    return Response.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
