'use client';

import React, { useId } from 'react';

type Props = {
  series: number[];
  height?: number;
  strokeWidth?: number;
  fill?: boolean;
  /** render a faint baseline grid — used on the coin page, not on cards */
  grid?: boolean;
  /** colour by candle direction instead of the coin's hue: the board reads as a market */
  tone?: 'up' | 'down';
};

export default function Sparkline({
  series,
  height = 38,
  strokeWidth = 1.6,
  fill = true,
  grid = false,
  tone,
}: Props) {
  const id = useId().replace(/:/g, '');
  if (!series.length) return null;

  const W = 100;
  const H = height;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const step = W / Math.max(1, series.length - 1);
  const rising = series[series.length - 1] >= series[0];
  const up = tone ? tone === 'up' : rising;

  const pts = series.map((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / span) * (H - 4) - 2;
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const stroke = up ? 'var(--rf-up)' : 'var(--rf-down)';

  return (
    <svg
      className={`rf-spark ${up ? 'is-up' : 'is-down'}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid &&
        [0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="rf-spark-grid" />
        ))}
      {fill && <path d={area} fill={`url(#sp-${id})`} />}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
