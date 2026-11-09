/**
 * Virtual ELM327 adapter + vehicle bus.
 *
 * This is a real ELM327 emulator: it speaks the same AT command set, emits
 * ISO-TP frames, and models two ECUs so the whole app can be exercised without
 * hardware. It is also what makes the app demonstrable on a laptop.
 */
import type { Transport } from './transport';
import { hex } from './format';

interface Ecu {
  request: string;
  response: string;
  name: string;
  stored: string[];
  pending: string[];
  permanent: string[];
  calId: string;
  cvn: string;
}

const VIN = '1HGBH41JXMN109186';

const ECUS: Ecu[] = [
  {
    request: '7E0',
    response: '7E8',
    name: 'ECM / Engine Control',
    stored: ['P0171', 'P0301'],
    pending: ['P0301'],
    permanent: ['P0420'],
    calId: '37805-RNA-A540',
    cvn: 'A1B2C3D4',
  },
  {
    request: '7E1',
    response: '7E9',
    name: 'TCM / Transmission Control',
    stored: [],
    pending: [],
    permanent: [],
    calId: '28105-RNA-3050',
    cvn: '55AA1234',
  },
];

/** PIDs this virtual car advertises. */
const SUPPORTED = new Set([
  0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11,
  0x13, 0x14, 0x15, 0x1c, 0x1f, 0x21, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32,
  0x33, 0x3c, 0x3e, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x49, 0x4a, 0x4c,
  0x51, 0x5c, 0x5e, 0x62,
]);

function dtcBytes(code: string): [number, number] {
  const letterBits: Record<string, number> = { P: 0, C: 1, B: 2, U: 3 };
  const hi = Number.parseInt(code[1], 10);
  const rest = Number.parseInt(code.slice(2), 16);
  return [((letterBits[code[0]] ?? 0) << 6) | (hi << 4) | ((rest >> 8) & 0x0f), rest & 0xff];
}

export class DemoTransport implements Transport {
  readonly kind = 'demo' as const;
  readonly label = 'Demo vehicle';
  readonly detail = 'Honda Accord 2.4 — virtual ELM327';

  private onData: ((chunk: string) => void) | null = null;
  private headers = false;
  private echo = false;
  private running = true;
  private t0 = Date.now();
  private cleared = false;
  private fuel = 64;
  private coolStart = Date.now();
  private engineOn = true;

  async connect(onData: (chunk: string) => void): Promise<void> {
    this.onData = onData;
    this.t0 = Date.now();
    this.coolStart = Date.now();
    await new Promise((r) => setTimeout(r, 260));
  }

  async write(text: string): Promise<void> {
    const commands = text.split('\r').map((c) => c.trim().toUpperCase()).filter(Boolean);
    for (const cmd of commands) {
      // Mimic adapter latency so the UI shows realistic polling throughput.
      await new Promise((r) => setTimeout(r, 8 + Math.random() * 14));
      const response = this.handle(cmd);
      const echo = this.echo ? `${cmd}\r` : '';
      this.onData?.(`${echo}${response}\r\r>`);
    }
  }

  async disconnect(): Promise<void> {
    this.onData = null;
  }

  // ---- vehicle model -------------------------------------------------------

  private get elapsed() {
    return (Date.now() - this.t0) / 1000;
  }

  private value(pid: number): number {
    const t = this.elapsed;
    const wave = (period: number, amp: number, phase = 0) =>
      Math.sin((t / period) * Math.PI * 2 + phase) * amp;

    switch (pid) {
      case 0x04:
        return 34 + wave(9, 7);
      case 0x05: {
        // This car is already up to temperature — it is cruising at 62 km/h.
        const warm = Math.min(1, (Date.now() - this.coolStart) / 45_000);
        return 82 + warm * 6 + wave(30, 0.9);
      }
      case 0x06:
        return 3.5 + wave(1.1, 4.5);
      case 0x07:
        return 14.8; // the lean fault this demo car is carrying
      case 0x0b:
        return 38 + wave(7, 3.5);
      case 0x0c:
        return 1985 + wave(3.5, 55) + wave(0.7, 18);
      case 0x0d:
        return 62 + wave(16, 4);
      case 0x0e:
        return 19 + wave(5, 3);
      case 0x0f:
        return 33;
      case 0x10:
        return 12.6 + wave(4, 1.2);
      case 0x11:
        return 17 + wave(6, 3);
      case 0x14:
        return 0.44 + wave(0.35, 0.36);
      case 0x15:
        return 0.62 + wave(2.4, 0.05);
      case 0x1f:
        return 480 + t;
      case 0x21:
        return this.cleared ? 0 : 182;
      case 0x2c:
        return 0;
      case 0x2d:
        return wave(6, 4);
      case 0x2e:
        return 22 + wave(8, 10);
      case 0x2f:
        this.fuel = Math.max(12, this.fuel - 0.0004);
        return this.fuel;
      case 0x30:
        return this.cleared ? 0 : 6;
      case 0x31:
        return this.cleared ? 0 : 412;
      case 0x32:
        return 12 + wave(11, 22);
      case 0x33:
        return 101;
      case 0x3c:
        return 492 + wave(6, 14);
      case 0x3e:
        return 430 + wave(7, 10);
      case 0x42:
        return 14.18 + wave(4, 0.08);
      case 0x43:
        return 29 + wave(9, 6);
      case 0x44:
        return 0.99 + wave(1.7, 0.03);
      case 0x45:
        return 17 + wave(6, 3);
      case 0x46:
        return 24;
      case 0x47:
        return 16 + wave(6, 3);
      case 0x49:
        return 24 + wave(5, 9);
      case 0x4a:
        return 25 + wave(5, 9);
      case 0x4c:
        return 17 + wave(6, 3);
      case 0x51:
        return 1; // petrol
      case 0x5c:
        return 97 + wave(25, 2);
      case 0x5e:
        return 2.4 + wave(7, 1.1);
      case 0x62:
        return 18 + wave(5, 12);
      default:
        return 0;
    }
  }

  private encode(pid: number, v: number): number[] {
    const u16 = (x: number) => {
      const n = Math.max(0, Math.min(65535, Math.round(x)));
      return [(n >> 8) & 0xff, n & 0xff];
    };
    const pct = (x: number) => Math.max(0, Math.min(255, Math.round((x * 255) / 100)));
    const clamp255 = (x: number) => Math.max(0, Math.min(255, Math.round(x)));

    switch (pid) {
      case 0x04:
        return [pct(v)];
      case 0x05:
        return [clamp255(v + 40)];
      case 0x06:
      case 0x07:
        return [clamp255(v * (128 / 100) + 128)];
      case 0x0b:
        return [clamp255(v)];
      case 0x0c:
        return u16(v * 4);
      case 0x0d:
        return [clamp255(v)];
      case 0x0e:
        return [clamp255((v + 64) * 2)];
      case 0x0f:
        return [clamp255(v + 40)];
      case 0x10:
        return u16(v * 100);
      case 0x11:
        return [pct(v)];
      case 0x13:
        return [0x03];
      case 0x14:
      case 0x15:
        return [clamp255(v * 200), clamp255(128)];
      case 0x1c:
        return [0x06];
      case 0x1f:
      case 0x21:
      case 0x31:
        return u16(v);
      case 0x2c:
      case 0x2e:
      case 0x2f:
      case 0x45:
      case 0x47:
      case 0x49:
      case 0x4a:
      case 0x4c:
        return [pct(v)];
      case 0x2d:
        return [clamp255(v * (128 / 100) + 128)];
      case 0x30:
        return [clamp255(v)];
      case 0x32:
        return u16((v + 8192) * 4);
      case 0x33:
        return [clamp255(v)];
      case 0x3c:
      case 0x3d:
      case 0x3e:
        return u16((v + 40) * 10);
      case 0x41:
        return [0x01, 0x08, 0x00, 0x00];
      case 0x42:
        return u16(v * 1000);
      case 0x43:
        return u16((v * 255) / 100);
      case 0x44:
        return u16((v * 65536) / 2);
      case 0x46:
        return [clamp255(v + 40)];
      case 0x51:
        return [clamp255(v)];
      case 0x5c:
        return [clamp255(v + 40)];
      case 0x5e:
        return u16(v * 20);
      case 0x62:
        return [clamp255(v + 125)];
      default:
        return [0];
    }
  }

  private supportBitmap(base: number): number[] {
    const bytes = [0, 0, 0, 0];
    for (let i = 0; i < 32; i++) {
      if (SUPPORTED.has(base + 1 + i)) bytes[Math.floor(i / 8)] |= 0x80 >> (i % 8);
    }
    return bytes;
  }

  // ---- command handling ----------------------------------------------------

  private frame(payload: number[]): string {
    return payload.map((b) => hex(b)).join(' ');
  }

  /** Emit a payload as ISO-TP frames from the engine ECU. */
  private emit(payload: number[], header = '7E8'): string {
    const lines: string[] = [];
    if (!this.headers) return this.frame(payload);

    if (payload.length <= 7) {
      lines.push(`${header} ${hex(payload.length)} ${this.frame(payload)}`);
      return lines.join('\r');
    }
    const total = payload.length;
    lines.push(`${header} ${hex(0x10 | (total >> 8))} ${hex(total & 0xff)} ${this.frame(payload.slice(0, 6))}`);
    let offset = 6;
    let seq = 1;
    while (offset < total) {
      lines.push(`${header} ${hex(0x20 | (seq & 0x0f))} ${this.frame(payload.slice(offset, offset + 7))}`);
      offset += 7;
      seq++;
    }
    return lines.join('\r');
  }

  private dtcPayload(mode: number, codes: string[]): string {
    const bytes: number[] = [mode + 0x40, codes.length];
    for (const code of codes) bytes.push(...dtcBytes(code));
    return this.emit(bytes.length <= 7 ? bytes : bytes);
  }

  private handle(cmd: string): string {
    const ecu = ECUS[0];

    if (cmd.startsWith('AT')) {
      switch (cmd) {
        case 'ATZ':
          this.headers = false;
          this.echo = false;
          return 'ELM327 v1.5';
        case 'ATI':
        case 'AT@1':
          return 'ELM327 v1.5';
        case 'ATE0':
          this.echo = false;
          return 'OK';
        case 'ATE1':
          this.echo = true;
          return 'OK';
        case 'ATL0':
        case 'ATS1':
        case 'ATAT1':
        case 'ATAT2':
        case 'ATCAF1':
        case 'ATCAF0':
        case 'ATSP0':
        case 'ATSP6':
        case 'ATST32':
        case 'ATSH7E0':
          return 'OK';
        case 'ATH1':
          this.headers = true;
          return 'OK';
        case 'ATH0':
          this.headers = false;
          return 'OK';
        case 'ATDPN':
          return 'A6';
        case 'ATDP':
          return 'AUTO, ISO 15765-4 (CAN 11/500)';
        case 'ATRV':
          return `${(14.1 + Math.sin(this.elapsed) * 0.1).toFixed(1)}V`;
        case 'ATIGN':
          return 'ON';
        default:
          return cmd.startsWith('AT') && cmd.length <= 6 ? 'OK' : '?';
      }
    }

    if (cmd === '04') {
      if (this.cleared) return this.emit([0x44]);
      this.cleared = true;
      for (const e of ECUS) {
        e.stored = [];
        e.pending = [];
        // Permanent codes survive a Mode 04 clear by design.
      }
      return this.headers ? `7E8 01 44\r7E9 01 44` : '44';
    }

    if (cmd === '03') {
      const codes = this.cleared ? [] : ecu.stored;
      if (!codes.length) return 'NO DATA';
      return this.dtcPayload(0x03, codes);
    }
    if (cmd === '07') {
      const codes = this.cleared ? [] : ecu.pending;
      if (!codes.length) return 'NO DATA';
      return this.dtcPayload(0x07, codes);
    }
    if (cmd === '0A') {
      const codes = ecu.permanent;
      if (!codes.length) return 'NO DATA';
      return this.dtcPayload(0x0a, codes);
    }

    // Mode 09 — vehicle information.
    if (cmd.startsWith('09')) {
      const pid = Number.parseInt(cmd.slice(2, 4) || '00', 16);
      if (pid === 0x00) return this.emit([0x49, 0x00, 0x55, 0x40, 0x00, 0x00]);
      if (pid === 0x02) return this.vinResponse();
      if (pid === 0x04) return this.asciiResponse(0x04, ecu.calId);
      if (pid === 0x06) return this.cvnResponse(ecu.cvn);
      if (pid === 0x0a) return this.asciiResponse(0x0a, 'ECM-ENGINE');
      return 'NO DATA';
    }

    // Mode 02 — freeze frame.
    if (cmd.startsWith('02')) {
      const pid = Number.parseInt(cmd.slice(2, 4) || '00', 16);
      if (pid === 0x00) {
        const bm = this.supportBitmap(0x00);
        return this.emit([0x42, 0x00, 0x00, ...bm], '7E8');
      }
      if (pid === 0x02) {
        const bytes = dtcBytes(this.cleared ? 'P0301' : 'P0301');
        return this.emit([0x42, 0x02, 0x00, ...bytes]);
      }
      if (SUPPORTED.has(pid)) {
        return this.emit([0x42, pid, 0x00, ...this.encode(pid, this.value(pid))]);
      }
      return 'NO DATA';
    }

    // Mode 06 — on-board monitoring test results.
    if (cmd.startsWith('06')) {
      const mid = Number.parseInt(cmd.slice(2, 4) || '00', 16);
      if (mid === 0x00) return this.emit([0x46, 0x00, 0x00, 0x01, 0x21, 0x40]);
      if (mid === 0x01) {
        // Misfire general — value 42, min 0, max 200
        return this.emit([0x46, 0x01, 0x0b, 0x01, 0x00, 0x2a, 0x00, 0x00, 0x00, 0xc8]);
      }
      if (mid === 0x21) {
        // Catalyst monitor — bank 1
        return this.emit([0x46, 0x21, 0x86, 0x01, 0x01, 0x2c, 0x00, 0x10, 0x00, 0x60]);
      }
      return 'NO DATA';
    }

    // Mode 22 — remember/read data by identifier (brand-specific territory).
    if (cmd.startsWith('22')) {
      const id = cmd.slice(2, 6);
      if (id === 'F190') {
        const ascii = VIN.split('').map((c) => c.charCodeAt(0));
        return this.emit([0x62, 0xf1, 0x90, ...ascii]);
      }
      return 'NO DATA';
    }

    // Mode 01 — live data, possibly several PIDs in one request.
    if (cmd.startsWith('01')) {
      const pids = cmd.slice(2).match(/.{2}/g)?.map((h) => Number.parseInt(h, 16)) ?? [];
      if (!pids.length) return '?';
      const lines: string[] = [];

      if (pids.includes(0x00)) {
        const bm = this.supportBitmap(0x00);
        lines.push(this.emit([0x41, 0x00, ...bm], '7E8'));
        lines.push(this.emit([0x41, 0x00, ...bm], '7E9'));
      }
      for (const pid of pids) {
        if (pid === 0x00) continue;
        if (pid === 0x20 || pid === 0x40 || pid === 0x60) {
          lines.push(this.emit([0x41, pid, ...this.supportBitmap(pid)]));
          continue;
        }
        if (pid === 0x01) {
          lines.push(this.emit([0x41, 0x01, this.cleared ? 0x00 : 0x82, 0x2f, 0x07, 0x00], '7E8'));
          lines.push(this.emit([0x41, 0x01, 0x00, 0x00, 0x00, 0x00], '7E9'));
          continue;
        }
        if (!SUPPORTED.has(pid)) continue;
        const payload = [0x41, pid, ...this.encode(pid, this.value(pid))];
        lines.push(this.emit(payload, '7E8'));
        if (pid === 0x0c || pid === 0x0d) {
          lines.push(this.emit([0x41, pid, ...this.encode(pid, this.value(pid) / 2)], '7E9'));
        }
      }
      return lines.length ? lines.join('\r') : 'NO DATA';
    }

    return '?';
  }

  private vinResponse(): string {
    const ascii = VIN.split('').map((c) => c.charCodeAt(0));
    return this.emit([0x49, 0x02, 0x01, ...ascii]);
  }

  private asciiResponse(pid: number, text: string): string {
    const ascii = text.split('').map((c) => c.charCodeAt(0));
    return this.emit([0x49, pid, 0x01, ...ascii]);
  }

  private cvnResponse(cvn: string): string {
    const bytes = cvn.match(/.{2}/g)?.map((h) => Number.parseInt(h, 16)) ?? [];
    return this.emit([0x49, 0x06, 0x01, ...bytes]);
  }

  get engineRunning() {
    return this.engineOn && this.running;
  }
}
