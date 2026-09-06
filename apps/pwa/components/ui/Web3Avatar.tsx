"use client";

import React, { useMemo } from "react";

const FALLBACK_COLORS = [
  "rgb(233, 30, 99)",
  "rgb(156, 39, 176)",
  "rgb(63, 81, 181)",
  "rgb(33, 150, 243)",
  "rgb(76, 175, 80)",
  "rgb(255, 152, 0)",
];

const MESH_POINT_COUNT = 6;

const getHexFromRgb = (rgbStr: string): string => {
  const matches = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!matches) return "#ff00ff";
  const [, r, g, b] = matches;
  return `#${Number(r).toString(16).padStart(2, "0")}${Number(g).toString(16).padStart(2, "0")}${Number(b).toString(16).padStart(2, "0")}`;
};

const hashCode = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
};

function getFnv32Hash(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  const prime = 0x01000193; // FNV prime
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, prime);
  }
  return hash >>> 0;
}

function getColorFromHex(hex: string): { r: number; g: number; b: number } {
  const fnv = getFnv32Hash(hex);
  return {
    r: (fnv & 0xff0000) >> 16,
    g: (fnv & 0x00ff00) >> 8,
    b: fnv & 0x0000ff,
  };
}

export function generateGradientColors(address: string): string[] {
  if (!address || typeof address !== "string") {
    return ["rgb(233, 30, 99)", "rgb(156, 39, 176)", "rgb(63, 81, 181)"];
  }
  const normalizedAddress = address.startsWith("0x") ? address : `0x${address}`;
  const cleanAddress = normalizedAddress.toLowerCase().replace(/^0x/, "");

  const rgbColors = [
    getColorFromHex(cleanAddress.substring(0, 10)),
    getColorFromHex(cleanAddress.substring(10, 20)),
    getColorFromHex(cleanAddress.substring(20, 30) || cleanAddress.substring(0, 10)),
  ];

  return rgbColors.map((color) => `rgb(${color.r}, ${color.g}, ${color.b})`);
}

export interface Web3AvatarProps {
  address: string;
  size?: number;
  borderRadius?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Web3Avatar generates unique gradient avatars from Ethereum/Sui addresses or string identifiers
 * with a static mesh gradient effect for visual depth on the web.
 */
export function Web3Avatar({
  address,
  size = 40,
  borderRadius,
  className,
  style,
}: Web3AvatarProps) {
  const safeAddress = useMemo(() => {
    return address || "0x0000000000000000000000000000000000000000";
  }, [address]);

  // Clean the address/string to produce a safe DOM ID segment (only alphanumeric)
  const safeIdSegment = useMemo(() => {
    return safeAddress.replace(/[^a-zA-Z0-9]/g, "");
  }, [safeAddress]);

  const finalBorderRadius = borderRadius ?? size / 2;

  const generatedColors = useMemo(() => {
    return generateGradientColors(safeAddress);
  }, [safeAddress]);

  const meshColors = useMemo(() => {
    const colors = [...generatedColors];
    while (colors.length < MESH_POINT_COUNT) {
      const idx = colors.length % generatedColors.length;
      const baseColor = generatedColors[idx] || FALLBACK_COLORS[idx];
      const matches = baseColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);

      if (matches) {
        const [, r, g, b] = matches.map(Number);
        const newColor = `rgb(${Math.min(255, (r + 50) % 255)}, ${Math.min(255, (g + 70) % 255)}, ${Math.min(255, (b + 90) % 255)})`;
        colors.push(newColor);
      } else {
        colors.push(FALLBACK_COLORS[colors.length]);
      }
    }
    return colors.map(getHexFromRgb);
  }, [generatedColors]);

  const meshPositions = useMemo(() => {
    const seed = hashCode(safeAddress);
    const seededRandom = (seedVal: number, index: number) => {
      const x = Math.sin(seedVal + index) * 10000;
      return x - Math.floor(x);
    };

    const points = [];
    for (let i = 0; i < MESH_POINT_COUNT; i++) {
      points.push({
        x: 15 + seededRandom(seed, i * 2) * 70,
        y: 15 + seededRandom(seed, i * 2 + 1) * 70,
        color: meshColors[i % meshColors.length],
      });
    }
    return points;
  }, [safeAddress, meshColors]);

  const baseFillId = `baseFill-${safeIdSegment}`;
  const highlightId = `highlight-${safeIdSegment}`;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: finalBorderRadius,
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <defs>
          <radialGradient id={baseFillId} cx="50%" cy="50%" r="70%" fx="50%" fy="50%">
            <stop offset="0%" stopColor={meshColors[0]} />
            <stop offset="100%" stopColor={meshColors[1]} />
          </radialGradient>

          {meshPositions.map((point, idx) => (
            <radialGradient
              key={`grad-${idx}`}
              id={`grad-${safeIdSegment}-${idx}`}
              cx={`${point.x}%`}
              cy={`${point.y}%`}
              r="55%"
              fx={`${point.x}%`}
              fy={`${point.y}%`}
            >
              <stop offset="0%" stopColor={point.color} stopOpacity="0.85" />
              <stop offset="40%" stopColor={point.color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={point.color} stopOpacity="0" />
            </radialGradient>
          ))}

          <linearGradient id={highlightId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.25" />
            <stop offset="50%" stopColor="white" stopOpacity="0.05" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Base shape */}
        <rect
          x="0"
          y="0"
          width={size}
          height={size}
          fill={`url(#${baseFillId})`}
          rx={finalBorderRadius}
          ry={finalBorderRadius}
        />

        {/* Mesh overlay points */}
        {meshPositions.map((_, idx) => (
          <rect
            key={`overlay-${idx}`}
            x="0"
            y="0"
            width={size}
            height={size}
            fill={`url(#grad-${safeIdSegment}-${idx})`}
            rx={finalBorderRadius}
            ry={finalBorderRadius}
          />
        ))}

        {/* Highlight Overlay */}
        <rect
          x="0"
          y="0"
          width={size}
          height={size}
          fill={`url(#${highlightId})`}
          rx={finalBorderRadius}
          ry={finalBorderRadius}
        />

        {/* Subtle white inner rim light */}
        <rect
          x="0.5"
          y="0.5"
          width={size - 1}
          height={size - 1}
          stroke="white"
          strokeWidth="0.5"
          strokeOpacity="0.2"
          fill="none"
          rx={Math.max(0, finalBorderRadius - 0.5)}
          ry={Math.max(0, finalBorderRadius - 0.5)}
        />
      </svg>
    </div>
  );
}
