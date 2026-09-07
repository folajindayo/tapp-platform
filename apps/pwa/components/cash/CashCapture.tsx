"use client";

import { useCallback, useRef, useState } from "react";
import { PiCameraBold, PiArrowCounterClockwiseBold } from "react-icons/pi";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";

/**
 * The longest edge an uploaded photograph is downscaled to.
 *
 * Recognition needs to read denominations and, where it can, serials. Sixteen
 * hundred pixels across a table of notes is comfortably enough for both and
 * keeps a photograph under a few hundred kilobytes, which matters on the
 * connections this is used on.
 */
const MAX_EDGE = 1600;

/** JPEG quality. High enough not to smear a serial, low enough to send. */
const QUALITY = 0.82;

export interface Capture {
  /** base64, no data: prefix — what the API takes. */
  base64: string;
  /** An object URL for the preview. Revoked when the capture is replaced. */
  previewUrl: string;
  bytes: number;
}

/**
 * Photograph the cash.
 *
 * `capture="environment"` on a file input, rather than getUserMedia and a
 * canvas: it opens the phone's own camera app, which focuses better, exposes
 * better and is the interface the user already knows. A hand-built viewfinder
 * takes worse photographs, and a worse photograph is a refused pledge.
 *
 * Downscaling happens here rather than on the server because the upload is the
 * slow part. A 4MB original over a weak connection is a minute of somebody
 * standing in a market holding their money up.
 */
export function CashCapture({
  value,
  onChange,
  disabled,
}: {
  value: Capture | null;
  onChange: (capture: Capture | null) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = useCallback(
    async (file: File) => {
      setWorking(true);
      setError(null);
      try {
        const capture = await downscale(file);
        if (value) URL.revokeObjectURL(value.previewUrl);
        onChange(capture);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "That photo could not be read. Try taking it again.",
        );
      } finally {
        setWorking(false);
      }
    },
    [value, onChange],
  );

  return (
    <div className="grid gap-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so choosing the same file twice still fires a change.
          e.target.value = "";
          if (file) void take(file);
        }}
      />

      {value ? (
        <div className="relative overflow-hidden rounded-3xl border border-[var(--line)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.previewUrl}
            alt="The cash you are pledging"
            className="block max-h-72 w-full object-cover"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => input.current?.click()}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-[var(--surface)]/90 px-3 py-1.5 text-xs font-medium text-[var(--fg)] shadow-sm backdrop-blur"
          >
            <PiArrowCounterClockwiseBold /> Retake
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || working}
          onClick={() => input.current?.click()}
          className={cn(
            "grid justify-items-center gap-2 rounded-3xl border border-dashed border-[var(--line-strong)] bg-[var(--sunken)] px-6 py-10 text-center transition-colors",
            !disabled && "hover:border-[var(--accent)] hover:bg-[var(--accent-wash)]",
          )}
        >
          {working ? (
            <div className="loader" />
          ) : (
            <PiCameraBold className="text-2xl text-[var(--fg-subtle)]" />
          )}
          <span className="text-sm font-medium text-[var(--fg)]">
            {working ? "Preparing the photo…" : "Photograph the cash"}
          </span>
          <span className="max-w-[28ch] text-xs leading-relaxed text-[var(--fg-muted)]">
            Lay the notes out flat so none overlap, in good light. Every note
            should be visible.
          </span>
        </button>
      )}

      {error ? <p className="text-xs text-[var(--negative)]">{error}</p> : null}

      {value ? (
        <Surface kind="sunken" padding="sm" radius="xl">
          <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
            We read the photo to check the amount and to catch the same notes
            being pledged twice. We keep a fingerprint of it, not the picture.
          </p>
        </Surface>
      ) : null}
    </div>
  );
}

/**
 * Downscale and re-encode, in the browser.
 *
 * Uses createImageBitmap, which decodes off the main thread, so the page does
 * not freeze while a 12-megapixel photograph is being read on a mid-range
 * phone. The canvas path after it is cheap by comparison.
 */
async function downscale(file: File): Promise<Capture> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That is not a photo.");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the photo.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );
  if (!blob) throw new Error("This browser could not prepare the photo.");

  return {
    base64: await toBase64(blob),
    previewUrl: URL.createObjectURL(blob),
    bytes: blob.size,
  };
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the "data:image/jpeg;base64," prefix; the API takes raw base64.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
