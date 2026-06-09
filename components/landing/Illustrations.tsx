/**
 * Blueprint-style schematic illustrations for the platform section —
 * thin neutral strokes, sparse dotted detail, royal-blue / indigo
 * accent fills. All share a 320×180 viewBox and the corner crop-marks
 * so the grid reads as one drafting sheet.
 */

const INK = "#3f3f46";
const ROYAL = "#0065F5";
const INDIGO = "#4f46e5";

function Marks() {
  return (
    <g stroke={INK} strokeOpacity={0.35}>
      {(
        [
          [16, 16],
          [304, 16],
          [16, 164],
          [304, 164],
        ] as const
      ).map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <line x1={x - 5} y1={y} x2={x + 5} y2={y} />
          <line x1={x} y1={y - 5} x2={x} y2={y + 5} />
        </g>
      ))}
    </g>
  );
}

const svgProps = {
  viewBox: "0 0 320 180",
  fill: "none",
  strokeWidth: 1,
  className: "h-full w-auto max-w-full",
  "aria-hidden": true,
} as const;

/** Speed gauge + LED bar — instant, low-cost settlement. */
export function IllInstant() {
  const ticks = [
    [104, 120],
    [108.3, 98.6],
    [120.4, 80.4],
    [138.6, 68.3],
    [160, 64],
    [181.4, 68.3],
    [199.6, 80.4],
    [211.7, 98.6],
    [216, 120],
  ];
  return (
    <svg {...svgProps}>
      <Marks />
      {/* gauge arcs */}
      <path d="M 117 120 A 43 43 0 0 1 203 120" stroke={INK} strokeOpacity={0.55} />
      <path d="M 129 120 A 31 31 0 0 1 191 120" stroke={INK} strokeOpacity={0.3} strokeDasharray="2 4" />
      {ticks.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.4} fill={INK} fillOpacity={0.5} />
      ))}
      {/* needle */}
      <line x1={160} y1={120} x2={130} y2={90} stroke={ROYAL} strokeWidth={1.8} />
      <circle cx={160} cy={120} r={3} fill={ROYAL} />
      {/* flanking guides */}
      <line x1={38} y1={120} x2={98} y2={120} stroke={INK} strokeOpacity={0.35} strokeDasharray="2 4" />
      <line x1={222} y1={120} x2={282} y2={120} stroke={INK} strokeOpacity={0.35} strokeDasharray="2 4" />
      <rect x={34} y={117.5} width={5} height={5} fill={INK} fillOpacity={0.4} />
      <circle cx={284} cy={120} r={2.5} stroke={INK} strokeOpacity={0.5} />
      {/* LED bar */}
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          x={89 + i * 12}
          y={140}
          width={9}
          height={9}
          rx={1.5}
          fill={i < 7 ? ROYAL : "none"}
          fillOpacity={i < 7 ? 1 - i * 0.1 : undefined}
          stroke={i < 7 ? undefined : INK}
          strokeOpacity={i < 7 ? undefined : 0.4}
        />
      ))}
      {/* scatter */}
      <rect x={60} y={52} width={3} height={3} fill={INK} fillOpacity={0.35} />
      <rect x={252} y={42} width={3} height={3} fill={INK} fillOpacity={0.35} />
      <circle cx={278} cy={66} r={1.5} fill={INK} fillOpacity={0.35} />
    </svg>
  );
}

/** USDC coin → routing matrix → bank — settlement without custody. */
export function IllSettlement() {
  return (
    <svg {...svgProps}>
      <Marks />
      {/* annotation dot row */}
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx={100 + i * 11} cy={36} r={1.1} fill={INK} fillOpacity={0.35} />
      ))}
      {/* USDC coin */}
      <circle cx={60} cy={90} r={16} fill={ROYAL} />
      <text x={60} y={95} textAnchor="middle" fontSize={13} fontWeight={600} fill="#fff">
        $
      </text>
      <circle cx={60} cy={90} r={22} stroke={INK} strokeOpacity={0.3} strokeDasharray="2 4" />
      {/* flow → matrix */}
      <line x1={86} y1={90} x2={122} y2={90} stroke={INK} strokeOpacity={0.55} strokeDasharray="3 4" />
      <path d="M 120 86 L 126 90 L 120 94" stroke={INK} strokeOpacity={0.55} />
      {/* routing matrix */}
      <rect x={128} y={62} width={64} height={56} rx={6} stroke={INK} strokeOpacity={0.45} strokeDasharray="4 4" />
      {[78, 90, 102].map((y) =>
        [144, 160, 176].map((x) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r={2}
            fill={x === 160 && y === 90 ? ROYAL : INK}
            fillOpacity={x === 160 && y === 90 ? 1 : 0.45}
          />
        )),
      )}
      {/* flow → bank */}
      <line x1={198} y1={90} x2={226} y2={90} stroke={INK} strokeOpacity={0.55} strokeDasharray="3 4" />
      <path d="M 224 86 L 230 90 L 224 94" stroke={INK} strokeOpacity={0.55} />
      {/* bank */}
      <polyline points="232,70 260,54 288,70" stroke={INK} strokeOpacity={0.55} />
      <rect x={232} y={70} width={56} height={44} rx={3} stroke={INK} strokeOpacity={0.55} />
      {[246, 274].map((x) => (
        <line key={x} x1={x} y1={80} x2={x} y2={104} stroke={INK} strokeOpacity={0.35} />
      ))}
      <rect x={252} y={82} width={16} height={16} rx={4} fill={INDIGO} />
      <text x={260} y={93.5} textAnchor="middle" fontSize={9} fontWeight={600} fill="#fff">
        ₦
      </text>
      {/* baseline guide */}
      <line x1={60} y1={138} x2={260} y2={138} stroke={INK} strokeOpacity={0.3} strokeDasharray="2 5" />
      <rect x={57} y={135.5} width={5} height={5} fill={INK} fillOpacity={0.35} />
      <circle cx={262} cy={138} r={2} stroke={INK} strokeOpacity={0.45} />
    </svg>
  );
}

/** Google → keyhole vault ringed by dots → fingerprint — keyless custody. */
export function IllCustody() {
  const ringDots = Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI * 2) / 16;
    return [160 + 50 * Math.cos(a), 90 + 50 * Math.sin(a)];
  });
  return (
    <svg {...svgProps}>
      <Marks />
      {/* outer dotted ring */}
      {ringDots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.3} fill={INK} fillOpacity={0.45} />
      ))}
      <circle cx={160} cy={90} r={34} stroke={INK} strokeOpacity={0.35} strokeDasharray="3 5" />
      <circle cx={160} cy={90} r={20} stroke={INK} strokeOpacity={0.55} />
      {/* keyhole vault */}
      <rect x={148} y={78} width={24} height={24} rx={6} fill={ROYAL} />
      <circle cx={160} cy={87} r={3.5} fill="#fff" />
      <rect x={158.6} y={89} width={2.8} height={7} rx={1.4} fill="#fff" />
      {/* Google entry */}
      <circle cx={52} cy={90} r={14} stroke={INK} strokeOpacity={0.55} />
      <text x={52} y={94.5} textAnchor="middle" fontSize={12} fontWeight={500} fill={INK} fillOpacity={0.7}>
        G
      </text>
      <line x1={70} y1={90} x2={102} y2={90} stroke={INK} strokeOpacity={0.5} strokeDasharray="3 4" />
      <path d="M 100 86 L 106 90 L 100 94" stroke={INK} strokeOpacity={0.5} />
      {/* fingerprint step-up */}
      <line x1={216} y1={90} x2={242} y2={90} stroke={INK} strokeOpacity={0.5} strokeDasharray="3 4" />
      <path d="M 240 86 L 246 90 L 240 94" stroke={INK} strokeOpacity={0.5} />
      <path d="M 256 96 A 10 10 0 1 1 276 96" stroke={INDIGO} strokeOpacity={0.9} />
      <path d="M 251 100 A 15 15 0 1 1 281 100" stroke={INK} strokeOpacity={0.5} />
      <path d="M 261 93 A 5 5 0 1 1 271 93" stroke={INK} strokeOpacity={0.5} />
      <circle cx={266} cy={94} r={1.5} fill={INDIGO} />
      {/* scatter */}
      <rect x={88} y={42} width={3} height={3} fill={INK} fillOpacity={0.35} />
      <circle cx={236} cy={46} r={1.5} fill={INK} fillOpacity={0.35} />
    </svg>
  );
}

/** Phone ↔ NFC arcs ↔ card — no terminals, no app store. */
export function IllHardware() {
  return (
    <svg {...svgProps}>
      <Marks />
      {/* phone */}
      <rect x={92} y={40} width={52} height={100} rx={10} stroke={INK} strokeOpacity={0.55} />
      <line x1={108} y1={48} x2={128} y2={48} stroke={INK} strokeOpacity={0.45} />
      <line x1={102} y1={66} x2={134} y2={66} stroke={INK} strokeOpacity={0.3} />
      <line x1={102} y1={76} x2={126} y2={76} stroke={INK} strokeOpacity={0.3} />
      <rect x={102} y={106} width={32} height={11} rx={3} fill={ROYAL} fillOpacity={0.9} />
      <circle cx={118} cy={131} r={2} stroke={INK} strokeOpacity={0.45} />
      {/* NFC arcs */}
      <path d="M 158 78 A 10 10 0 0 1 158 94" stroke={ROYAL} strokeOpacity={0.9} />
      <path d="M 164 71 A 17 17 0 0 1 164 101" stroke={ROYAL} strokeOpacity={0.55} />
      <path d="M 170 64 A 24 24 0 0 1 170 108" stroke={ROYAL} strokeOpacity={0.3} />
      {/* tap card */}
      <rect x={188} y={64} width={68} height={44} rx={6} stroke={INK} strokeOpacity={0.55} />
      <line x1={188} y1={76} x2={256} y2={76} stroke={INK} strokeOpacity={0.35} />
      <rect x={196} y={86} width={11} height={8} rx={2} fill={INDIGO} />
      {Array.from({ length: 8 }, (_, i) => (
        <circle key={i} cx={198 + i * 7} cy={101} r={1} fill={INK} fillOpacity={0.45} />
      ))}
      {/* guides */}
      <line x1={60} y1={152} x2={260} y2={152} stroke={INK} strokeOpacity={0.3} strokeDasharray="2 5" />
      <rect x={57} y={149.5} width={5} height={5} fill={INK} fillOpacity={0.35} />
      <circle cx={262} cy={152} r={2} stroke={INK} strokeOpacity={0.45} />
      {/* scatter */}
      <rect x={64} y={50} width={3} height={3} fill={INK} fillOpacity={0.35} />
      <circle cx={272} cy={44} r={1.5} fill={INK} fillOpacity={0.35} />
      <rect x={282} y={120} width={3} height={3} fill={INK} fillOpacity={0.35} />
    </svg>
  );
}
