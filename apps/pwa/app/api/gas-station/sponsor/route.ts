import { NextResponse } from "next/server";
import { apiBase, apiNotConfigured } from "@/lib/server/api-base";

export async function POST(request: Request) {
  const apiBaseUrl = apiBase();
  if (!apiBaseUrl) return apiNotConfigured();
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { txBytes, sender } = body;
    if (!txBytes || !sender) {
      return NextResponse.json({ error: "Missing txBytes or sender" }, { status: 400 });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": authHeader,
      "ngrok-skip-browser-warning": "1",
    };

    const response = await fetch(`${apiBaseUrl}/v1/gas-station/sponsor`, {
      method: "POST",
      headers,
      body: JSON.stringify({ txBytes, sender }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: errorText }, { status: response.status });
    }

    const envelope = await response.json();
    if (envelope.status === "error") {
      return NextResponse.json({ error: envelope.message || "Sponsorship failed" }, { status: 400 });
    }

    return NextResponse.json(envelope.data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
