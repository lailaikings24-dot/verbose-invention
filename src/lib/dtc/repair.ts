/**
 * Turns a bare code into an actionable repair briefing, including codes that
 * are not individually catalogued.
 */
import { decodeDtc } from '../obd/dtc';
import { DTC_DB, SEVERITY_RANK, type Driveable, type DtcInfo, type Severity } from './database';

const SYSTEM_BY_RANGE: Record<string, string> = {
  C0: 'Chassis / ABS',
  C1: 'Chassis',
  B0: 'Body / safety',
  B1: 'Body',
  U0: 'Network communication',
  U1: 'Network communication',
  U2: 'Network communication',
  U3: 'Network communication',
};

/** Generic powertrain families — the second digit still tells you the system. */
function powertrainSystem(code: string): string {
  const n = Number.parseInt(code.slice(2), 16);
  if (n >= 0x100) return 'Fuel & air metering';
  if (n < 0x100) return 'Fuel & air metering';
  return 'Powertrain';
}

function powertrainSystemFor(code: string): string {
  const n = Number.parseInt(code.slice(2), 16);
  if (n >= 0x300 && n <= 0x3ff) return 'Ignition & misfire';
  if (n >= 0x400 && n <= 0x4ff) return 'Emissions control';
  if (n >= 0x500 && n <= 0x5ff) return 'Idle & speed control';
  if (n >= 0x600 && n <= 0x6ff) return 'Control modules';
  if (n >= 0x700 && n <= 0x7ff) return 'Transmission';
  if (n >= 0x800 && n <= 0x8ff) return 'Transmission / drivetrain';
  if (n >= 0x900 && n <= 0x9ff) return 'Control modules';
  if (n >= 0xa00 && n <= 0xaff) return 'Hybrid / EV';
  return powertrainSystem(code);
}

const GENERIC_STEPS = [
  'Confirm the fault is current: clear codes, drive a full cycle and see whether it returns before replacing parts.',
  'Record freeze-frame data for the code — rpm, load, coolant temperature and speed at the moment it set.',
  'Inspect the connectors and harness for the circuit named in the code description for corrosion, chafing or water ingress.',
  'Check battery voltage and grounds; low voltage causes codes that look like sensor failures.',
  'Compare live sensor values with expected ranges while reproducing the fault.',
  'Repair or replace the confirmed faulty component, clear the code, and verify the monitor runs to completion.',
];

export function lookupDtc(code: string): DtcInfo {
  const upper = code.trim().toUpperCase();
  const known = DTC_DB.get(upper);
  if (known) return known;

  const decoded = decodeDtc(upper);
  if (!decoded) {
    return {
      code: upper,
      title: 'Unrecognised code format',
      system: 'Unknown',
      severity: 'medium',
      driveable: 'caution',
      summary: 'This does not match the standard P/C/B/U trouble-code layout. It may be a manufacturer-specific or truncated code.',
      causes: ['Manufacturer-specific code outside the generic standard'],
      symptoms: ['Check engine light on'],
      steps: GENERIC_STEPS,
      parts: [],
      cost: 'Varies',
      difficulty: 3,
      watch: [0x06, 0x07],
      related: [],
      generic: false,
    };
  }

  let system: string;
  if (decoded.letter === 'P') system = powertrainSystemFor(upper);
  else system = SYSTEM_BY_RANGE[decoded.letter + upper[1]] ?? 'Unknown';

  const severity: Severity = decoded.letter === 'U' ? 'high' : decoded.letter === 'P' ? 'medium' : 'medium';
  const driveable: Driveable = decoded.letter === 'C' ? 'caution' : decoded.letter === 'U' ? 'caution' : 'yes';

  return {
    code: upper,
    title: decoded.manufacturerSpecific
      ? 'Manufacturer-specific code'
      : `${system} code ${upper}`,
    system,
    severity,
    driveable,
    summary: decoded.manufacturerSpecific
      ? `${upper} sits in a manufacturer-specific range, so the exact meaning comes from that brand's service data. The diagnostic approach below is still valid: verify the circuit, then the component.`
      : `${upper} is a generic ${system.toLowerCase()} code. This app does not hold the full definition, but the structured approach below works for almost every circuit fault.`,
    causes: [
      'A sensor or actuator in this circuit has failed',
      'Damaged wiring, connector or ground for this circuit',
      'A mechanical problem the sensor is correctly reporting',
      'Low battery voltage or a charging fault',
    ],
    symptoms: ['Check engine light on', 'Possible driveability change depending on the circuit'],
    steps: GENERIC_STEPS,
    parts: [],
    cost: 'Varies by circuit',
    difficulty: 3,
    watch: [0x06, 0x07],
    related: [],
    generic: false,
  };
}

export function severityRank(code: string): number {
  return SEVERITY_RANK[lookupDtc(code).severity];
}

/** Highest-severity code in a list, used for the dashboard verdict. */
export function worstCode(codes: string[]): string | null {
  if (!codes.length) return null;
  return [...codes].sort((a, b) => severityRank(b) - severityRank(a))[0];
}

/**
 * Safety verdict for driving with the current codes.
 * Deliberately conservative: flashing MIL / no-start faults win.
 */
export function driveVerdict(codes: string[]): {
  level: 'ok' | 'careful' | 'stop';
  headline: string;
  detail: string;
} {
  if (!codes.length) {
    return { level: 'ok', headline: 'Clear to drive', detail: 'No stored trouble codes were reported by the modules we can reach.' };
  }
  const infos = codes.map(lookupDtc);
  const blockers = infos.filter((i) => i.driveable === 'no');
  if (blockers.length) {
    return {
      level: 'stop',
      headline: 'Do not drive',
      detail: `${blockers.map((b) => b.code).join(', ')} can cause engine damage or leave you stranded. Have the vehicle recovered or repaired on site.`,
    };
  }
  const caution = infos.filter((i) => i.driveable === 'caution' || i.severity === 'critical');
  if (caution.length) {
    return {
      level: 'careful',
      headline: 'Drive with care',
      detail: `${caution.map((c) => c.code).join(', ')} — avoid hard acceleration and long trips until diagnosed. A flashing check engine light means stop.`,
    };
  }
  return {
    level: 'ok',
    headline: 'OK for normal driving',
    detail: 'No code in this list requires the vehicle to be taken off the road, but arrange diagnosis soon.',
  };
}
