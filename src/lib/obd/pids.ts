/**
 * OBD-II Mode 01 PID catalogue with standard SAE J1979 decoding formulas.
 */

export type PidCategory = 'engine' | 'fuel' | 'emissions' | 'electrical' | 'drivetrain' | 'body';

export interface PidDef {
  pid: number;
  name: string;
  short: string;
  unit?: string;
  bytes: number;
  min: number;
  max: number;
  category: PidCategory;
  decode: (d: number[]) => number;
  /** Human-readable formula, shown in the PID picker. */
  formula?: string;
  /** Display with this many decimals. */
  digits?: number;
}

const A = (d: number[]) => d[0] ?? 0;
const B = (d: number[]) => d[1] ?? 0;
const C = (d: number[]) => d[2] ?? 0;
const D = (d: number[]) => d[3] ?? 0;
const u16 = (d: number[]) => (A(d) << 8) | B(d);

export const PIDS: PidDef[] = [
  {
    pid: 0x01,
    name: 'Monitor status since codes cleared',
    short: 'Monitors',
    bytes: 4,
    min: 0,
    max: 0,
    category: 'emissions',
    decode: () => 0,
    formula: 'bit field',
  },
  {
    pid: 0x03,
    name: 'Fuel system status',
    short: 'Fuel sys',
    bytes: 2,
    min: 0,
    max: 16,
    category: 'fuel',
    decode: (d) => A(d),
  },
  {
    pid: 0x04,
    name: 'Calculated engine load',
    short: 'Load',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'engine',
    decode: (d) => (A(d) * 100) / 255,
    formula: 'A * 100 / 255',
  },
  {
    pid: 0x05,
    name: 'Engine coolant temperature',
    short: 'Coolant',
    unit: '°C',
    bytes: 1,
    min: -40,
    max: 130,
    category: 'engine',
    decode: (d) => A(d) - 40,
    formula: 'A - 40',
  },
  {
    pid: 0x06,
    name: 'Short term fuel trim — bank 1',
    short: 'STFT B1',
    unit: '%',
    bytes: 1,
    min: -25,
    max: 25,
    category: 'fuel',
    decode: (d) => (A(d) - 128) * (100 / 128),
    formula: '(A - 128) * 100 / 128',
  },
  {
    pid: 0x07,
    name: 'Long term fuel trim — bank 1',
    short: 'LTFT B1',
    unit: '%',
    bytes: 1,
    min: -25,
    max: 25,
    category: 'fuel',
    decode: (d) => (A(d) - 128) * (100 / 128),
    formula: '(A - 128) * 100 / 128',
  },
  {
    pid: 0x08,
    name: 'Short term fuel trim — bank 2',
    short: 'STFT B2',
    unit: '%',
    bytes: 1,
    min: -25,
    max: 25,
    category: 'fuel',
    decode: (d) => (A(d) - 128) * (100 / 128),
  },
  {
    pid: 0x09,
    name: 'Long term fuel trim — bank 2',
    short: 'LTFT B2',
    unit: '%',
    bytes: 1,
    min: -25,
    max: 25,
    category: 'fuel',
    decode: (d) => (A(d) - 128) * (100 / 128),
  },
  {
    pid: 0x0a,
    name: 'Fuel pressure (gauge)',
    short: 'Fuel press',
    unit: 'kPa',
    bytes: 1,
    min: 0,
    max: 765,
    category: 'fuel',
    decode: (d) => A(d) * 3,
    formula: 'A * 3',
  },
  {
    pid: 0x0b,
    name: 'Intake manifold absolute pressure',
    short: 'MAP',
    unit: 'kPa',
    bytes: 1,
    min: 0,
    max: 255,
    category: 'engine',
    decode: (d) => A(d),
    formula: 'A',
  },
  {
    pid: 0x0c,
    name: 'Engine speed',
    short: 'RPM',
    unit: 'rpm',
    bytes: 2,
    min: 0,
    max: 8000,
    category: 'engine',
    decode: (d) => u16(d) / 4,
    formula: '(A*256 + B) / 4',
  },
  {
    pid: 0x0d,
    name: 'Vehicle speed',
    short: 'Speed',
    unit: 'km/h',
    bytes: 1,
    min: 0,
    max: 255,
    category: 'drivetrain',
    decode: (d) => A(d),
    formula: 'A',
  },
  {
    pid: 0x0e,
    name: 'Timing advance',
    short: 'Timing',
    unit: '°',
    bytes: 1,
    min: -64,
    max: 64,
    category: 'engine',
    decode: (d) => A(d) / 2 - 64,
    formula: 'A / 2 - 64',
  },
  {
    pid: 0x0f,
    name: 'Intake air temperature',
    short: 'Intake air',
    unit: '°C',
    bytes: 1,
    min: -40,
    max: 100,
    category: 'engine',
    decode: (d) => A(d) - 40,
    formula: 'A - 40',
  },
  {
    pid: 0x10,
    name: 'Mass air flow rate',
    short: 'MAF',
    unit: 'g/s',
    bytes: 2,
    min: 0,
    max: 400,
    category: 'engine',
    decode: (d) => u16(d) / 100,
    formula: '(A*256 + B) / 100',
    digits: 2,
  },
  {
    pid: 0x11,
    name: 'Throttle position',
    short: 'Throttle',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'engine',
    decode: (d) => (A(d) * 100) / 255,
    formula: 'A * 100 / 255',
  },
  {
    pid: 0x13,
    name: 'Oxygen sensors present (banks 1–2)',
    short: 'O2 present',
    bytes: 1,
    min: 0,
    max: 255,
    category: 'emissions',
    decode: (d) => A(d),
  },
  {
    pid: 0x1c,
    name: 'OBD standard this vehicle conforms to',
    short: 'OBD std',
    bytes: 1,
    min: 1,
    max: 15,
    category: 'emissions',
    decode: (d) => A(d),
  },
  {
    pid: 0x1f,
    name: 'Run time since engine start',
    short: 'Run time',
    unit: 's',
    bytes: 2,
    min: 0,
    max: 65535,
    category: 'engine',
    decode: (d) => u16(d),
  },
  {
    pid: 0x21,
    name: 'Distance travelled with MIL on',
    short: 'MIL dist',
    unit: 'km',
    bytes: 2,
    min: 0,
    max: 65535,
    category: 'emissions',
    decode: (d) => u16(d),
  },
  {
    pid: 0x23,
    name: 'Fuel rail pressure (gauge)',
    short: 'Rail press',
    unit: 'kPa',
    bytes: 2,
    min: 0,
    max: 65535,
    category: 'fuel',
    decode: (d) => u16(d) * 10,
  },
  {
    pid: 0x2c,
    name: 'Commanded EGR',
    short: 'EGR cmd',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'emissions',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x2d,
    name: 'EGR error',
    short: 'EGR err',
    unit: '%',
    bytes: 1,
    min: -100,
    max: 100,
    category: 'emissions',
    decode: (d) => (A(d) - 128) * (100 / 128),
  },
  {
    pid: 0x2e,
    name: 'Commanded evaporative purge',
    short: 'Purge',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'emissions',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x2f,
    name: 'Fuel tank level input',
    short: 'Fuel level',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'fuel',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x30,
    name: 'Warm-ups since codes cleared',
    short: 'Warm-ups',
    bytes: 1,
    min: 0,
    max: 255,
    category: 'emissions',
    decode: (d) => A(d),
  },
  {
    pid: 0x31,
    name: 'Distance travelled since codes cleared',
    short: 'Dist cleared',
    unit: 'km',
    bytes: 2,
    min: 0,
    max: 65535,
    category: 'emissions',
    decode: (d) => u16(d),
  },
  {
    pid: 0x32,
    name: 'Evap system vapour pressure',
    short: 'Evap press',
    unit: 'Pa',
    bytes: 2,
    min: -8192,
    max: 8191,
    category: 'emissions',
    decode: (d) => (u16(d) / 4) * 1 - 8192,
    formula: '((A*256+B)/4) - 8192',
    digits: 1,
  },
  {
    pid: 0x33,
    name: 'Absolute barometric pressure',
    short: 'Baro',
    unit: 'kPa',
    bytes: 1,
    min: 0,
    max: 255,
    category: 'emissions',
    decode: (d) => A(d),
  },
  {
    pid: 0x3c,
    name: 'Catalyst temperature — bank 1 sensor 1',
    short: 'Cat temp B1S1',
    unit: '°C',
    bytes: 2,
    min: -40,
    max: 1000,
    category: 'emissions',
    decode: (d) => u16(d) / 10 - 40,
  },
  {
    pid: 0x3d,
    name: 'Catalyst temperature — bank 2 sensor 1',
    short: 'Cat temp B2S1',
    unit: '°C',
    bytes: 2,
    min: -40,
    max: 1000,
    category: 'emissions',
    decode: (d) => u16(d) / 10 - 40,
  },
  {
    pid: 0x3e,
    name: 'Catalyst temperature — bank 1 sensor 2',
    short: 'Cat temp B1S2',
    unit: '°C',
    bytes: 2,
    min: -40,
    max: 1000,
    category: 'emissions',
    decode: (d) => u16(d) / 10 - 40,
  },
  {
    pid: 0x41,
    name: 'Monitor status this drive cycle',
    short: 'Monitors now',
    bytes: 4,
    min: 0,
    max: 0,
    category: 'emissions',
    decode: () => 0,
    formula: 'bit field',
  },
  {
    pid: 0x42,
    name: 'Control module voltage',
    short: 'Battery',
    unit: 'V',
    bytes: 2,
    min: 0,
    max: 20,
    category: 'electrical',
    decode: (d) => u16(d) / 1000,
    formula: '(A*256 + B) / 1000',
    digits: 2,
  },
  {
    pid: 0x43,
    name: 'Absolute load value',
    short: 'Abs load',
    unit: '%',
    bytes: 2,
    min: 0,
    max: 25700,
    category: 'engine',
    decode: (d) => (u16(d) * 100) / 255,
  },
  {
    pid: 0x44,
    name: 'Commanded air–fuel equivalence ratio',
    short: 'Lambda',
    bytes: 2,
    min: 0,
    max: 2,
    category: 'fuel',
    decode: (d) => (u16(d) * 2) / 65536,
    formula: '(A*256 + B) * 2 / 65536',
    digits: 3,
  },
  {
    pid: 0x45,
    name: 'Relative throttle position',
    short: 'Rel throttle',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'engine',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x46,
    name: 'Ambient air temperature',
    short: 'Ambient',
    unit: '°C',
    bytes: 1,
    min: -40,
    max: 100,
    category: 'engine',
    decode: (d) => A(d) - 40,
  },
  {
    pid: 0x47,
    name: 'Absolute throttle position B',
    short: 'Throttle B',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'engine',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x49,
    name: 'Accelerator pedal position D',
    short: 'Pedal D',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'engine',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x4a,
    name: 'Accelerator pedal position E',
    short: 'Pedal E',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'engine',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x4c,
    name: 'Commanded throttle actuator',
    short: 'Throttle act',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    category: 'engine',
    decode: (d) => (A(d) * 100) / 255,
  },
  {
    pid: 0x51,
    name: 'Fuel type',
    short: 'Fuel type',
    bytes: 1,
    min: 0,
    max: 23,
    category: 'fuel',
    decode: (d) => A(d),
  },
  {
    pid: 0x5c,
    name: 'Engine oil temperature',
    short: 'Oil temp',
    unit: '°C',
    bytes: 1,
    min: -40,
    max: 210,
    category: 'engine',
    decode: (d) => A(d) - 40,
  },
  {
    pid: 0x5e,
    name: 'Engine fuel rate',
    short: 'Fuel rate',
    unit: 'L/h',
    bytes: 2,
    min: 0,
    max: 3200,
    category: 'fuel',
    decode: (d) => u16(d) / 20,
    digits: 2,
  },
  {
    pid: 0x62,
    name: 'Actual engine torque',
    short: 'Torque',
    unit: '%',
    bytes: 1,
    min: -125,
    max: 125,
    category: 'engine',
    decode: (d) => A(d) - 125,
  },
];

/** O2 sensor PIDs 0x14–0x1B: voltage + short-term trim, one per sensor. */
for (let i = 0; i < 8; i++) {
  PIDS.push({
    pid: 0x14 + i,
    name: `O2 sensor ${i + 1} — voltage & trim`,
    short: `O2 S${i + 1}`,
    unit: 'V',
    bytes: 2,
    min: 0,
    max: 1.275,
    category: 'emissions',
    decode: (d) => A(d) / 200,
    formula: 'A / 200',
    digits: 3,
  });
}

export const PID_BY_ID = new Map(PIDS.map((p) => [p.pid, p]));

/** PIDs that make a good default live-data dashboard. */
export const DEFAULT_LIVE_PIDS = [0x0c, 0x0d, 0x05, 0x04, 0x11, 0x0f, 0x0b, 0x10, 0x2f, 0x06, 0x07, 0x42];

export const CATEGORY_LABELS: Record<PidCategory, string> = {
  engine: 'Engine',
  fuel: 'Fuel & air',
  emissions: 'Emissions',
  electrical: 'Electrical',
  drivetrain: 'Drivetrain',
  body: 'Body',
};

export function decodePid(def: PidDef, data: number[]): number {
  return def.decode(data);
}

export function formatPidValue(def: PidDef, value: number, imperial: boolean): string {
  if (!Number.isFinite(value)) return '—';
  let v = value;
  let suffix = def.unit ?? '';
  if (imperial) {
    if (def.unit === 'km/h') {
      v = value * 0.621371;
      suffix = 'mph';
    } else if (def.unit === '°C') {
      v = (value * 9) / 5 + 32;
      suffix = '°F';
    } else if (def.unit === 'kPa') {
      v = value * 0.145038;
      suffix = 'psi';
    }
  }
  const digits = def.digits ?? (Math.abs(v) >= 100 ? 0 : 1);
  return `${v.toFixed(digits)}${suffix ? ` ${suffix}` : ''}`;
}

export function convertValue(def: PidDef, value: number, imperial: boolean): number {
  if (!imperial) return value;
  if (def.unit === 'km/h') return value * 0.621371;
  if (def.unit === '°C') return (value * 9) / 5 + 32;
  if (def.unit === 'kPa') return value * 0.145038;
  return value;
}

export function displayUnit(def: PidDef, imperial: boolean): string {
  if (!imperial) return def.unit ?? '';
  if (def.unit === 'km/h') return 'mph';
  if (def.unit === '°C') return '°F';
  if (def.unit === 'kPa') return 'psi';
  return def.unit ?? '';
}
