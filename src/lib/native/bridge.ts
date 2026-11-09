/**
 * Thin, dependency-free client for the `VehicleLink` Capacitor plugin.
 *
 * The plugin is the reason this app works on iPhone at all: Safari has no Web
 * Bluetooth, but a native CoreBluetooth/GATT implementation does. The same
 * plugin reaches Bluetooth Classic (SPP) on Android, which no browser can do.
 *
 * Nothing imports @capacitor/core here — the bridge is discovered at runtime,
 * so the plain web build stays a plain web build.
 */

export type NativeLink = 'ble' | 'classic';

export interface NativeDevice {
  /** Platform device id (iOS UUID, Android MAC address). */
  id: string;
  name: string;
  /** Signal strength in dBm; 0 when the platform does not report it. */
  rssi: number;
  link: NativeLink;
}

export interface NativeAvailability {
  bluetooth: boolean;
  permitted: boolean;
  platform: 'android' | 'ios' | 'web';
  /** Why Bluetooth is unavailable, when it is. */
  reason?: string;
}

interface ListenerHandle {
  remove(): Promise<void> | void;
}

interface RawPlugin {
  available(): Promise<NativeAvailability>;
  scan(options: { timeoutMs: number }): Promise<{ devices: NativeDevice[] }>;
  connect(options: { id: string; link: NativeLink }): Promise<{ name: string; profile: string }>;
  write(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  addListener(event: string, listener: (payload: unknown) => void): Promise<ListenerHandle>;
}

export interface VehicleLink {
  available(): Promise<NativeAvailability>;
  scan(timeoutMs?: number): Promise<NativeDevice[]>;
  connect(device: NativeDevice): Promise<{ name: string; profile: string }>;
  write(data: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Subscribe to adapter output. Returns an unsubscribe function. */
  onData(listener: (chunk: string) => void): () => void;
  onLinkLost(listener: (reason: string) => void): () => void;
}

function rawPlugin(): RawPlugin | null {
  if (typeof window === 'undefined') return null;
  const shell = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugin = shell?.Plugins?.VehicleLink as RawPlugin | undefined;
  return plugin && typeof plugin.scan === 'function' ? plugin : null;
}

function listen<T>(plugin: RawPlugin, event: string, listener: (payload: T) => void): () => void {
  let handle: ListenerHandle | null = null;
  let cancelled = false;
  void plugin
    .addListener(event, (payload) => {
      if (!cancelled) listener(payload as T);
    })
    .then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
    if (handle) void handle.remove();
  };
}

let cached: VehicleLink | null | undefined;

export function vehicleLink(): VehicleLink | null {
  if (cached !== undefined) return cached;
  const plugin = rawPlugin();
  if (!plugin) {
    cached = null;
    return cached;
  }
  cached = {
    available: () => plugin.available(),
    scan: async (timeoutMs = 8000) => (await plugin.scan({ timeoutMs })).devices ?? [],
    connect: (device) => plugin.connect({ id: device.id, link: device.link }),
    write: (data) => plugin.write({ data }),
    disconnect: async () => {
      await plugin.disconnect().catch(() => undefined);
    },
    onData: (listener) => listen<{ data: string }>(plugin, 'data', (payload) => listener(payload?.data ?? '')),
    onLinkLost: (listener) => listen<{ reason?: string }>(plugin, 'linkLost', (payload) => listener(payload?.reason ?? '')),
  };
  return cached;
}

export const hasNativeBluetooth = (): boolean => vehicleLink() !== null;
