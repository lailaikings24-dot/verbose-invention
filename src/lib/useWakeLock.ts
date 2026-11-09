import { useEffect } from 'react';

/**
 * Keeps the phone screen on while live data streams or a scan runs.
 *
 * Written imperatively as well as a hook so the OBD service can hold the lock
 * without every screen having to know about it. Requests are refused by battery
 * savers and insecure contexts, so failures are silent by design.
 */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockApi {
  request?: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

let sentinel: WakeLockSentinelLike | null = null;
let wanted = false;
let inFlight: Promise<void> | null = null;

async function take(): Promise<void> {
  const api =
    typeof navigator === 'undefined' ? undefined : (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
  if (!api?.request) return;
  try {
    const lock = await api.request('screen');
    if (!wanted) {
      await lock.release().catch(() => undefined);
      return;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Battery saver or an insecure context refused the request.
  }
}

export function setWakeLock(active: boolean): void {
  wanted = active;
  if (active) {
    if (!sentinel && !inFlight) {
      inFlight = take().finally(() => {
        inFlight = null;
      });
    }
    return;
  }
  const lock = sentinel;
  sentinel = null;
  void lock?.release().catch(() => undefined);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    // The OS drops the lock when the app is backgrounded; re-take it on return.
    if (document.visibilityState === 'visible' && wanted && !sentinel && !inFlight) {
      inFlight = take().finally(() => {
        inFlight = null;
      });
    }
  });
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    setWakeLock(active);
    return () => setWakeLock(false);
  }, [active]);
}
