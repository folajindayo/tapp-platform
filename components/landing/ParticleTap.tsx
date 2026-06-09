"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Hero particle scene — a card tapping a phone, drawn entirely in
 * dots so it keeps the two interactions from the globe it replaced:
 *
 * 1. Pointer repulsion — every projected dot carries a screen-space
 *    displacement + velocity. Dots inside the pointer's radius get
 *    pushed away; a spring pulls them home with damping, so a moving
 *    cursor leaves a wake that heals behind it.
 *
 * 2. Scroll dispersion — the canvas reads scroll progress from the
 *    tall hero track (`trackRef`, 0 → 1 across the pinned range) and
 *    flings each dot radially outward from the scene center, scaled
 *    by a per-dot speed. Fully reversible: position is a pure
 *    function of p, so scrolling back re-forms the scene.
 *
 * The tap loop: the card eases in from the lower right, holds against
 * the phone's upper screen while blue NFC ripple rings pulse out of
 * the contact point (and the pay pill brightens), then eases back.
 * The whole scene slowly yaws so the dot field reads as 3D.
 */

type Dot = {
  /** local position — group transform turns this into world space */
  x: number;
  y: number;
  z: number;
  size: number;
  color: string;
  group: "scene" | "card" | "ring" | "stream" | "ambient";
  /** per-group extra: ring index, stream offset, twinkle phase */
  aux: number;
  /** dispersion speed multiplier — how far this dot flies at p=1 */
  speed: number;
  /** screen-space repulsion displacement + velocity */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
};

const TILT = 0.18;
const YAW_AMPLITUDE = 0.2; // rad — gentle oscillation, not a spin
const YAW_RATE = 0.45;

/** one tap cycle: approach → hold (ripples) → retreat → rest */
const TAP_PERIOD = 3.0; // s

// Pointer field — equilibrium displacement ≈ FORCE / SPRING ≈ 25px,
// a local dimple that heals quickly, not a swept-out void.
const REPULSE_RADIUS = 90; // px
const REPULSE_FORCE = 2.5;
const SPRING = 0.1;
const DAMPING = 0.85;

// Card travel (scene units): rest pose lower-right → contact on the
// phone's upper screen. The ripple rings live at the contact point.
const CARD_REST = { x: 0.95, y: -0.82, z: 0.2, tilt: -0.5 };
const CARD_CONTACT = { x: 0.1, y: -0.46, z: 0.14, tilt: -0.22 };
const RING_CENTER = { x: 0.1, y: -0.48, z: 0.15 };
/** pay pill center — the payment stream flows here from the contact */
const PILL = { x: -0.18, y: 0.58, z: 0.04 };

// Dot palette — mostly white line work with multi-colour accents
// sprinkled through (~1 in 4 dots takes a colour).
const NEUTRAL = "#dfe3ea";
const BLUE = "#6ba2ff";
const ACCENTS = [BLUE, "#9ec5ff", "#8f7bff", "#3fd9c4", "#ffd166", "#ff8fa3"];
const ACCENT_RATIO = 0.25;

/** Deterministic PRNG so the dot field is identical on every mount. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

type Pt = { x: number; y: number };

/** Points spaced ~`step` apart along a rounded-rect perimeter. */
function roundedRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
  step: number,
): Pt[] {
  const ex = w / 2 - r; // straight half-extents
  const ey = h / 2 - r;
  type Seg = { len: number; at: (d: number) => Pt };
  const line = (x1: number, y1: number, x2: number, y2: number): Seg => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    return {
      len,
      at: (d) => ({ x: x1 + ((x2 - x1) * d) / len, y: y1 + ((y2 - y1) * d) / len }),
    };
  };
  const arc = (ax: number, ay: number, a0: number): Seg => ({
    len: (Math.PI / 2) * r,
    at: (d) => {
      const a = a0 + (d / ((Math.PI / 2) * r)) * (Math.PI / 2);
      return { x: ax + r * Math.cos(a), y: ay + r * Math.sin(a) };
    },
  });
  const segs: Seg[] = [
    line(cx - ex, cy - h / 2, cx + ex, cy - h / 2),
    arc(cx + ex, cy - ey, -Math.PI / 2),
    line(cx + w / 2, cy - ey, cx + w / 2, cy + ey),
    arc(cx + ex, cy + ey, 0),
    line(cx + ex, cy + h / 2, cx - ex, cy + h / 2),
    arc(cx - ex, cy + ey, Math.PI / 2),
    line(cx - w / 2, cy + ey, cx - w / 2, cy - ey),
    arc(cx - ex, cy - ey, Math.PI),
  ];
  const total = segs.reduce((s, g) => s + g.len, 0);
  const count = Math.ceil(total / step);
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    let d = (i / count) * total;
    for (const seg of segs) {
      if (d <= seg.len) {
        pts.push(seg.at(d));
        break;
      }
      d -= seg.len;
    }
  }
  return pts;
}

function lineDots(x1: number, y1: number, x2: number, y2: number, step: number): Pt[] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const count = Math.max(2, Math.round(len / step));
  return Array.from({ length: count }, (_, i) => ({
    x: x1 + ((x2 - x1) * i) / (count - 1),
    y: y1 + ((y2 - y1) * i) / (count - 1),
  }));
}

function arcDots(cx: number, cy: number, r: number, a0: number, a1: number, count: number): Pt[] {
  return Array.from({ length: count }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / (count - 1);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function buildDots(): Dot[] {
  const rand = mulberry32(7);
  const dots: Dot[] = [];
  const accent = () =>
    rand() < ACCENT_RATIO
      ? ACCENTS[Math.floor(rand() * ACCENTS.length)]
      : NEUTRAL;
  const push = (
    x: number,
    y: number,
    z: number,
    size: number,
    color: string,
    group: Dot["group"] = "scene",
    aux = 0,
  ) =>
    dots.push({
      x,
      y,
      z,
      size,
      color,
      group,
      aux,
      speed: 0.5 + rand() * 1.7,
      ox: 0,
      oy: 0,
      vx: 0,
      vy: 0,
    });

  // ── Phone (centered slightly left, facing the viewer) ──
  const PX = -0.18;
  const PY = 0.1;
  // body outline — front face, plus a sparser back layer for depth
  for (const p of roundedRect(PX, PY, 0.95, 1.75, 0.16, 0.012))
    push(
      p.x,
      p.y,
      (rand() - 0.5) * 0.03,
      0.9 + rand() * 1.0,
      accent(),
    );
  for (const p of roundedRect(PX, PY, 0.95, 1.75, 0.16, 0.026))
    push(p.x, p.y, -0.1, 0.6 + rand() * 0.7, accent());
  // screen inset
  for (const p of roundedRect(PX, PY, 0.78, 1.58, 0.1, 0.022))
    push(p.x, p.y, 0.01, 0.7 + rand() * 0.8, accent());
  // speaker slit
  for (const p of lineDots(PX - 0.1, -0.66, PX + 0.1, -0.66, 0.018))
    push(p.x, p.y, 0.02, 0.8, accent());
  // amount line (big) + label line (small) — abstract checkout UI
  for (const p of lineDots(PX - 0.24, -0.28, PX + 0.24, -0.28, 0.018))
    push(p.x, p.y, 0.02, 1.5 + rand() * 0.5, accent());
  for (const p of lineDots(PX - 0.16, -0.13, PX + 0.16, -0.13, 0.02))
    push(p.x, p.y, 0.02, 0.8, accent());
  // pay pill — blue, brightens when the tap lands
  for (const p of roundedRect(PX, 0.58, 0.56, 0.17, 0.085, 0.014))
    push(p.x, p.y, 0.02, 1.0 + rand() * 0.8, BLUE);
  for (const p of lineDots(PX - 0.14, 0.58, PX + 0.14, 0.58, 0.025))
    push(p.x, p.y, 0.02, 0.9, BLUE);

  // ── Card (local coords around its own center; animated per frame) ──
  for (const p of roundedRect(0, 0, 0.95, 0.6, 0.09, 0.012))
    push(
      p.x,
      p.y,
      0,
      0.9 + rand() * 1.0,
      accent(),
      "card",
    );
  // contactless mark — NFC card, no chip
  [0.05, 0.09, 0.13].forEach((r, i) => {
    for (const p of arcDots(0.28, -0.06, r, -Math.PI / 4, Math.PI / 4, 6 + i * 4))
      push(p.x, p.y, 0.01, 0.9, BLUE, "card");
  });
  // number row
  for (const p of lineDots(-0.34, 0.18, 0.34, 0.18, 0.034))
    push(p.x, p.y, 0.01, 0.8, accent(), "card");

  // ── NFC ripple rings (local circles; scaled + faded per frame) ──
  for (let ring = 0; ring < 4; ring++) {
    const n = 22 + ring * 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      push(Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0, 1.1, BLUE, "ring", ring);
    }
  }

  // ── Payment stream — dots flowing contact → pay pill; aux phases ──
  for (let i = 0; i < 42; i++)
    push(0, 0, 0, 1.3 + rand() * 1.0, accent(), "stream", i / 42);

  // ── Ambient field — faint twinkling texture; aux is the phase ──
  for (let i = 0; i < 1500; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.3 + Math.sqrt(rand()) * 1.7;
    push(
      Math.cos(a) * r,
      Math.sin(a) * r * 0.85,
      (rand() - 0.5) * 0.8,
      0.5 + rand() * 0.9,
      accent(),
      "ambient",
      rand() * Math.PI * 2,
    );
  }

  return dots;
}

export function ParticleTap({
  trackRef,
  className,
}: {
  /** the tall (>100vh) hero wrapper whose scroll range drives dispersion */
  trackRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dots = buildDots();
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // Physics + drawing happen in CSS px; scale once here.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Pointer in canvas coords; parked far away when not hovering.
    const pointer = { x: -1e4, y: -1e4 };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    };
    const onPointerLeave = () => {
      pointer.x = -1e4;
      pointer.y = -1e4;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerLeave, { passive: true });

    /** 0 → 1 across the pinned scroll range of the hero track. */
    const scrollProgress = () => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      if (range <= 0) return 0;
      return Math.min(1, Math.max(0, -rect.top / range));
    };

    const cosT = Math.cos(TILT);
    const sinT = Math.sin(TILT);

    const draw = (sec: number, p: number, physics: boolean) => {
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height * 0.55; // sits below the heading
      const radius = Math.min(Math.min(width, height) * 0.34, 290);
      const fade = 1 - p * 0.55;

      // Tap cycle: approach → hold (ripple ∈ [0,1]) → retreat → rest.
      const cyc = (sec % TAP_PERIOD) / TAP_PERIOD;
      let a: number;
      let ripple = -1;
      if (cyc < 0.32) a = easeInOut(cyc / 0.32);
      else if (cyc < 0.55) {
        a = 1;
        ripple = (cyc - 0.32) / 0.23;
      } else if (cyc < 0.85) a = 1 - easeInOut((cyc - 0.55) / 0.3);
      else a = 0;

      // The card breathes at rest; the bob fades out as it approaches.
      const bob = Math.sin(sec * 1.5) * 0.02 * (1 - a);
      const cardX = CARD_REST.x + (CARD_CONTACT.x - CARD_REST.x) * a;
      const cardY = CARD_REST.y + (CARD_CONTACT.y - CARD_REST.y) * a + bob;
      const cardZ = CARD_REST.z + (CARD_CONTACT.z - CARD_REST.z) * a;
      const cardTilt = CARD_REST.tilt + (CARD_CONTACT.tilt - CARD_REST.tilt) * a;
      const cosC = Math.cos(cardTilt);
      const sinC = Math.sin(cardTilt);

      const yaw = YAW_AMPLITUDE * Math.sin(sec * YAW_RATE);
      const cosA = Math.cos(yaw);
      const sinA = Math.sin(yaw);

      // Pay pill flashes while the tap is held; the whole phone gets a
      // gentler version of the same flash.
      const payBoost = ripple >= 0 ? (1 - ripple) * 0.6 : 0;
      const screenBoost = ripple >= 0 ? (1 - ripple) * 0.22 : 0;
      // Payment stream runs from contact through the retreat (longer
      // than the ripple window so the flow reads as continuous).
      const flow = cyc >= 0.32 && cyc < 0.82 ? (cyc - 0.32) / 0.5 : -1;

      for (const d of dots) {
        // Group transform: local → scene space.
        let wx = d.x;
        let wy = d.y;
        let wz = d.z;
        let groupAlpha = 1;
        if (d.group === "card") {
          wx = cardX + d.x * cosC - d.y * sinC;
          wy = cardY + d.x * sinC + d.y * cosC;
          wz = cardZ + d.z;
        } else if (d.group === "ring") {
          // staggered expanding pulses, only visible while held
          const rp = ripple < 0 ? -1 : ripple * 1.45 - d.aux * 0.16;
          if (rp <= 0 || rp >= 1) continue;
          const s = 0.6 + rp * 1.1;
          wx = RING_CENTER.x + d.x * s;
          wy = RING_CENTER.y + d.y * s;
          wz = RING_CENTER.z;
          groupAlpha = 1 - rp;
        } else if (d.group === "stream") {
          // dots flowing contact → pay pill with a slight S-curve
          if (flow < 0) continue;
          const t = (flow * 1.8 + d.aux) % 1;
          wx =
            RING_CENTER.x +
            (PILL.x - RING_CENTER.x) * t +
            Math.sin(t * Math.PI * 3 + d.aux * 6) * 0.05;
          wy = RING_CENTER.y + (PILL.y - RING_CENTER.y) * t;
          wz = RING_CENTER.z + (PILL.z - RING_CENTER.z) * t;
          groupAlpha = Math.sin(Math.PI * t) * Math.sin(Math.PI * flow) * 1.2;
        } else if (d.group === "ambient") {
          groupAlpha = 0.75 + 0.25 * Math.sin(sec * 1.8 + d.aux);
        }

        // Gentle yaw around Y, then tilt around X.
        const x1 = wx * cosA + wz * sinA;
        const z1 = -wx * sinA + wz * cosA;
        const y1 = wy * cosT - z1 * sinT;
        const z2 = wy * sinT + z1 * cosT;

        // Dispersion: fly outward from the scene center.
        const r = Math.hypot(x1, y1) || 1;
        const disp = p * (0.4 + d.speed * 2.6);
        const dx1 = x1 + (x1 / r) * disp;
        const dy1 = y1 + (y1 / r) * disp;

        // Perspective divide — camera sits at z = 2.4R.
        const persp = 2.4 / (2.4 - z2);
        let px = cx + dx1 * radius * persp;
        let py = cy + dy1 * radius * persp;

        if (physics) {
          // Pointer repulsion with spring-back.
          const dx = px - pointer.x;
          const dy = py - pointer.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < REPULSE_RADIUS * REPULSE_RADIUS && dist2 > 0.01) {
            const dist = Math.sqrt(dist2);
            const f = 1 - dist / REPULSE_RADIUS;
            const force = (f * f * REPULSE_FORCE) / dist;
            d.vx += dx * force;
            d.vy += dy * force;
          }
          d.vx -= d.ox * SPRING;
          d.vy -= d.oy * SPRING;
          d.vx *= DAMPING;
          d.vy *= DAMPING;
          d.ox += d.vx;
          d.oy += d.vy;
          px += d.ox;
          py += d.oy;
        }

        // Near-planar scene: brightness leans on z but never goes dim
        // the way the sphere's far side did.
        const depth = Math.min(1, Math.max(0, z2 * 1.5 + 0.5));
        // Effect layers (rings/stream) skip the depth dimming —
        // they're the action and must read over the line work.
        const effect = d.group === "ring" || d.group === "stream";
        let alpha = effect
          ? Math.min(1, 0.9 * fade * groupAlpha)
          : (0.22 + depth * 0.62) * fade * groupAlpha;
        if (d.group === "scene")
          alpha = Math.min(
            1,
            alpha * (1 + (d.color === BLUE ? payBoost : 0) + screenBoost),
          );
        const size = d.size * (0.7 + depth * 0.5) * (1 - p * 0.3);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = d.color;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let smoothP = 0;

    if (reduced) {
      // Static frame at the moment of contact, mid-ripple.
      draw(TAP_PERIOD * 0.43, 0, false);
    } else {
      const loop = (now: number) => {
        // Ease toward the raw scroll progress so fast flicks stay smooth.
        smoothP += (scrollProgress() - smoothP) * 0.12;
        draw(now / 1000, smoothP, true);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerLeave);
    };
  }, [trackRef]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
