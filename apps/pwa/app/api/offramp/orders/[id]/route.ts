import { jsonError, railsSenderGet } from "@/lib/offramp/rails";
import type { OfframpOrder } from "../route";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const data = await railsSenderGet<OfframpOrder>(
      `/v1/sender/orders/${encodeURIComponent(id)}`,
    );
    return Response.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
