import { jsonError, railsSenderPost } from "@/lib/offramp/rails";

export const dynamic = "force-dynamic";

interface VerifyAccountBody {
  institution?: string;
  accountIdentifier?: string;
  metadata?: Record<string, unknown>;
}

export interface VerifyAccountResponse {
  accountName: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: VerifyAccountBody;
  try {
    body = (await req.json()) as VerifyAccountBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const institution = body.institution?.trim();
  const accountIdentifier = body.accountIdentifier?.trim();
  if (!institution || !accountIdentifier) {
    return Response.json(
      { error: "institution and accountIdentifier are required" },
      { status: 400 },
    );
  }

  try {
    const data = await railsSenderPost<VerifyAccountResponse>(
      "/v1/sender/verify-account",
      {
        institution,
        accountIdentifier,
        metadata: body.metadata,
      },
    );
    return Response.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
