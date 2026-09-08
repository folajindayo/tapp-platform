import { NextRequest } from "next/server";
import { apiBase, apiNotConfigured } from "@/lib/server/api-base";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiBaseUrl = apiBase();
  if (!apiBaseUrl) return apiNotConfigured();
  try {
    const { id } = await params;
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
