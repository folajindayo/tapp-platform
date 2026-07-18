import { jsonError, railsPublicGet } from "@/lib/offramp/rails";

export const dynamic = "force-dynamic";

export interface OfframpInstitution {
  code: string;
  name: string;
  type: string;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const currency = url.searchParams.get("currency")?.toUpperCase();
  if (!currency) {
    return Response.json({ error: "currency is required" }, { status: 400 });
  }

  try {
    const data = await railsPublicGet<OfframpInstitution[]>(
      `/v1/institutions/${encodeURIComponent(currency)}`,
    );
    return Response.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
