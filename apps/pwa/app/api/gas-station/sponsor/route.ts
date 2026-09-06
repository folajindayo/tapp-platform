import { NextResponse } from "next/server";

export async function POST(request: Request) {
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

    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

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
