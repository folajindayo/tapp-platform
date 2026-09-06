import { NextResponse } from "next/server";

const RAILS_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const ADMIN_API_TOKEN =
  process.env.ADMIN_API_TOKEN ?? "demo_admin_secret_token_tapp_2026";

export async function POST() {
  try {
    const res = await fetch(`${RAILS_BASE}/v1/cards/issue-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": ADMIN_API_TOKEN,
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
