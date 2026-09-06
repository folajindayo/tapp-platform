import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    const url = `${apiBaseUrl}/v1/orders/${id}/stream`;

    const response = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        "ngrok-skip-browser-warning": "1",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return new Response(`Error connecting to upstream stream: ${response.statusText}`, {
        status: response.status,
      });
    }

    if (!response.body) {
      return new Response("No stream body returned from upstream", { status: 500 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    return new Response(error.message || "Internal Server Error", { status: 500 });
  }
}
