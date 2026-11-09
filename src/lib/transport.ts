/**
 * Transport layer: everything that can carry raw ELM327 text.
 *
 * Four links, for four different situations:
 *   ble    — Web Bluetooth, available in Android/desktop Chrome and Edge only.
 *   native — the Capacitor plugin: BLE on Android and iOS, plus Bluetooth
 *            Classic (SPP) on Android. This is how the installed iPhone app
 *            talks to a dongle, since Safari exposes no Bluetooth API at all.
 *   ws     — Wi-Fi dongles and serial-to-WebSocket bridges.
 *   demo   — the built-in virtual vehicle, always available.
 *
 * Every transport that can drop a link exposes `onLostConnection`, and every
 * one that can reattach without user interaction exposes `reconnect`. That is
 * what lets the service recover a dropped dongle instead of making the user
 * walk back through a Bluetooth picker mid-diagnosis.
 */

export type LinkKind = 'ble' | 'native' | 'ws' | 'demo';

export interface ConnectOptions {
  /** Reattach to this remembered device without showing a picker. */
  deviceId?: string;
  /** Let the user pick any nearby BLE device, not just OBD-looking names. */
  showAll?: boolean;
  /** True when this is an automatic reconnect after a dropped link. */
  reconnect?: boolean;
}

export interface Transport {
  readonly kind: LinkKind;
  readonly label: string;
  readonly detail: string;
  connect(onData: (chunk: string) => void, options?: ConnectOptions): Promise<void>;
  /** Reattach without a picker or scan when the platform still knows the device. */
  reconnect?(onData: (chunk: string) => void): Promise<void>;
  write(text: string): Promise<void>;
  disconnect(): Promise<void>;
  onLostConnection?(cb: (reason: string) => void): void;
}

/** GATT profiles used by OBD-II BLE adapters, most common first. */
export const BLE_PROFILES: { name: string; service: string; tx: string; rx: string }[] = [
  // Vgate iCar Pro BLE, Veepeak BLE+, most generic BLE ELM327 clones
  {
    name: 'FFE0 / FFE1',
    service: '0000ffe0-0000-1000-8000-00805f9b34fb',
    tx: '0000ffe1-0000-1000-8000-00805f9b34fb',
    rx: '0000ffe1-0000-1000-8000-00805f9b34fb',
  },
  // OBDLink MX+ / some Konnwei
  {
    name: 'FFF0 / FFF2',
    service: '0000fff0-0000-1000-8000-00805f9b34fb',
    tx: '0000fff2-0000-1000-8000-00805f9b34fb',
    rx: '0000fff1-0000-1000-8000-00805f9b34fb',
  },
  // Nordic UART style bridges
  {
    name: 'Nordic UART',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  },
  // Some ELM327 v2.1 BLE modules
  {
    name: '18F0 / 2AF0',
    service: '000018f0-0000-1000-8000-00805f9b34fb',
    tx: '00002af1-0000-1000-8000-00805f9b34fb',
    rx: '00002af0-0000-1000-8000-00805f9b34fb',
  },
  // ISSC / Microchip transparent UART, used by a few rebadged dongles
  {
    name: 'ISSC UART',
    service: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    tx: '49535343-8841-43f4-a8d4-ecbe34729bb3',
    rx: '49535343-1e4d-4bd9-ba61-23c647249616',
  },
];

/**
 * Adapter name prefixes. This is what makes the picker show only dongles
 * instead of every BLE gadget in the car park — worth keeping generous,
 * because clone manufacturers name their hardware almost anything.
 */
const NAME_PREFIXES = [
  'OBD',
  'VLink',
  'Vgate',
  'vLinker',
  'VEEPEAK',
  'KONNWEI',
  'ELM',
  'OBDBLE',
  'V-Link',
  'iOS-Vlink',
  'Android-Vlink',
  'Carista',
  'BlueDriver',
  'ANCEL',
  'Autel',
  'XTOL',
  'LAUNCH',
  'HC-05',
  'HC-06',
  'MINI',
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class BleTransport implements Transport {
  readonly kind = 'ble' as const;
  label = 'Bluetooth LE';
  detail = '';
  /** Set once a device is attached — remembered for one-tap reconnects. */
  deviceId = '';
  deviceName = '';

  private device: BluetoothDeviceLike | null = null;
  private char: BluetoothCharacteristicLike | null = null;
  private decoder = new TextDecoder();
  private onData: ((chunk: string) => void) | null = null;
  private onDisconnect: ((reason: string) => void) | null = null;
  private subscribed = false;
  private hooked = false;

  onLostConnection(cb: (reason: string) => void) {
    this.onDisconnect = cb;
  }

  static get supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async connect(onData: (chunk: string) => void, options: ConnectOptions = {}): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error(
        'This browser has no Web Bluetooth. Use Chrome or Edge on Android/desktop, or switch to Wi-Fi / demo mode.',
      );
    }
    this.onData = onData;

    // A remembered device can be reattached with no picker at all. This is the
    // difference between "tap reconnect" and "hunt for the dongle again".
    let device: BluetoothDeviceLike | null = null;
    if (options.deviceId) device = await this.recall(options.deviceId);
    if (!device) device = await this.pick(options.showAll === true);

    await this.attach(device);
  }

  /** Reattach to the same device object after a GATT disconnect. */
  async reconnect(onData: (chunk: string) => void): Promise<void> {
    this.onData = onData;
    const device = this.device;
    if (!device?.gatt) throw new Error('The Bluetooth adapter is no longer in memory.');
    if (!device.gatt.connected) await device.gatt.connect();
    const found = await BleTransport.findChannel(device.gatt);
    if (!found) throw new Error('The adapter came back but its serial channel is gone.');
    this.char = found.char;
    this.detail = found.profile;
    this.subscribed = false;
    await this.subscribe();
  }

  private async recall(deviceId: string): Promise<BluetoothDeviceLike | null> {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth?.getDevices) return null;
    try {
      const known = await bluetooth.getDevices();
      return known.find((d) => d.id === deviceId) ?? null;
    } catch {
      // Permission was revoked or the browser refused — fall back to the picker.
      return null;
    }
  }

  private async pick(showAll: boolean): Promise<BluetoothDeviceLike> {
    const bluetooth = navigator.bluetooth!;
    const optionalServices = BLE_PROFILES.map((p) => p.service);

    if (showAll) {
      return bluetooth.requestDevice({ acceptAllDevices: true, optionalServices });
    }

    try {
      return await bluetooth.requestDevice({
        filters: [
          ...NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
          ...BLE_PROFILES.map((p) => ({ services: [p.service] })),
        ],
        optionalServices,
      });
    } catch (err) {
      // Do not silently reopen the picker: a second dialog out of nowhere is
      // one of the most confusing things a Bluetooth app can do.
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        throw new Error(
          'No adapter was selected, or none is advertising yet. Check the dongle is plugged in and awake, then try again — or use “Show all Bluetooth devices”.',
        );
      }
      if (err instanceof DOMException && err.name === 'SecurityError') {
        throw new Error('Bluetooth is blocked on this origin. It needs HTTPS (or localhost) and a permission grant.');
      }
      throw err;
    }
  }

  private async attach(device: BluetoothDeviceLike): Promise<void> {
    this.device = device;
    this.deviceId = device.id;
    this.deviceName = device.name || 'BLE adapter';
    this.label = this.deviceName;

    if (!device.gatt) throw new Error('This device does not expose a GATT server.');

    try {
      await device.gatt.connect();
    } catch {
      throw new Error(
        'Pairing was refused. Power-cycle the dongle, make sure no other phone or app is connected to it, then retry.',
      );
    }

    const found = await BleTransport.findChannel(device.gatt);
    if (!found) {
      try {
        device.gatt.disconnect();
      } catch {
        /* ignore */
      }
      throw new Error(
        'Connected, but no serial channel was found on this adapter. It may be a classic-Bluetooth dongle — use a Wi-Fi adapter or the demo vehicle.',
      );
    }

    this.char = found.char;
    this.detail = found.profile;
    this.subscribed = false;
    await this.subscribe();

    if (!this.hooked) {
      this.hooked = true;
      device.addEventListener('gattserverdisconnected', () => {
        this.char = null;
        this.subscribed = false;
        this.onDisconnect?.('The Bluetooth adapter disconnected.');
      });
    }
  }

  private async subscribe(): Promise<void> {
    const char = this.char;
    if (!char || this.subscribed) return;
    char.addEventListener('characteristicvaluechanged', () => {
      const value = char.value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      this.onData?.(this.decoder.decode(bytes, { stream: true }));
    });
    await char.startNotifications();
    this.subscribed = true;
  }

  private static async findChannel(
    server: GattServerLike,
  ): Promise<{ char: BluetoothCharacteristicLike; profile: string } | null> {
    const services = await server.getPrimaryServices();

    for (const profile of BLE_PROFILES) {
      const service = services.find((s) => s.uuid.toLowerCase() === profile.service.toLowerCase());
      if (!service) continue;
      const chars = await service.getCharacteristics();
      const byTx = chars.find((c) => c.uuid.toLowerCase() === profile.tx.toLowerCase());
      if (byTx) return { char: byTx, profile: profile.name };
      // Some clones expose a different characteristic UUID inside a known
      // service — take anything that can notify and write.
      const usable = chars.find((c) => c.properties?.notify !== false && c.properties?.write !== false);
      if (usable) return { char: usable, profile: profile.name };
    }

    // Last resort: any characteristic that can notify.
    for (const service of services) {
      const chars = await service.getCharacteristics();
      const notifier = chars.find((c) => c.properties?.notify === true || 'startNotifications' in c);
      if (notifier) return { char: notifier, profile: service.uuid.slice(4, 8).toUpperCase() };
    }
    return null;
  }

  async write(text: string): Promise<void> {
    const char = this.char;
    if (!char) throw new Error('Bluetooth adapter is not connected.');
    const data = new TextEncoder().encode(text);

    // BLE serial bridges cap a write at 20 bytes and some reject anything
    // bigger without saying so. 18 bytes leaves room for the header byte that
    // certain firmwares add.
    const CHUNK = 18;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < data.length; i += CHUNK) chunks.push(new Uint8Array(data.subarray(i, i + CHUNK)));

    for (let i = 0; i < chunks.length; i++) {
      await BleTransport.writeChunk(char, chunks[i]);
      if (i < chunks.length - 1) await sleep(8);
    }
  }

  private static async writeChunk(char: BluetoothCharacteristicLike, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    // No-response writes cannot fail with GATT_BUSY when the bridge is busy.
    if (typeof char.writeValueWithoutResponse === 'function') {
      try {
        await char.writeValueWithoutResponse(bytes);
        return;
      } catch {
        /* fall back to the acknowledged write path */
      }
    }
    await char.writeValue(bytes);
  }

  async disconnect(): Promise<void> {
    this.subscribed = false;
    this.char = null;
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    this.device = null;
  }
}

export class WebSocketTransport implements Transport {
  readonly kind = 'ws' as const;
  readonly label = 'Wi-Fi / bridge';
  detail = '';
  readonly url: string;

  private ws: WebSocket | null = null;
  private onData: ((chunk: string) => void) | null = null;
  private onDisconnect: ((reason: string) => void) | null = null;
  private closing = false;

  constructor(url: string) {
    this.url = url;
    this.detail = url;
  }

  onLostConnection(cb: (reason: string) => void) {
    this.onDisconnect = cb;
  }

  reconnect(onData: (chunk: string) => void): Promise<void> {
    return this.connect(this.onData ?? onData);
  }

  connect(onData: (chunk: string) => void): Promise<void> {
    this.onData = onData;
    this.closing = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        reject(new Error('That address is not a valid WebSocket URL (ws://host:port).'));
        return;
      }
      this.ws = socket;
      socket.binaryType = 'arraybuffer';

      const bail = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            'Timed out reaching the adapter. Check the IP address and that you are joined to its Wi-Fi network.',
          ),
        );
      }, 8000);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(bail);
        resolve();
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(bail);
        reject(
          new Error(
            'Could not open a WebSocket to the adapter. Wi-Fi ELM327 dongles usually need a TCP bridge on port 35000.',
          ),
        );
      };
      socket.onmessage = (ev) => {
        if (typeof ev.data === 'string') onData(ev.data);
        else if (ev.data instanceof ArrayBuffer) onData(new TextDecoder().decode(new Uint8Array(ev.data)));
      };
      socket.onclose = () => {
        if (settled && !this.closing) this.onDisconnect?.('The Wi-Fi adapter closed the connection.');
      };
    });
  }

  async write(text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open.');
    this.ws.send(text);
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
