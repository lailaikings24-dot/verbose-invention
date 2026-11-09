/**
 * Platform and capability detection.
 *
 * The same code base ships three ways:
 *   1. Android/iOS installed app (native shell → real Bluetooth stack)
 *   2. Installed PWA on Android/desktop (Web Bluetooth)
 *   3. Browser tab on iOS (no Bluetooth API — Wi-Fi bridge or demo only)
 *
 * Everything that differs between those can be answered from here instead of
 * scattering user-agent checks through the UI.
 */

export type Platform = 'ios' | 'android' | 'desktop' | 'other';

interface CapacitorShape {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

function capacitor(): CapacitorShape | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorShape }).Capacitor;
}

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0;

export const platform: Platform = (() => {
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  // iPadOS 13+ reports a desktop Safari UA; multi-touch is the reliable tell.
  if (/Macintosh/.test(ua) && touchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS|X11/.test(ua)) return 'desktop';
  return 'other';
})();

export const isIOS = platform === 'ios';
export const isAndroid = platform === 'android';
export const isMobile = isIOS || isAndroid;

/** Running inside the Capacitor Android/iOS shell rather than a browser. */
export const isNativeShell = capacitor()?.isNativePlatform?.() === true;

export const platformName: string = isNativeShell
  ? platform === 'ios'
    ? 'iOS app'
    : platform === 'android'
      ? 'Android app'
      : 'Mobile app'
  : isIOS
    ? 'iOS'
    : isAndroid
      ? 'Android'
      : platform === 'desktop'
        ? 'Desktop'
        : 'This device';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const legacy = (navigator as unknown as { standalone?: boolean }).standalone;
  if (legacy === true) return true;
  return ['standalone', 'fullscreen', 'minimal-ui'].some(
    (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true,
  );
}

interface WakeLockApi {
  request?: (type: 'screen') => Promise<unknown>;
}

export const caps = {
  /** Web Bluetooth — Chrome/Edge on Android and desktop, never iOS Safari. */
  webBluetooth: typeof navigator !== 'undefined' && !!navigator.bluetooth,
  /** Web Bluetooth requires a secure context; plain HTTP silently disables it. */
  secureContext: typeof window !== 'undefined' && window.isSecureContext !== false,
  share: typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  vibrate: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
  wakeLock: typeof navigator !== 'undefined' && !!(navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock,
  serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  /** Capacitor bridge to the native Bluetooth plugin. */
  nativeBluetooth: !!capacitor()?.Plugins?.VehicleLink,
};

// ---- install flow ---------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function notifyInstall() {
  installListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* a listener must never break the install flow */
    }
  });
}

/**
 * Call once at start-up. Android/Chrome fires `beforeinstallprompt`; iOS never
 * does, which is why iOS gets written instructions instead of a button.
 */
export function initInstallCapture(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notifyInstall();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

export type InstallState = 'native' | 'installed' | 'ready' | 'ios-manual' | 'unsupported';

export function installState(): InstallState {
  if (isNativeShell) return 'native';
  if (isStandalone()) return 'installed';
  if (deferred) return 'ready';
  if (isIOS) return 'ios-manual';
  return 'unsupported';
}

/** Shows the browser's install sheet. Returns whether the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  await event.prompt();
  const choice = await event.userChoice;
  deferred = null;
  notifyInstall();
  return choice.outcome === 'accepted';
}
