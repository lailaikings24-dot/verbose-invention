/**
 * ELM327 command layer.
 *
 * Handles the adapter handshake, prompt-terminated framing, ISO-TP frame
 * reassembly and multi-ECU response grouping. Knows nothing about OBD-II
 * semantics — see obd/ for that.
 */
import type { ConnectOptions, Transport } from './transport';

export type LogDir = 'tx' | 'rx' | 'info' | 'error';
export type LogFn = (dir: LogDir, text: string) => void;

export interface Message {
  /** CAN/ISO header as printed by the adapter, or '' when headers are off. */
  header: string;
  data: number[];
}

export class AdapterError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

const NO_DATA_TOKENS = ['NO DATA', 'NODATA'];
const TRANSIENT = [
  'SEARCHING...',
  'SEARCHING',
  'BUS INIT: ...OK',
  'BUSINIT',
  'BUS INIT',
  'STOPPED',
  'WAITING',
];

export const PROTOCOLS: Record<string, string> = {
  '0': 'Auto',
  '1': 'SAE J1850 PWM (41.6 kbaud)',
  '2': 'SAE J1850 VPW (10.4 kbaud)',
  '3': 'ISO 9141-2 (5 baud init)',
  '4': 'ISO 14230-4 KWP (5 baud init)',
  '5': 'ISO 14230-4 KWP (fast init)',
  '6': 'ISO 15765-4 CAN (11-bit, 500 kbaud)',
  '7': 'ISO 15765-4 CAN (29-bit, 500 kbaud)',
  '8': 'ISO 15765-4 CAN (11-bit, 250 kbaud)',
  '9': 'ISO 15765-4 CAN (29-bit, 250 kbaud)',
  A: 'SAE J1939 CAN (29-bit, 250 kbaud)',
  B: 'USER1 CAN',
  C: 'USER2 CAN',
};

export class Elm327 {
  private transport: Transport | null = null;
  private buffer = '';
  private waiter: {
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timer: number;
    startedAt: number;
  } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private log: LogFn = () => {};
  private headersOn = true;
  private lastRtt = 0;

  protocolNumber = '';
  adapterId = '';
  voltage = 0;

  /** Round-trip time of the last answered command, in milliseconds. */
  get latency(): number {
    return this.lastRtt;
  }

  setLogger(fn: LogFn) {
    this.log = fn;
  }

  get isConnected() {
    return !!this.transport;
  }

  get transportKind() {
    return this.transport?.kind ?? null;
  }

  async open(transport: Transport, options?: ConnectOptions): Promise<void> {
    this.transport = transport;
    this.buffer = '';
    await transport.connect((chunk) => this.feed(chunk), options);
    this.log('info', `Link established: ${transport.label}`);
  }

  /**
   * Split incoming bytes on the ELM327 prompt. A single BLE notification can
   * carry more than one complete response (or the tail of the previous one),
   * so every prompt in the buffer is drained, not just the first.
   */
  private feed(chunk: string) {
    this.buffer += chunk;

    for (let guard = 0; guard < 64; guard++) {
      const prompt = this.buffer.indexOf('>');
      if (prompt === -1) break;
      const raw = this.buffer.slice(0, prompt);
      this.buffer = this.buffer.slice(prompt + 1);
      const cleaned = raw.replace(/\0/g, '').replace(/\r/g, '\n');

      const waiter = this.waiter;
      if (!waiter) {
        // Late answer from a command that already timed out. Keep it visible in
        // the log instead of dropping it, which is how stale-data bugs start.
        if (cleaned.trim()) this.log('rx', `${cleaned.trim()}  (unsolicited)`);
        continue;
      }
      this.waiter = null;
      window.clearTimeout(waiter.timer);
      this.lastRtt = Date.now() - waiter.startedAt;
      this.log('rx', cleaned.trim() || '(empty)');
      waiter.resolve(cleaned);
    }

    // Guard against runaway buffers from a chatty/incompatible adapter.
    if (this.buffer.length > 8192) this.buffer = this.buffer.slice(-2048);
  }

  private raw(cmd: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.transport) {
        reject(new AdapterError('No adapter connected.', 'NO_LINK'));
        return;
      }
      this.buffer = '';
      const timer = window.setTimeout(() => {
        this.waiter = null;
        reject(new AdapterError(`Adapter did not answer "${cmd}" in time.`, 'TIMEOUT'));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer, startedAt: Date.now() };
      this.log('tx', cmd);
      this.transport.write(`${cmd}\r`).catch((err: unknown) => {
        if (this.waiter) {
          window.clearTimeout(this.waiter.timer);
          this.waiter = null;
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** Serialised command send — ELM327 has no flow control, one at a time. */
  send(cmd: string, timeoutMs = 5000): Promise<string> {
    const run = () => this.raw(cmd, timeoutMs);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Send with a bounded retry — clones routinely drop the first command. */
  async sendRetry(cmd: string, timeoutMs = 5000, attempts = 2): Promise<string> {
    let lastError: unknown = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.send(cmd, timeoutMs);
      } catch (err) {
        lastError = err;
        if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Handshake.
   *
   * `warm` is the reconnect path: no ATZ (a full reset costs seconds, drops the
   * negotiated protocol and re-triggers bus search) — just re-assert the
   * settings and prove the vehicle bus still answers. If it does not, the
   * caller falls back to a cold start.
   */
  async init(options: { warm?: boolean } = {}): Promise<void> {
    if (!options.warm) {
      // A hard reset lets the adapter auto-baud to whatever bus is on the car.
      await this.send('ATZ', 6000).catch(() => '');
      // Clones need a beat after the banner before they accept commands again.
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    await this.send('ATE0').catch(() => ''); // echo off
    await this.send('ATL0').catch(() => ''); // linefeeds off
    await this.send('ATS1').catch(() => ''); // spaces on — needed for reliable parsing
    await this.send('ATAT2').catch(() => ''); // aggressive adaptive timing
    await this.send('ATSP0').catch(() => ''); // protocol auto

    if (options.warm) {
      const probe = await this.send('0100', 8000).catch(() => '');
      if (!/41\s*00\s*[0-9A-F]{2}/i.test(probe)) {
        throw new Error('The vehicle bus did not answer after the link came back. Check the ignition is still on.');
      }
    } else {
      this.adapterId = (await this.send('ATI').catch(() => '')).trim().split('\n')[0] || 'ELM327';
      // First OBD request triggers protocol negotiation on the vehicle bus.
      await this.send('0100', 9000).catch(() => '');
    }

    const dpn = (await this.send('ATDPN').catch(() => '')).trim();
    const match = dpn.match(/A?([0-9A-C])/i);
    this.protocolNumber = match ? match[1].toUpperCase() : this.protocolNumber || '0';

    // Headers are only worth switching on for CAN — on ISO/KWP they collide
    // with the payload and cost us per-ECU attribution anyway.
    this.headersOn = this.isCan;
    await this.send(this.headersOn ? 'ATH1' : 'ATH0').catch(() => '');
    await this.send('ATCAF1').catch(() => '');

    await this.readVoltage();
  }

  get isCan(): boolean {
    return ['6', '7', '8', '9', 'A', 'B', 'C'].includes(this.protocolNumber);
  }

  get protocolName(): string {
    return PROTOCOLS[this.protocolNumber] || 'Unknown';
  }

  async readVoltage(): Promise<number> {
    const res = (await this.send('ATRV').catch(() => '')).trim();
    const m = res.match(/([\d.]+)\s*V/i);
    if (m) {
      const v = Number.parseFloat(m[1]);
      if (Number.isFinite(v) && v > 0) this.voltage = v;
    }
    return this.voltage;
  }

  /** Strip echo / status noise and hand back clean message groups. */
  parse(raw: string, expectMode?: number): Message[] {
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const frames: { header: string; bytes: number[] }[] = [];
    let sawNoData = false;

    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper === 'OK' || upper === '?') continue;
      if (NO_DATA_TOKENS.some((t) => upper.includes(t))) {
        sawNoData = true;
        continue;
      }
      if (TRANSIENT.some((t) => upper.includes(t))) continue;
      if (/^(ELM327|OBDII|V\d|STN)/i.test(upper) && !/[0-9A-F]{2}\s[0-9A-F]{2}/.test(upper)) {
        this.log('info', line);
        continue;
      }
      if (/^(ERR|CANERROR|BUFFER FULL|BUS ERROR|FB ERROR|LV RESET|ACT ALERT)/i.test(upper)) {
        this.log('error', line);
        continue;
      }

      const tokens = upper.split(/\s+/).filter((t) => /^[0-9A-F]+$/.test(t));
      if (!tokens.length) continue;

      // 11-bit CAN header (3 chars) or 29-bit (8 chars) when headers are on.
      let header = '';
      let payload = tokens;
      const canHeaderRe = /^[0-9A-F]{3}$/;
      if (this.headersOn && this.isCan && canHeaderRe.test(tokens[0])) {
        header = tokens[0];
        payload = tokens.slice(1);
      } else if (this.headersOn && this.isCan && tokens[0].length === 8) {
        header = tokens[0];
        payload = tokens.slice(1);
      }

      const bytes = payload.join('').match(/.{1,2}/g)?.map((h) => Number.parseInt(h, 16)) ?? [];
      if (bytes.length) frames.push({ header, bytes });
    }

    if (!frames.length) {
      if (sawNoData) throw new AdapterError('No data from the vehicle.', 'NO_DATA');
      return [];
    }

    // Group frames by ECU header, then reassemble ISO-TP where present.
    const groups = new Map<string, number[][]>();
    for (const f of frames) {
      const key = f.header || '_';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f.bytes);
    }

    const out: Message[] = [];
    for (const [key, list] of groups) {
      const joined = reassemble(list);
      for (const data of joined) {
        if (expectMode !== undefined && !data.includes(expectMode)) continue;
        out.push({ header: key === '_' ? '' : key, data });
      }
    }
    return out;
  }

  async request(payload: string, expectMode?: number, timeoutMs = 3000): Promise<Message[]> {
    const raw = await this.send(payload, timeoutMs);
    return this.parse(raw, expectMode);
  }

  /** Ask the adapter which modules are answering on the bus. */
  async probeEcuHeaders(): Promise<string[]> {
    if (!this.isCan || !this.headersOn) return [''];
    try {
      const msgs = await this.request('0100', 0x41, 8000);
      return [...new Set(msgs.map((m) => m.header).filter(Boolean))];
    } catch {
      return [''];
    }
  }

  async close(): Promise<void> {
    if (this.waiter) {
      window.clearTimeout(this.waiter.timer);
      this.waiter = null;
    }
    try {
      await this.transport?.disconnect();
    } finally {
      this.transport = null;
      this.buffer = '';
    }
  }
}

/** ISO-TP (ISO 15765-2) single/multi-frame reassembly. */
export function reassemble(frames: number[][]): number[][] {
  const out: number[][] = [];
  let buffer: number[] | null = null;
  let expected = 0;

  for (const frame of frames) {
    if (!frame.length) continue;
    const pci = frame[0] >>> 4;

    if (pci === 0x0) {
      // Single frame: low nibble = payload length.
      const len = frame[0] & 0x0f;
      if (len > 0 && len <= frame.length - 1) out.push(frame.slice(1, 1 + len));
      else out.push(frame.slice(1));
      buffer = null;
      continue;
    }
    if (pci === 0x1) {
      // First frame: 12-bit length in the low nibble + next byte.
      expected = ((frame[0] & 0x0f) << 8) | frame[1];
      buffer = frame.slice(2);
      continue;
    }
    if (pci === 0x2) {
      // Consecutive frame.
      if (buffer) {
        buffer.push(...frame.slice(1));
        if (buffer.length >= expected) {
          out.push(buffer.slice(0, expected));
          buffer = null;
        }
      }
      continue;
    }
    // No PCI (already de-formatted by ATCAF1 or a non-CAN bus): raw payload.
    out.push(frame);
  }

  if (buffer && buffer.length) out.push(expected ? buffer.slice(0, expected) : buffer);
  return out;
}

/** Read 2 data bytes for a Mode 01 PID from a response message. */
export function dataBytes(msg: Message, mode: number, pid: number): number[] | null {
  const resp = mode + 0x40;
  const d = msg.data;
  for (let i = 0; i <= d.length - 2; i++) {
    if (d[i] === resp && d[i + 1] === pid) return d.slice(i + 2);
  }
  return null;
}
