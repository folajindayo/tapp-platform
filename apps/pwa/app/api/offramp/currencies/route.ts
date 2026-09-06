import { jsonError, railsPublicGet } from "@/lib/offramp/rails";

export const dynamic = "force-dynamic";

export interface OfframpCurrency {
  code: string;
  name: string;
  supported_routes: string[];
  ceiling_rate: string;
}

export async function GET(): Promise<Response> {
  try {
    const data = await railsPublicGet<OfframpCurrency[]>("/v1/currencies");
    return Response.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
