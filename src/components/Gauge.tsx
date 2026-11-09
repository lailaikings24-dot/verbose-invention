import { clamp, fmt } from '../lib/format';

interface GaugeProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  color?: string;
  onRemove?: () => void;
  digits?: number;
}

const START = 135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

export function Gauge({ label, value, unit, min, max, color = '#2ee6a8', onRemove, digits }: GaugeProps) {
  const span = max - min || 1;
  const ratio = clamp((value - min) / span, 0, 1);
  const end = START + SWEEP * ratio;
  const show = Number.isFinite(value) ? value : 0;
  const dp = digits ?? (Math.abs(show) >= 100 ? 0 : 1);

  return (
    <div className="gauge">
      {onRemove && (
        <button className="gauge-remove" onClick={onRemove} aria-label={`Remove ${label}`} title="Remove">
          ×
        </button>
      )}
      <svg viewBox="0 0 120 100" className="gauge-svg" role="img" aria-label={`${label}: ${fmt(show, dp)} ${unit}`}>
        <path d={arc(60, 62, 46, START, START + SWEEP)} fill="none" stroke="#1e2c39" strokeWidth="9" strokeLinecap="round" />
        {ratio > 0.005 && (
          <path
            d={arc(60, 62, 46, START, end)}
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            style={{ transition: 'd 0.18s linear' }}
          />
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const p1 = polar(60, 62, 37, START + SWEEP * t);
          const p2 = polar(60, 62, 32, START + SWEEP * t);
          return (
            <line
              key={t}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#3a4d5f"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          );
        })}
        <text x="60" y="57" textAnchor="middle" fill="#e9f0f7" fontSize="19" fontWeight="700" fontFamily="ui-monospace, monospace">
          {Number.isFinite(value) ? show.toFixed(dp) : '—'}
        </text>
        <text x="60" y="71" textAnchor="middle" fill="#64798d" fontSize="8.5" fontWeight="600" letterSpacing="0.4">
          {unit}
        </text>
      </svg>
      <div className="gauge-name">{label}</div>
    </div>
  );
}
