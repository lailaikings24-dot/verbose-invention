import { useId } from 'react';

export function Sparkline({
  values,
  width = 240,
  height = 56,
  color = '#2ee6a8',
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const id = useId().replace(/[:]/g, '');
  if (values.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} aria-hidden="true">
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="#1e2c39" strokeWidth="1" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - 4 - ((v - min) / span) * (height - 10);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const path = `M ${points.join(' L ')}`;
  const area = `${path} L ${width},${height} L 0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#grad-${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
