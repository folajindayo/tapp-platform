import { NextResponse } from "next/server";

// Both are read per request rather than at module load so a deployment that
// is missing one answers with a clear 503 instead of a build-time default. An
// earlier revision fell back to a literal admin token, which meant every
// deployment that forgot to set one accepted the same well-known secret.
function config(): { base: string; token: string } | null {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  const token = process.env.ADMIN_API_TOKEN;
  if (!base || !token) return null;
  return { base, token };
}

export async function POST() {
  const cfg = config();
  if (!cfg) {
    return NextResponse.json(
      { error: "Card issuing is not configured on this deployment" },
      { status: 503 },
    );
  }
  try {
    const res = await fetch(`${cfg.base}/v1/cards/issue-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": cfg.token,
      },
      body: JSON.stringify({ count: 1 }),
    });

    const data = await res.json();
    if (!res.ok || data.status !== "success" || !data.data?.urls?.[0]) {
      return NextResponse.json(
        { error: data.message || "Failed to mint card activation URL" },
        { status: res.status || 500 },
      );
    }

    return NextResponse.json({
      url: data.data.urls[0],
      rawToken: data.data.urls[0].split("/c/")[1],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
