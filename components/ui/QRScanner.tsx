"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PiXBold, PiCameraSlashFill } from "react-icons/pi";

interface QRScannerProps {
  onResult: (text: string) => void;
  onClose: () => void;
}

/**
 * Full-screen camera viewfinder. Uses `html5-qrcode`, which speaks
 * to MediaDevices directly — no React-flavored wrapper, so it stays
 * out of our render loop. We stop the camera on unmount / on first
 * successful decode.
 */
export function QRScanner({ onResult, onClose }: QRScannerProps) {
  const containerId = useRef(
    "qrscanner-" + Math.random().toString(36).slice(2, 9),
  );
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let stopped = false;
    let scannerRef: { stop: () => Promise<void>; clear: () => void } | null = null;

    async function start() {
      try {
        const mod = await import("html5-qrcode");
        if (stopped) return;
        const scanner = new mod.Html5Qrcode(containerId.current);
        scannerRef = {
          stop:  () => scanner.stop(),
          clear: () => scanner.clear(),
        };

        const cameras = await mod.Html5Qrcode.getCameras();
        if (cameras.length === 0) {
          setError("No camera found on this device.");
          return;
        }
        // Prefer the rear-facing camera when label hints suggest it.
        const back = cameras.find((c) =>
          /back|rear|environment/i.test(c.label),
        );
        const cameraId = back?.id ?? cameras[0].id;

        await scanner.start(
          cameraId,
          { fps: 12, qrbox: 240 },
          (decoded) => {
            if (stopped) return;
            stopped = true;
            scanner.stop().then(() => scanner.clear()).catch(() => undefined);
            onResult(decoded);
          },
          () => undefined,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Camera unavailable";
        setError(msg);
      }
    }

    void start();
    return () => {
      stopped = true;
      if (scannerRef) {
        scannerRef
          .stop()
          .then(() => scannerRef?.clear())
          .catch(() => undefined);
      }
    };
  }, [onResult]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[160] flex flex-col bg-neutral-900 text-white">
      <div className="flex items-center justify-between p-4">
        <span className="text-sm font-medium">Aim at the merchant&apos;s QR</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="rounded-full p-2 transition-colors hover:bg-white/10"
        >
          <PiXBold />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div id={containerId.current} className="h-full w-full" />
        {!error ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="size-60 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-neutral-900/90 p-8 text-center">
            <div className="grid gap-3">
              <PiCameraSlashFill className="mx-auto text-3xl text-white/60" />
              <p className="text-sm text-white/80">{error}</p>
              <p className="text-xs text-white/50">
                Grant camera permission and reload, or paste an order URL.
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="border-t border-white/10 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-xs text-white/50">
        We never see your camera feed — scanning runs entirely on your device.
      </p>
    </div>,
    document.body,
  );
}
