"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PiKeyboardBold } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { QRScanner } from "@/components/ui/QRScanner";
import { InputError } from "@/components/ui/InputError";
import { useSession } from "@/lib/auth";

/**
 * Pay flow entry — full-screen scanner. We accept either a full URL
 * (https://app.usetapp.xyz/order/abc-123) or a bare order id and
 * route to /order/[id].
 */
export default function PayPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const [scanning, setScanning] = useState(true);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/pay");
  }, [hydrated, session, router]);

  function handleResult(text: string) {
    setScanning(false);
    const id = extractOrderId(text);
    if (!id) {
      setError("That QR doesn't look like a Tapp order. Try again.");
      return;
    }
    router.replace(`/order/${encodeURIComponent(id)}`);
  }

  function submitManual() {
    if (!manual.trim()) return;
    const id = extractOrderId(manual.trim());
    if (!id) {
      setError("Couldn't read that link. Paste a Tapp order URL.");
      return;
    }
    router.replace(`/order/${encodeURIComponent(id)}`);
  }

  if (!hydrated || !session) return <Screen />;

  if (scanning) {
    return (
      <QRScanner
        onResult={handleResult}
        onClose={() => setScanning(false)}
      />
    );
  }

  return (
    <Screen>
      <div className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white">
        <div className="space-y-2">
          <h1 className="text-xl font-medium">Paste an order link</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Or restart the scanner.
          </p>
        </div>

        <div className="grid gap-2 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
          <label
            htmlFor="manual"
            className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30"
          >
            Order URL or ID
          </label>
          <input
            id="manual"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="https://app.usetapp.xyz/order/…"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm transition-all placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 dark:border-white/20 dark:bg-neutral-900 dark:text-white/80 dark:placeholder:text-white/30"
          />
        </div>

        {error ? <InputError message={error} /> : null}

        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setScanning(true);
            }}
            leadingIcon={<PiKeyboardBold className="text-base" />}
          >
            Scan again
          </Button>
          <Button onClick={submitManual} disabled={!manual.trim()}>
            Continue
          </Button>
        </div>
      </div>
    </Screen>
  );
}

function extractOrderId(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    // Match `/order/<id>` or `/o/<id>` at the end of the path.
    const m = u.pathname.match(/\/(?:order|o)\/([^/]+)\/?$/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  } catch {
    // Not a URL — fall through and treat as a bare id.
  }
  // Plain id: allow safe characters only.
  if (/^[A-Za-z0-9_-]{4,64}$/.test(trimmed)) return trimmed;
  return null;
}
