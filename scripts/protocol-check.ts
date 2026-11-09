/**
 * Headless end-to-end check of the OBD stack:
 * DemoTransport -> Elm327 (framing, ISO-TP) -> service (scan, codes, VIN).
 *
 * Run with: npm run check:protocol
 */
import './shim';
import { service } from '../src/lib/service';
import { useApp } from '../src/state/store';
import { Elm327 } from '../src/lib/elm327';
import type { Transport } from '../src/lib/transport';

/** Feeds canned adapter output, one chunk per command written. */
class ScriptedTransport implements Transport {
  readonly kind = 'demo' as const;
  readonly label = 'scripted';
  readonly detail = '';
  private emit: ((chunk: string) => void) | null = null;
  private replies: string[] = [];

  script(...chunks: string[]) {
    this.replies = chunks;
  }

  async connect(onData: (chunk: string) => void) {
    this.emit = onData;
  }

  async write() {
    const chunk = this.replies.shift();
    if (chunk !== undefined) this.emit?.(chunk);
  }

  async disconnect() {
    this.emit = null;
  }
}

let failures = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('TorqueMedic protocol self-check\n');

  await service.connectDemo();
  const s = useApp.getState();

  check('link established', s.conn.status === 'connected', s.conn.message);
  check('adapter identified', s.adapterId.includes('ELM327'), s.adapterId);
  check('CAN protocol negotiated', /15765-4/.test(s.protocol), s.protocol);
  check('battery voltage read', s.voltage > 13 && s.voltage < 15, String(s.voltage));

  check('VIN decoded', s.vin?.vin === '1HGBH41JXMN109186', s.vin?.vin ?? 'none');
  check('VIN make resolved', s.vin?.make === 'Honda', s.vin?.make ?? 'none');
  check('VIN year plausible', (s.vin?.year ?? 0) >= 2020, String(s.vin?.year));
  check('VIN check digit valid', s.vin?.checkDigitOk === true, String(s.vin?.checkDigitOk));

  const pidList = s.supported;
  check('supported PIDs enumerated', pidList.length > 15, `${pidList.length} PIDs`);
  check('PID 0x0C advertised', pidList.includes(0x0c));

  check('monitor status parsed', !!s.monitors);
  check('MIL reported on', s.monitors?.mil === true);
  check('DTC count matches', s.monitors?.dtcCount === 2, String(s.monitors?.dtcCount));
  check('availability bits parsed', (s.monitors?.sinceClear.filter((m) => m.available).length ?? 0) >= 5);

  const stored = s.dtcs.map((d) => d.code).sort();
  check('stored codes read', JSON.stringify(stored) === JSON.stringify(['P0171', 'P0301']), JSON.stringify(stored));
  check('pending codes read', s.pending.map((d) => d.code).join() === 'P0301', s.pending.map((d) => d.code).join());
  check('permanent codes read', s.permanent.map((d) => d.code).join() === 'P0420', s.permanent.map((d) => d.code).join());
  check('code attributed to a module', s.dtcs.every((d) => d.ecu.includes('Engine')), s.dtcs[0]?.ecu ?? '');

  check('freeze frame captured', s.freeze.length >= 4, `${s.freeze.length} rows`);
  check('freeze frame DTC linked', s.freezeCode === 'P0301', s.freezeCode ?? 'none');
  check('mode 06 results parsed', s.tests.length >= 2, `${s.tests.length} rows`);
  check('calibration ID read', !!s.versions.calId, s.versions.calId ?? 'none');

  const live = await service.readPids([0x0c, 0x0d, 0x05, 0x04, 0x42]);
  const rpm = live.get(0x0c)?.value ?? 0;
  const speed = live.get(0x0d)?.value ?? 0;
  const coolant = live.get(0x05)?.value ?? 0;
  const volts = live.get(0x42)?.value ?? 0;
  check('multi-PID request decoded (rpm)', rpm > 1500 && rpm < 2500, rpm.toFixed(1));
  check('multi-PID request decoded (speed)', speed > 50 && speed < 80, speed.toFixed(1));
  check('temperature decoding', coolant > 60 && coolant < 100, coolant.toFixed(1));
  check('voltage decoding', volts > 13 && volts < 15, volts.toFixed(2));

  // Framing: a single BLE notification can carry more than one complete answer.
  // Every prompt in the buffer must be consumed, or a stale reply ends up
  // answering a later command.
  const framing = new ScriptedTransport();
  const framed = new Elm327();
  await framed.open(framing);
  framing.script('OK\r\r>AT-SP0\r\r>');
  const firstAnswer = await framed.send('ATZ');
  check('packed response answered once', firstAnswer.trim() === 'OK', firstAnswer.trim());
  framing.script('ELM327 v1.5\r\r>');
  const secondAnswer = await framed.send('ATI');
  check('stale reply does not answer the next command', secondAnswer.trim() === 'ELM327 v1.5', secondAnswer.trim());
  check('command latency measured', framed.latency < 2000, `${framed.latency} ms`);
  await framed.close();

  const beforeClear = useApp.getState().dtcs.length;
  const cleared = await service.clearCodes();
  const after = useApp.getState();
  check('clear acknowledged', cleared.ok, cleared.message);
  check('stored codes gone after clear', after.dtcs.length === 0, `was ${beforeClear}`);
  check('permanent code survives clear', after.permanent.some((d) => d.code === 'P0420'), after.permanent.map((d) => d.code).join());
  check('clear message mentions permanent code', /permanent/i.test(cleared.message), cleared.message);

  await service.disconnect();
  check('clean disconnect', useApp.getState().conn.status === 'idle');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Self-check crashed:', err);
  process.exit(1);
});
