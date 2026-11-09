/** Small formatting + math helpers shared by the UI. */

export function fmt(value: number | undefined | null, digits = 1): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function fmtInt(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function hex(n: number, width = 2): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => hex(b)).join(' ');
}

/**
 * Tiny arithmetic evaluator for user-defined PIDs. Supports A/B/C/D variables,
 * numbers, + - * / % and parentheses. No eval, no globals.
 */
export function evalFormula(expr: string, vars: Record<string, number>): number {
  const tokens = expr
    .toUpperCase()
    .replace(/\s+/g, '')
    .match(/\d*\.?\d+|[ABCD]|[+\-*/%()]/g);
  if (!tokens) return Number.NaN;

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const parseExpr = (): number => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
    }
    return value;
  };

  const parseFactor = (): number => {
    const t = next();
    if (t === undefined) return Number.NaN;
    if (t === '-') return -parseFactor();
    if (t === '+') return parseFactor();
    if (t === '(') {
      const v = parseExpr();
      if (peek() === ')') next();
      return v;
    }
    if (/^[ABCD]$/.test(t)) return vars[t] ?? 0;
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const result = parseExpr();
  return pos === tokens.length ? result : Number.NaN;
}
