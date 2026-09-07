"use client";

import { useCallback, useEffect, useState } from "react";
import type { LatLng } from "./mercator";

export type LocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; at: LatLng; accuracyM: number }
  | { status: "denied" }
  | { status: "unavailable"; reason: string };

/**
 * Where the user is.
 *
 * Every screen in the cash flow needs this, and each of them needs it for a
 * different reason: a pledge is recorded at a location, an agent search is
 * ranked by distance from one, and a handover is only offered within walking
 * distance. So it is one hook with one state machine rather than three
 * `navigator.geolocation` calls with three ideas of what "no location" means.
 *
 * The four failures are kept apart because the user can act on three of them
 * and not on the fourth:
 *
 *   denied       they said no, and can change that in browser settings
 *   unavailable  the device cannot answer -- no fix, no sensor, insecure page
 *   locating     still trying
 *   idle         nobody has asked yet
 *
 * Collapsing them into "no location" produces the unhelpful screen that tells
 * somebody to enable permissions they already granted.
 */
export function useLocation(options?: { watch?: boolean }) {
  const [state, setState] = useState<LocationState>({ status: "idle" });

  const handle = useCallback((position: GeolocationPosition) => {
    setState({
      status: "ready",
      at: { lat: position.coords.latitude, lng: position.coords.longitude },
      accuracyM: position.coords.accuracy,
    });
  }, []);

  const fail = useCallback((error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) {
      setState({ status: "denied" });
      return;
    }
    setState({
      status: "unavailable",
      reason:
        error.code === error.TIMEOUT
          ? "Finding you took too long. Try again somewhere with a clearer view of the sky."
          : "This device could not work out where it is.",
    });
  }, []);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({
        status: "unavailable",
        reason: "This browser cannot share a location.",
      });
      return;
    }
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(handle, fail, {
      // A pledge and a handover both depend on being at a particular counter,
      // so a coarse network fix is not good enough.
      enableHighAccuracy: true,
      timeout: 15_000,
      // Never reuse a cached position. Somebody who walked to an agent and
      // reopens the app must not be matched from where they set off.
      maximumAge: 0,
    });
  }, [handle, fail]);

  useEffect(() => {
    if (!options?.watch) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(handle, fail, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
    return () => navigator.geolocation.clearWatch(id);
  }, [options?.watch, handle, fail]);

  return { state, request };
}

/** The coordinate, when there is one. */
export const locationOf = (s: LocationState): LatLng | null =>
  s.status === "ready" ? s.at : null;
