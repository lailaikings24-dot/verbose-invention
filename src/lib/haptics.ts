/**
 * Touch feedback. Android browsers and the native shell vibrate; iOS has no
 * vibration API in Safari, so it degrades to silence rather than an error.
 */
type Vibrate = (pattern: number | number[]) => boolean;

const PATTERNS: Record<string, number | number[]> = {
  tap: 8,
  success: [14, 46, 20],
  warn: 24,
  error: [32, 62, 32],
};

export function haptic(kind: 'tap' | 'success' | 'warn' | 'error' = 'tap'): void {
  if (typeof navigator === 'undefined') return;
  const vibrate = (navigator as unknown as { vibrate?: Vibrate }).vibrate;
  if (typeof vibrate !== 'function') return;
  try {
    vibrate.call(navigator, PATTERNS[kind] ?? PATTERNS.tap);
  } catch {
    /* blocked by the browser's user-gesture rules — harmless */
  }
}
