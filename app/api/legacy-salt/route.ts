// One-off salt service for /recover-legacy.
//
// The pre-Shinami Tapp build never actually used Mysten's salt
// service — every attempt fell back to a deterministic local
// derivation (sha256("tapp.dev.salt.v1:" + sub), first 16 bytes →
// BigInt → decimal). That fallback is what minted the legacy
// receive addresses, so the recovery flow has to reproduce it
// exactly to derive a matching zkLogin address.
//
// See removed app/api/salt/route.ts + lib/auth.tsx::devSalt (git
// history) for the original implementation.
//
// Delete this route together with /recover-legacy once the sweep
// is confirmed.

import crypto from "crypto";
import { decodeJwt } from "jose";
import { NextResponse } from "next/server";

export async function POST(req: Request): Promise<Response> {
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (!body.token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const claims = decodeJwt(body.token);
  if (typeof claims.sub !== "string" || !claims.sub) {
    return NextResponse.json(
      { error: "JWT missing 'sub' claim" },
      { status: 400 },
    );
  }

  const hash = crypto
    .createHash("sha256")
    .update("tapp.dev.salt.v1:" + claims.sub)
    .digest();

  let n = BigInt(0);
  for (let i = 0; i < 16; i++) {
    n = (n << BigInt(8)) | BigInt(hash[i]);
  }
  return NextResponse.json({ salt: n.toString() });
}
