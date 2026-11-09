/** Diagnostic trouble code encoding / classification. */

export type DtcKind = 'stored' | 'pending' | 'permanent';

export interface DecodedDtc {
  code: string;
  letter: 'P' | 'C' | 'B' | 'U';
  category: string;
  manufacturerSpecific: boolean;
  number: number;
}

const LETTERS: Record<number, 'P' | 'C' | 'B' | 'U'> = { 0: 'P', 1: 'C', 2: 'B', 3: 'U' };

/** Encode two raw DTC bytes into the familiar P0123 form. */
export function encodeDtc(hi: number, lo: number): string {
  const letter = LETTERS[(hi >> 6) & 0x03];
  const digit = (hi >> 4) & 0x03;
  const rest = ((hi & 0x0f) << 8) | lo;
  return `${letter}${digit}${rest.toString(16).toUpperCase().padStart(3, '0')}`;
}

export function decodeDtc(code: string): DecodedDtc | null {
  const m = /^([PCBU])([0-3])([0-9A-F]{3})$/i.exec(code.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase() as 'P' | 'C' | 'B' | 'U';
  const number = Number.parseInt(m[2] + m[3], 16);
  const prefixes: Record<string, string> = {
    P0: 'Powertrain — generic (SAE)',
    P1: 'Powertrain — manufacturer specific',
    P2: 'Powertrain — generic (SAE)',
    P3: 'Powertrain — generic / ignition',
    C0: 'Chassis — generic',
    C1: 'Chassis — manufacturer specific',
    B0: 'Body — generic',
    B1: 'Body — manufacturer specific',
    U0: 'Network — generic',
    U1: 'Network — manufacturer specific',
    U2: 'Network — generic',
    U3: 'Network — manufacturer specific',
  };
  const category = prefixes[letter + m[2]] || `${letter} — ${m[2]}xxx range`;
  return {
    code,
    letter,
    category,
    manufacturerSpecific: m[2] === '1' || m[2] === '3',
    number,
  };
}

/** Split a Mode 03/07/0A response into codes. */
export function parseDtcPayload(data: number[]): string[] {
  const out: string[] = [];
  // data[0] = 0x43/0x47/0x4A, data[1] = count (may be absent on some ECUs).
  let i = 1;
  if (data.length > 1 && data[1] <= 0x7f && (data.length - 2) % 2 === 0) i = 2;
  for (; i + 1 < data.length; i += 2) {
    const hi = data[i];
    const lo = data[i + 1];
    if (hi === 0 && lo === 0) continue;
    out.push(encodeDtc(hi, lo));
  }
  return out;
}

/** Mode 01 PID 01 / 41 / 31 readiness bit layout. */
export interface MonitorStatus {
  mil: boolean;
  dtcCount: number;
  ignition: 'spark' | 'compression' | 'unknown';
  sinceClear: MonitorItem[];
  thisCycle: MonitorItem[];
}

export interface MonitorItem {
  name: string;
  available: boolean;
  /** null = the ECU did not report a completion state for this monitor. */
  complete: boolean | null;
}

const SPARK_MONITORS = [
  'Misfire',
  'Fuel system',
  'Components',
  'Catalyst',
  'Heated catalyst',
  'Evap system',
  'Secondary air',
  'A/C refrigerant',
  'O2 sensor',
  'O2 heater',
  'EGR / VVT',
];

const COMPRESSION_MONITORS = [
  'Misfire',
  'Fuel system',
  'Components',
  'NMHC catalyst',
  'NOx / SCR aftertreatment',
  'Boost pressure',
  'Exhaust gas sensor',
  'PM filter',
  'EGR / VVT',
];

/** Availability bits per ISO 15031-5 for PID 01 byte B (bits 0-7) and byte C (bits 0-2). */
const AVAILABILITY_BITS: [number, number][] = [
  [1, 0x01],
  [1, 0x02],
  [1, 0x04],
  [1, 0x08],
  [1, 0x10],
  [1, 0x20],
  [1, 0x40],
  [1, 0x80],
  [2, 0x01],
  [2, 0x02],
  [2, 0x04],
];

/**
 * Decode PID 01 bytes: A = MIL + DTC count, B/C/D = readiness since clear,
 * and the spare bits of B indicate ignition type.
 */
export function decodeMonitors(d: number[]): MonitorStatus {
  const a = d[0] ?? 0;
  const compression = (d[1] ?? 0) & 0x08 ? false : true;
  const names = compression ? SPARK_MONITORS : COMPRESSION_MONITORS;

  const sinceClear: MonitorItem[] = names.map((name, i) => {
    const [byteIdx, mask] = AVAILABILITY_BITS[i];
    return {
      name,
      available: ((d[byteIdx] ?? 0) & mask) !== 0,
      // PID 01 only advertises monitor support; completion comes from PID 41.
      complete: null,
    };
  });

  return {
    mil: (a & 0x80) !== 0,
    dtcCount: a & 0x7f,
    ignition: compression ? 'spark' : 'compression',
    sinceClear,
    thisCycle: [],
  };
}

/**
 * PID 41 reports monitors that have NOT finished this drive cycle (bit set =
 * still incomplete). Word alignment varies by ECU, so we only trust it when a
 * full 4-byte payload is returned.
 */
export function decodeCycleMonitors(d: number[], sinceClear: MonitorItem[]): MonitorItem[] {
  if (d.length < 4) return sinceClear.map((m) => ({ ...m, complete: null }));
  const bytes = [d[1], d[2], d[3]];
  return sinceClear.map((m, i) => {
    const [byteIdx, mask] = AVAILABILITY_BITS[i];
    const b = bytes[byteIdx - 1] ?? 0;
    return { ...m, complete: m.available ? (b & mask) === 0 : null };
  });
}

export interface MonitorDefinition {
  name: string;
  description: string;
  /** Conditions typically needed to run the monitor. */
  driveCycle: string;
}

export const MONITOR_HELP: Record<string, MonitorDefinition> = {
  Misfire: {
    name: 'Misfire monitor',
    description: 'Watches crankshaft acceleration for combustion misses.',
    driveCycle: 'Idle 2 min, then steady 50–90 km/h for 5 min with a few light accelerations.',
  },
  'Fuel system': {
    name: 'Fuel system monitor',
    description: 'Checks fuel trims against what the oxygen sensor reports.',
    driveCycle: 'Warm engine, closed loop, cruise 60–90 km/h for 5 min.',
  },
  Components: {
    name: 'Comprehensive components',
    description: 'Tests sensor inputs and actuator circuits for plausibility.',
    driveCycle: 'Normal drive of 10+ minutes covering idle, cruise and one full warm-up.',
  },
  Catalyst: {
    name: 'Catalyst monitor',
    description: 'Compares front and rear O2 sensor switching to judge converter efficiency.',
    driveCycle: 'Warm engine, cruise at 65–90 km/h for 6 min without stopping.',
  },
  'Heated catalyst': {
    name: 'Heated catalyst',
    description: 'Checks the catalyst pre-heater circuit.',
    driveCycle: 'Cold start, idle 3 min.',
  },
  'Evap system': {
    name: 'Evaporative system',
    description: 'Pressurises the fuel tank to find leaks.',
    driveCycle: 'Engine off 6+ hours (cold soak), then start and idle 10 min with 1/4–3/4 tank.',
  },
  'Secondary air': {
    name: 'Secondary air injection',
    description: 'Verifies the air pump adds air on cold start.',
    driveCycle: 'Cold start, idle 4 min.',
  },
  'A/C refrigerant': {
    name: 'A/C refrigerant',
    description: 'Checks the refrigerant pressure sensor circuit.',
    driveCycle: 'Ignition on, A/C on for 2 min.',
  },
  'O2 sensor': {
    name: 'O2 sensor monitor',
    description: 'Verifies the oxygen sensor switches between rich and lean.',
    driveCycle: 'Warm engine, cruise 6 min at 60–90 km/h.',
  },
  'O2 heater': {
    name: 'O2 heater monitor',
    description: 'Checks heater resistance and warm-up time.',
    driveCycle: 'Cold start, idle 5 min.',
  },
  'EGR / VVT': {
    name: 'EGR / VVT monitor',
    description: 'Verifies EGR flow or variable valve timing response.',
    driveCycle: 'Warm cruise 50–80 km/h for 5 min with light throttle.',
  },
  'NMHC catalyst': {
    name: 'NMHC catalyst',
    description: 'Diesel lean NOx trap efficiency check.',
    driveCycle: 'Warm cruise 80–100 km/h for 10 min.',
  },
  'NOx / SCR aftertreatment': {
    name: 'NOx / SCR monitor',
    description: 'Checks DEF dosing and NOx conversion efficiency.',
    driveCycle: 'Warm cruise 80–100 km/h for 15 min.',
  },
  'Boost pressure': {
    name: 'Boost pressure monitor',
    description: 'Compares commanded and actual turbo pressure.',
    driveCycle: 'Warm engine, several moderate accelerations to 3000 rpm.',
  },
  'Exhaust gas sensor': {
    name: 'Exhaust gas sensor',
    description: 'Wideband lambda sensor response check.',
    driveCycle: 'Warm cruise 10 min.',
  },
  'PM filter': {
    name: 'Particulate filter',
    description: 'Tracks DPF differential pressure and regeneration.',
    driveCycle: 'Highway drive 20+ min at 80–110 km/h.',
  },
};
