/**
 * High-level OBD-II service: connection lifecycle, full scans, live data and
 * the read/clear workflows. The UI talks only to this module.
 */
import { Elm327, dataBytes, type Message } from './elm327';
import { DemoTransport } from './demo';
import {
  BleTransport,
  WebSocketTransport,
  type ConnectOptions,
  type LinkKind,
  type Transport,
} from './transport';
import { NativeTransport } from './native/transport';
import { vehicleLink, type NativeDevice } from './native/bridge';
import { haptic } from './haptics';
import { setWakeLock } from './useWakeLock';
import { PID_BY_ID } from './obd/pids';
import { decodeMonitors, decodeCycleMonitors, parseDtcPayload } from './obd/dtc';
import { decodeVin } from './obd/vin';
import {
  useApp,
  pushLog,
  type DtcRecord,
  type DtcKind,
  type FreezeRow,
  type Mode6Row,
} from '../state/store';
import { hex } from './format';
import { load, save } from './storage';

const ECU_LABELS: Record<string, string> = {
  '7E8': 'Engine control module',
  '7E9': 'Transmission control module',
  '7EA': 'Powertrain module 3',
  '7EB': 'Powertrain module 4',
  '7EC': 'Powertrain module 5',
  '7ED': 'Powertrain module 6',
  '7EE': 'Powertrain module 7',
  '7EF': 'Powertrain module 8',
};

const MID_NAMES: Record<number, string> = {
  0x01: 'Misfire — general',
  0x02: 'Misfire — cylinder specific',
  0x03: 'Misfire — emission related',
  0x21: 'Catalyst efficiency — bank 1',
  0x22: 'Catalyst efficiency — bank 2',
  0x31: 'EVAP system — 0.02" leak',
  0x32: 'EVAP system — 0.04" leak',
  0x39: 'O2 sensor — bank 1 sensor 1',
  0x3a: 'O2 sensor — bank 1 sensor 2',
  0x41: 'O2 heater — bank 1 sensor 1',
  0x51: 'Secondary air system',
  0x61: 'EGR system',
  0x71: 'Cold start emission reduction',
  0xa1: 'Purge flow monitor',
};

export function ecuLabel(header: string): string {
  if (!header) return 'Powertrain (no header)';
  const known = ECU_LABELS[header];
  if (known) return known;
  if (/^18DA/i.test(header)) return `Module ${header.slice(-2)} (29-bit)`;
  return `Module ${header}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything needed to rebuild a link without asking the user anything. */
export interface RememberedLink {
  kind: LinkKind;
  label: string;
  /** Web Bluetooth device id, for a picker-free reattach. */
  deviceId?: string;
  /** Native plugin device, for the installed Android/iOS app. */
  device?: NativeDevice;
  /** Bridge address, for Wi-Fi links. */
  url?: string;
  at: number;
}

const LINK_KEY = 'lastLink';

/** Backoff before each silent reconnect attempt, in milliseconds. */
const RECONNECT_DELAYS = [400, 1200, 3000];

const MAX_RECONNECTS = RECONNECT_DELAYS.length;

/** Reject a step that hangs, so the UI never spins forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function transportFor(link: RememberedLink): Transport | null {
  if (link.kind === 'ble') return new BleTransport();
  if (link.kind === 'ws' && link.url) return new WebSocketTransport(link.url);
  if (link.kind === 'native' && link.device) return new NativeTransport(link.device);
  return null;
}

class ObdService {
  private adapter: Elm327 | null = null;
  private liveRunning = false;
  private liveTimer: number | null = null;
  private voltageTimer: number | null = null;
  /** Bumped by every new connection attempt, cancel or disconnect. Any async
   *  work that wakes up holding a stale value knows its attempt was abandoned. */
  private attempt = 0;
  private remembered: RememberedLink | null = load<RememberedLink | null>(LINK_KEY, null);

  /** The adapter used last time, if it can be reached again without a picker. */
  get lastLink(): RememberedLink | null {
    const link = this.remembered;
    if (!link || link.kind === 'demo') return null;
    if (link.kind === 'ws' && !link.url) return null;
    if (link.kind === 'native' && !link.device) return null;
    return link;
  }

  get isConnected(): boolean {
    return !!this.adapter?.isConnected;
  }

  get elm(): Elm327 | null {
    return this.adapter;
  }

  // ---- connection ---------------------------------------------------------

  async connectDemo(): Promise<boolean> {
    return this.start(new DemoTransport(), 'demo');
  }

  /**
   * Web Bluetooth.
   *
   * Pass `deviceId` to reattach to a dongle the browser already remembers — no
   * picker at all. `showAll` opens the picker unfiltered, for adapters whose
   * name does not look like an OBD dongle.
   */
  async connectBle(options: { deviceId?: string; showAll?: boolean } = {}): Promise<boolean> {
    return this.start(new BleTransport(), 'ble', options);
  }

  /** Native Bluetooth: the only route to an adapter from the iOS app. */
  async scanNative(): Promise<NativeDevice[]> {
    const link = vehicleLink();
    if (!link) throw new Error('Native Bluetooth is only available in the Android or iOS build of TorqueMedic.');
    const availability = await link.available();
    if (!availability.bluetooth) {
      throw new Error(availability.reason || 'Bluetooth is switched off or not permitted for this app.');
    }
    return link.scan(10_000);
  }

  async connectNative(device: NativeDevice): Promise<boolean> {
    return this.start(new NativeTransport(device), 'native');
  }

  async connectWs(url: string): Promise<boolean> {
    return this.start(new WebSocketTransport(url), 'ws');
  }

  /** One tap: reattach to the adapter that worked last time. */
  async reconnectLast(): Promise<boolean> {
    const link = this.lastLink;
    if (!link) return false;
    const transport = transportFor(link);
    if (!transport) return false;
    pushLog('info', `Reconnecting to ${link.label}…`);
    return this.start(transport, link.kind, { deviceId: link.deviceId, reconnect: true });
  }

  /** Abandon an in-flight connection attempt (the Bluetooth picker may still be open). */
  async cancelConnect(): Promise<void> {
    this.attempt++;
    await this.closeAdapter();
    useApp.setState({
      conn: { status: 'idle', kind: null, label: 'No adapter', message: '' },
      liveActive: false,
    });
    pushLog('info', 'Connection attempt cancelled.');
  }

  private async start(
    transport: Transport,
    kind: LinkKind,
    options: ConnectOptions = {},
  ): Promise<boolean> {
    const attempt = ++this.attempt;
    await this.closeAdapter();

    const label = transport.label;
    const progress = (message: string) => {
      if (attempt !== this.attempt) return;
      useApp.setState({ conn: { status: 'connecting', kind, label, message } });
    };

    progress(options.reconnect ? 'Reconnecting to the adapter…' : 'Opening the link…');

    const adapter = new Elm327();
    adapter.setLogger(pushLog);
    this.adapter = adapter;

    transport.onLostConnection?.((reason) => {
      if (attempt !== this.attempt) return;
      void this.handleDrop(reason || `${label} disconnected.`, kind);
    });

    /** Give up on this attempt without reporting an error the user did not cause. */
    const abandon = async (): Promise<false> => {
      await adapter.close().catch(() => undefined);
      if (this.adapter === adapter) this.adapter = null;
      return false;
    };

    try {
      const opening = adapter.open(transport, options);
      // The Bluetooth picker is user-paced, so only a silent open gets a
      // deadline; a fresh picker wait is the user deciding, not a hang.
      const silent = !!options.deviceId || !!options.reconnect || kind !== 'ble';
      await (silent
        ? withTimeout(opening, 20_000, 'The adapter did not accept the link in time.')
        : opening);
      if (attempt !== this.attempt) return abandon();

      progress('Negotiating with the vehicle bus…');
      await withTimeout(
        adapter.init({ warm: options.reconnect === true }),
        30_000,
        'The adapter stopped responding while setting up. Power-cycle the dongle and try again.',
      );
      if (attempt !== this.attempt) return abandon();

      this.markConnected(adapter, transport, kind, options.reconnect === true);
      this.rememberLink(transport, kind);
      // The UI already shows "connected", so this scan is progress, not a gate.
      await this.fullScan();
      return true;
    } catch (err) {
      if (attempt !== this.attempt) return abandon();
      const message = err instanceof Error ? err.message : String(err);
      pushLog('error', message);
      haptic('error');
      useApp.setState({ conn: { status: 'error', kind, label, message } });
      return abandon();
    }
  }

  private markConnected(adapter: Elm327, transport: Transport, kind: LinkKind, restored: boolean): void {
    const stats = useApp.getState().linkStats;
    const label = transport.detail ? `${transport.label} — ${transport.detail}` : transport.label;
    useApp.setState({
      conn: { status: 'connected', kind, label, message: '' },
      adapterId: adapter.adapterId,
      protocol: adapter.protocolName,
      voltage: adapter.voltage,
      linkStats: {
        rtt: adapter.latency,
        drops: stats.drops,
        reconnects: stats.reconnects + (restored ? 1 : 0),
        connectedAt: Date.now(),
      },
    });
    pushLog('info', `${restored ? 'Link restored' : 'Connected'}: ${adapter.adapterId} on ${adapter.protocolName}`);
    haptic('success');

    this.clearVoltageTimer();
    // Doubles as a keep-alive: some dongles sleep if left idle for a minute.
    this.voltageTimer = window.setInterval(() => {
      void this.refreshVoltage();
    }, 15_000);
  }

  private rememberLink(transport: Transport, kind: LinkKind): void {
    if (kind === 'demo') return;
    const link: RememberedLink = { kind, label: transport.label, at: Date.now() };
    if (transport instanceof BleTransport) link.deviceId = transport.deviceId;
    else if (transport instanceof WebSocketTransport) link.url = transport.url;
    else if (transport instanceof NativeTransport) link.device = transport.device;
    this.remembered = link;
    save(LINK_KEY, link);
  }

  /**
   * A lost link is usually the dongle blipping, not a broken setup — the car's
   * electrical noise, an ignition cycle or a phone doze will do it. So try to
   * recover silently before troubling the user.
   */
  private async handleDrop(message: string, kind: LinkKind | null): Promise<void> {
    this.stopLive();
    this.clearVoltageTimer();

    const stats = useApp.getState().linkStats;
    useApp.setState({ liveActive: false, linkStats: { ...stats, drops: stats.drops + 1 } });
    pushLog('error', message);

    const link = this.lastLink;
    const transport = link ? transportFor(link) : null;
    if (!link || !transport) {
      this.failConnection(message);
      return;
    }

    const attempt = ++this.attempt;
    for (let i = 0; i < MAX_RECONNECTS; i++) {
      await sleep(RECONNECT_DELAYS[i]);
      if (attempt !== this.attempt) return;

      useApp.setState({
        conn: {
          status: 'connecting',
          kind: link.kind,
          label: link.label,
          message: `Link lost — reconnecting (${i + 1}/${MAX_RECONNECTS})…`,
        },
      });

      if (await this.reconnectSilently(link, attempt)) return;
      if (attempt !== this.attempt) return;
    }

    this.failConnection(
      `${message} Automatic reconnection failed — check the dongle is still powered, plugged in, and not paired to another phone.`,
    );
  }

  private async reconnectSilently(link: RememberedLink, attempt: number): Promise<boolean> {
    const transport = transportFor(link);
    if (!transport) return false;

    await this.closeAdapter();
    const adapter = new Elm327();
    adapter.setLogger(pushLog);
    this.adapter = adapter;

    transport.onLostConnection?.((reason) => {
      if (attempt !== this.attempt) return;
      void this.handleDrop(reason || `${link.label} disconnected.`, link.kind);
    });

    try {
      await withTimeout(
        adapter.open(transport, { deviceId: link.deviceId, reconnect: true }),
        20_000,
        'No answer',
      );
      if (attempt !== this.attempt) throw new Error('Superseded');
      // Warm init skips the ATZ reset, so the adapter is back on the bus in
      // well under a second instead of three or four.
      await withTimeout(adapter.init({ warm: true }), 20_000, 'No answer');
      if (attempt !== this.attempt) throw new Error('Superseded');

      this.markConnected(adapter, transport, link.kind, true);
      this.rememberLink(transport, link.kind);
      void this.fullScan();
      return true;
    } catch {
      await adapter.close().catch(() => undefined);
      if (this.adapter === adapter) this.adapter = null;
      return false;
    }
  }

  private failConnection(message: string): void {
    this.adapter = null;
    useApp.setState({
      conn: { status: 'error', kind: null, label: 'Disconnected', message },
      liveActive: false,
    });
  }

  private async closeAdapter(): Promise<void> {
    const adapter = this.adapter;
    this.adapter = null;
    if (!adapter) return;
    await adapter.close().catch(() => undefined);
  }

  private clearVoltageTimer() {
    if (this.voltageTimer !== null) {
      window.clearInterval(this.voltageTimer);
      this.voltageTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    this.attempt++;
    this.stopLive();
    this.clearVoltageTimer();
    await this.closeAdapter();
    useApp.getState().resetSession();
    useApp.setState({
      conn: { status: 'idle', kind: null, label: 'No adapter', message: '' },
      adapterId: '',
      protocol: '',
      voltage: 0,
      liveActive: false,
      linkStats: { rtt: 0, drops: 0, reconnects: 0, connectedAt: 0 },
    });
  }

  async refreshVoltage(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const v = await adapter.readVoltage().catch(() => 0);
    if (v <= 0) return;
    const stats = useApp.getState().linkStats;
    useApp.setState({ voltage: v, linkStats: { ...stats, rtt: adapter.latency } });
  }

  // ---- primitives ---------------------------------------------------------

  private requireAdapter(): Elm327 {
    if (!this.adapter?.isConnected) throw new Error('No adapter connected.');
    return this.adapter;
  }

  async readPids(pids: number[]): Promise<Map<number, { value: number; bytes: number[] }>> {
    const adapter = this.requireAdapter();
    const out = new Map<number, { value: number; bytes: number[] }>();
    if (!pids.length) return out;

    const batchSize = adapter.isCan ? 6 : 1;
    for (let i = 0; i < pids.length; i += batchSize) {
      const batch = pids.slice(i, i + batchSize);
      const cmd = `01${batch.map((p) => hex(p)).join('')}`;
      let msgs: Message[] = [];
      try {
        msgs = await adapter.request(cmd, 0x41, batch.length > 1 ? 3500 : 2500);
      } catch {
        msgs = [];
      }

      for (const pid of batch) {
        const def = PID_BY_ID.get(pid);
        if (!def) continue;
        const msg = msgs.find((m) => dataBytes(m, 0x01, pid));
        if (!msg) continue;
        const data = dataBytes(msg, 0x01, pid);
        if (!data) continue;
        out.set(pid, { value: def.decode(data), bytes: data });
      }

      // Some ECUs reject multi-PID requests — retry individually.
      const foundAny = batch.some((p) => out.has(p));
      if (!foundAny && batch.length > 1) {
        for (const pid of batch) {
          try {
            const single = await adapter.request(`01${hex(pid)}`, 0x41, 2500);
            const msg = single.find((m) => dataBytes(m, 0x01, pid));
            const data = msg ? dataBytes(msg, 0x01, pid) : null;
            const def = PID_BY_ID.get(pid);
            if (data && def) out.set(pid, { value: def.decode(data), bytes: data });
          } catch {
            /* not supported by this ECU */
          }
        }
      }
    }
    return out;
  }

  async readSupportedPids(): Promise<number[]> {
    const adapter = this.requireAdapter();
    const supported: number[] = [];
    for (const base of [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0]) {
      let bitmap: number[] | null = null;
      try {
        const msgs = await adapter.request(`01${hex(base)}`, 0x41, 3000);
        const msg = msgs.find((m) => dataBytes(m, 0x01, base));
        if (msg) bitmap = dataBytes(msg, 0x01, base)?.slice(0, 4) ?? null;
      } catch {
        bitmap = null;
      }
      if (!bitmap || bitmap.length < 4) break;
      for (let i = 0; i < 32; i++) {
        if (bitmap[Math.floor(i / 8)] & (0x80 >> (i % 8))) supported.push(base + 1 + i);
      }
      if (bitmap.every((b) => b === 0)) break;
    }
    return supported;
  }

  private extractAscii(msgs: Message[], mode: number, pid: number): string {
    let text = '';
    for (const msg of msgs) {
      const d = msg.data;
      for (let i = 0; i <= d.length - 3; i++) {
        if (d[i] === mode + 0x40 && d[i + 1] === pid) {
          let j = i + 2;
          if (d[j] <= 0x20) j += 1; // frame index byte
          text += d
            .slice(j)
            .map((b) => String.fromCharCode(b))
            .join('');
          break;
        }
      }
    }
    return text;
  }

  async readVin(): Promise<string> {
    const adapter = this.requireAdapter();
    try {
      const msgs = await adapter.request('0902', 0x49, 6000);
      const cleaned = this.extractAscii(msgs, 0x09, 0x02)
        .toUpperCase()
        .replace(/[^A-HJ-NPR-Z0-9]/g, '');
      if (cleaned.length >= 17) return cleaned.slice(0, 17);
      // Some ECUs answer 0902 with a plain ASCII run — fall back to that.
      const raw = this.extractAscii(msgs, 0x09, 0x02).toUpperCase().replace(/[^A-Z0-9]/g, '');
      return raw.length >= 17 ? raw.slice(0, 17) : cleaned;
    } catch {
      return '';
    }
  }

  // ---- codes --------------------------------------------------------------

  async readCodes(kind: DtcKind): Promise<DtcRecord[]> {
    const adapter = this.requireAdapter();
    const mode = kind === 'stored' ? 0x03 : kind === 'pending' ? 0x07 : 0x0a;
    let msgs: Message[];
    try {
      msgs = await adapter.request(hex(mode), mode + 0x40, 8000);
    } catch {
      return [];
    }
    const out: DtcRecord[] = [];
    for (const msg of msgs) {
      if (!msg.data.includes(mode + 0x40)) continue;
      const codes = parseDtcPayload(msg.data);
      for (const code of codes) {
        out.push({ code, kind, ecu: ecuLabel(msg.header), header: msg.header });
      }
    }
    // De-duplicate on code+kind+header (broadcast requests can repeat frames).
    const seen = new Set<string>();
    return out.filter((r) => {
      const key = `${r.code}|${r.kind}|${r.header}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async readAllCodes(): Promise<{ stored: DtcRecord[]; pending: DtcRecord[]; permanent: DtcRecord[] }> {
    const stored = await this.readCodes('stored');
    const pending = await this.readCodes('pending');
    const permanent = await this.readCodes('permanent');
    useApp.setState({ dtcs: stored, pending, permanent });
    return { stored, pending, permanent };
  }

  async clearCodes(): Promise<{ ok: boolean; message: string }> {
    const adapter = this.requireAdapter();
    try {
      await adapter.send('04', 6000);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'The ECU did not acknowledge the clear request.' };
    }
    // Permanent codes are stored in non-volatile memory and survive a clear.
    const before = useApp.getState();
    useApp.setState({ clearedAt: Date.now(), dtcs: [], pending: [], monitors: null, cycleMonitors: null });
    pushLog('info', 'Mode 04 clear acknowledged by the ECU.');

    await sleep(1200);
    const after = await this.readAllCodes().catch(() => ({ stored: [], pending: [], permanent: [] }));
    const stillThere = [...after.stored, ...after.permanent].map((d) => d.code);
    const kept = before.permanent.map((d) => d.code).filter((c) => stillThere.includes(c));

    if (kept.length) {
      return {
        ok: true,
        message: `Codes cleared. ${kept.join(', ')} is a permanent code and only clears itself after the vehicle proves the repair across several drive cycles.`,
      };
    }
    return { ok: true, message: 'Codes cleared and the ECU confirmed an empty fault memory.' };
  }

  // ---- freeze frame -------------------------------------------------------

  async readFreezeFrame(): Promise<void> {
    const adapter = this.requireAdapter();
    const rows: FreezeRow[] = [];
    let frameCode: string | null = null;
    try {
      const dtcMsgs = await adapter.request('0202', 0x42, 4000);
      for (const msg of dtcMsgs) {
        const d = msg.data;
        const idx = d.indexOf(0x42);
        if (idx >= 0 && d[idx + 1] === 0x02 && d.length >= idx + 5) {
          const hi = d[idx + 3];
          const lo = d[idx + 4];
          if (hi || lo) {
            const letter = ['P', 'C', 'B', 'U'][(hi >> 6) & 3];
            const digit = (hi >> 4) & 3;
            const rest = (((hi & 0x0f) << 8) | lo).toString(16).toUpperCase().padStart(3, '0');
            frameCode = `${letter}${digit}${rest}`;
            break;
          }
        }
      }
    } catch {
      /* no freeze frame stored */
    }

    const preferred = [0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x2f, 0x42];
    for (const pid of preferred) {
      try {
        const msgs = await adapter.request(`02${hex(pid)}`, 0x42, 2500);
        for (const msg of msgs) {
          const d = msg.data;
          const idx = d.indexOf(0x42);
          if (idx < 0 || d[idx + 1] !== pid) continue;
          const data = d.slice(idx + 3); // skip service, pid, frame number
          const def = PID_BY_ID.get(pid);
          if (def && data.length) {
            rows.push({ pid, name: def.name, short: def.short, value: def.decode(data), unit: def.unit });
          }
          break;
        }
      } catch {
        /* frame PID not stored */
      }
    }

    useApp.setState({ freeze: rows, freezeCode: frameCode });
  }

  // ---- mode 06 monitors ---------------------------------------------------

  async readMode6(): Promise<void> {
    const adapter = this.requireAdapter();
    const rows: Mode6Row[] = [];
    const mids = [0x01, 0x21, 0x31, 0x39, 0x3a, 0x41, 0x51, 0x61, 0xa1];
    for (const mid of mids) {
      try {
        const msgs = await adapter.request(`06${hex(mid)}`, 0x46, 2500);
        for (const msg of msgs) {
          const d = msg.data;
          const idx = d.indexOf(0x46);
          if (idx < 0 || d[idx + 1] !== mid) continue;
          const tid = d[idx + 2] ?? 0;
          const uas = d[idx + 3] ?? 0;
          const rest = d.slice(idx + 4);
          if (rest.length < 6) continue;
          const value = (rest[0] << 8) | rest[1];
          const min = (rest[2] << 8) | rest[3];
          const max = (rest[4] << 8) | rest[5];
          rows.push({
            mid,
            tid,
            name: MID_NAMES[mid] ?? `Monitor MID ${hex(mid)}`,
            value,
            min,
            max,
            unit: uas === 0x01 ? '' : `UAS ${hex(uas)}`,
            pass: max === 0 || (value >= min && value <= max),
          });
          break;
        }
      } catch {
        /* MID unsupported on this ECU */
      }
    }
    useApp.setState({ tests: rows });
  }

  // ---- vehicle info -------------------------------------------------------

  async readVersions(): Promise<void> {
    const adapter = this.requireAdapter();
    const versions: { calId?: string; cvn?: string; ecuName?: string } = {};
    try {
      const cal = await adapter.request('0904', 0x49, 4000);
      const text = this.extractAscii(cal, 0x09, 0x04).replace(/[^\x20-\x7e]/g, '').trim();
      if (text) versions.calId = text;
    } catch {
      /* not supported */
    }
    try {
      const cvn = await adapter.request('0906', 0x49, 4000);
      for (const msg of cvn) {
        const idx = msg.data.indexOf(0x49);
        if (idx >= 0 && msg.data[idx + 1] === 0x06) {
          const bytes = msg.data.slice(idx + 4);
          if (bytes.length) versions.cvn = bytes.slice(0, 4).map((b) => hex(b)).join('');
          break;
        }
      }
    } catch {
      /* not supported */
    }
    try {
      const name = await adapter.request('090a', 0x49, 4000);
      const text = this.extractAscii(name, 0x09, 0x0a).replace(/[^\x20-\x7e]/g, '').trim();
      if (text) versions.ecuName = text;
    } catch {
      /* not supported */
    }
    useApp.setState({ versions });
  }

  // ---- full scan ----------------------------------------------------------

  async fullScan(): Promise<void> {
    if (!this.adapter?.isConnected) return;
    useApp.setState({ scanning: true, scanProgress: 2, scanLabel: 'Finding modules on the bus' });

    try {
      const headers = await this.adapter.probeEcuHeaders();
      useApp.setState({
        ecus: headers.map((h) => ({ header: h, label: ecuLabel(h) })),
        scanProgress: 12,
        scanLabel: 'Reading vehicle identification',
      });

      const vinRaw = await this.readVin();
      const vin = vinRaw.length === 17 ? decodeVin(vinRaw) : null;
      useApp.setState({ vin, scanProgress: 26, scanLabel: 'Listing supported sensors' });

      const supported = await this.readSupportedPids();
      useApp.setState({ supported, scanProgress: 42, scanLabel: 'Checking readiness monitors' });

      let monitors = null;
      try {
        const msgs = await this.adapter.request('0101', 0x41, 3000);
        const msg = msgs.find((m) => dataBytes(m, 0x01, 0x01));
        const data = msg ? dataBytes(msg, 0x01, 0x01) : null;
        if (data && data.length >= 4) {
          monitors = decodeMonitors(data);
          let cycle = null;
          try {
            const cmsgs = await this.adapter.request('0141', 0x41, 3000);
            const cmsg = cmsgs.find((m) => dataBytes(m, 0x01, 0x41));
            const cdata = cmsg ? dataBytes(cmsg, 0x01, 0x41) : null;
            if (cdata) cycle = decodeCycleMonitors(cdata, monitors.sinceClear);
          } catch {
            /* PID 41 not supported */
          }
          useApp.setState({ monitors, cycleMonitors: cycle });
        }
      } catch {
        /* no readiness data */
      }

      useApp.setState({ scanProgress: 58, scanLabel: 'Reading trouble codes' });
      await this.readAllCodes();

      useApp.setState({ scanProgress: 72, scanLabel: 'Pulling freeze-frame data' });
      await this.readFreezeFrame();

      useApp.setState({ scanProgress: 84, scanLabel: 'Collecting on-board test results' });
      await this.readMode6();

      useApp.setState({ scanProgress: 94, scanLabel: 'Reading module calibration data' });
      await this.readVersions();

      await this.refreshVoltage();
      useApp.setState({ scanProgress: 100, scanLabel: 'Scan complete' });
      pushLog('info', 'Scan complete.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushLog('error', `Scan stopped: ${message}`);
      useApp.setState({ conn: { ...useApp.getState().conn, message: `Scan stopped: ${message}` } });
    } finally {
      useApp.setState({ scanning: false, lastScanAt: Date.now() });
      window.setTimeout(() => useApp.setState({ scanProgress: 0, scanLabel: '' }), 900);
    }
  }

  // ---- live data ----------------------------------------------------------

  startLive(): void {
    if (this.liveRunning || !this.adapter) return;
    this.liveRunning = true;
    // Phone on a windscreen mount: keep the screen awake so gauges keep moving.
    setWakeLock(true);
    useApp.setState({ liveActive: true });

    const loop = async () => {
      if (!this.liveRunning || !this.adapter) return;
      const started = performance.now();
      const pids = useApp.getState().livePids;
      try {
        const values = await this.readPids(pids);
        if (values.size) this.pushSample(values);
        const hz = 1000 / Math.max(1, performance.now() - started);
        useApp.setState({ liveHz: Math.round(hz * 10) / 10 });
      } catch {
        /* transient bus errors are normal during polling */
      }
      if (this.liveRunning) this.liveTimer = window.setTimeout(loop, 40);
    };
    void loop();
  }

  stopLive(): void {
    this.liveRunning = false;
    setWakeLock(false);
    if (this.liveTimer !== null) {
      window.clearTimeout(this.liveTimer);
      this.liveTimer = null;
    }
    useApp.setState({ liveActive: false, liveHz: 0 });
  }

  private pushSample(values: Map<number, { value: number; bytes: number[] }>) {
    const { live } = useApp.getState();
    const next: Record<number, { values: number[]; stamps: number[] }> = { ...live };
    const now = Date.now();
    for (const [pid, res] of values) {
      const prior = next[pid] ?? { values: [], stamps: [] };
      next[pid] = {
        values: [...prior.values, res.value].slice(-150),
        stamps: [...prior.stamps, now].slice(-150),
      };
    }
    useApp.setState({ live: next });
  }

  async sendRaw(cmd: string): Promise<string> {
    const adapter = this.requireAdapter();
    try {
      return await adapter.send(cmd.toUpperCase(), 5000);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async readCustom(mode: number, pid: number, header?: string): Promise<number[] | null> {
    const adapter = this.requireAdapter();
    if (header) await adapter.send(`ATSH${header}`).catch(() => undefined);
    try {
      const cmd = `${hex(mode)}${hex(pid)}`;
      const msgs = await adapter.request(cmd, mode + 0x40, 3000);
      const msg = msgs[0];
      if (!msg) return null;
      const d = msg.data;
      const idx = d.indexOf(mode + 0x40);
      return idx >= 0 ? d.slice(idx + 2) : d.slice(2);
    } catch {
      return null;
    } finally {
      if (header) await adapter.send('ATSH7E0').catch(() => undefined);
    }
  }
}

export const service = new ObdService();
