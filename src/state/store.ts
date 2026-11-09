import { create } from 'zustand';
import type { VinInfo } from '../lib/obd/vin';
import type { MonitorItem, MonitorStatus } from '../lib/obd/dtc';
import type { LinkKind } from '../lib/transport';
import type { LogDir } from '../lib/elm327';
import { load, save } from '../lib/storage';
import { screenForPath } from '../lib/routes';

export type Screen = 'connect' | 'dashboard' | 'live' | 'codes' | 'repair' | 'vehicle' | 'tools';
export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type DtcKind = 'stored' | 'pending' | 'permanent';

export interface DtcRecord {
  code: string;
  kind: DtcKind;
  ecu: string;
  header: string;
}

export interface LogEntry {
  id: number;
  dir: LogDir;
  text: string;
  t: number;
}

export interface Series {
  values: number[];
  stamps: number[];
}

export interface FreezeRow {
  pid: number;
  name: string;
  short: string;
  value: number;
  unit?: string;
}

export interface Mode6Row {
  mid: number;
  tid: number;
  name: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  pass: boolean;
}

export interface CustomPid {
  id: string;
  name: string;
  header?: string;
  mode: number;
  pid: number;
  bytes: number;
  expr: string;
  unit?: string;
  min?: number;
  max?: number;
}

export interface RepairEntry {
  id: string;
  code: string;
  action: string;
  at: number;
  outcome: 'pending' | 'fixed' | 'returned';
  note?: string;
  vin?: string;
}

export interface ConnectionState {
  status: ConnStatus;
  kind: LinkKind | null;
  label: string;
  message: string;
}

/** Health of the live adapter link, shown on the Connection screen. */
export interface LinkStats {
  /** Last command round-trip, milliseconds. */
  rtt: number;
  /** Times the link dropped during this session. */
  drops: number;
  /** Times the link recovered without user input. */
  reconnects: number;
  /** When the current link came up. */
  connectedAt: number;
}

interface AppState {
  screen: Screen;
  setScreen: (s: Screen) => void;

  conn: ConnectionState;
  linkStats: LinkStats;
  protocol: string;
  adapterId: string;
  voltage: number;
  vin: VinInfo | null;

  supported: number[];
  monitors: MonitorStatus | null;
  cycleMonitors: MonitorItem[] | null;
  dtcs: DtcRecord[];
  pending: DtcRecord[];
  permanent: DtcRecord[];
  ecus: { header: string; label: string }[];
  freeze: FreezeRow[];
  freezeCode: string | null;
  tests: Mode6Row[];
  versions: { calId?: string; cvn?: string; ecuName?: string };

  scanning: boolean;
  scanLabel: string;
  scanProgress: number;
  lastScanAt: number | null;

  live: Record<number, Series>;
  livePids: number[];
  liveActive: boolean;
  liveHz: number;

  selectedCode: string | null;
  logs: LogEntry[];

  imperial: boolean;
  customPids: CustomPid[];
  repairs: RepairEntry[];
  clearedAt: number | null;

  setImperial: (v: boolean) => void;
  setLivePids: (pids: number[]) => void;
  addCustomPid: (pid: CustomPid) => void;
  removeCustomPid: (id: string) => void;
  selectCode: (code: string | null) => void;
  addRepair: (entry: RepairEntry) => void;
  updateRepair: (id: string, patch: Partial<RepairEntry>) => void;
  clearLogs: () => void;
  resetSession: () => void;
}

const DEFAULT_LIVE = [0x0c, 0x0d, 0x05, 0x04, 0x11, 0x0f, 0x0b, 0x10, 0x2f, 0x06, 0x07, 0x42];

const persistedLive = load<number[]>('livePids', DEFAULT_LIVE);
const persistedImperial = load<boolean>('imperial', false);
const persistedCustom = load<CustomPid[]>('customPids', []);
const persistedRepairs = load<RepairEntry[]>('repairs', []);

/** The URL decides which screen opens, so a deep link lands where it points. */
const initialScreen: Screen =
  (typeof window !== 'undefined' && window.location && screenForPath(window.location.pathname)) || 'connect';

export const useApp = create<AppState>()((set, get) => ({
  screen: initialScreen,
  setScreen: (screen) => set({ screen }),

  conn: { status: 'idle', kind: null, label: 'No adapter', message: '' },
  linkStats: { rtt: 0, drops: 0, reconnects: 0, connectedAt: 0 },
  protocol: '',
  adapterId: '',
  voltage: 0,
  vin: null,

  supported: [],
  monitors: null,
  cycleMonitors: null,
  dtcs: [],
  pending: [],
  permanent: [],
  ecus: [],
  freeze: [],
  freezeCode: null,
  tests: [],
  versions: {},

  scanning: false,
  scanLabel: '',
  scanProgress: 0,
  lastScanAt: null,

  live: {},
  livePids: persistedLive,
  liveActive: false,
  liveHz: 0,

  selectedCode: null,
  logs: [],

  imperial: persistedImperial,
  customPids: persistedCustom,
  repairs: persistedRepairs,
  clearedAt: null,

  setImperial: (imperial) => {
    save('imperial', imperial);
    set({ imperial });
  },
  setLivePids: (livePids) => {
    const capped = livePids.slice(0, 16);
    save('livePids', capped);
    set({ livePids: capped });
  },
  addCustomPid: (pid) => {
    const customPids = [...get().customPids, pid];
    save('customPids', customPids);
    set({ customPids });
  },
  removeCustomPid: (id) => {
    const customPids = get().customPids.filter((p) => p.id !== id);
    save('customPids', customPids);
    set({ customPids });
  },
  selectCode: (selectedCode) => set({ selectedCode }),
  addRepair: (entry) => {
    const repairs = [entry, ...get().repairs].slice(0, 200);
    save('repairs', repairs);
    set({ repairs });
  },
  updateRepair: (id, patch) => {
    const repairs = get().repairs.map((r) => (r.id === id ? { ...r, ...patch } : r));
    save('repairs', repairs);
    set({ repairs });
  },
  clearLogs: () => set({ logs: [] }),
  resetSession: () =>
    set({
      supported: [],
      monitors: null,
      cycleMonitors: null,
      dtcs: [],
      pending: [],
      permanent: [],
      ecus: [],
      freeze: [],
      freezeCode: null,
      tests: [],
      versions: {},
      live: {},
      vin: null,
      protocol: '',
      lastScanAt: null,
      clearedAt: null,
      selectedCode: null,
    }),
}));

/** Push a command-log line, keeping the last 400. */
export function pushLog(dir: LogDir, text: string) {
  const { logs } = useApp.getState();
  const next: LogEntry = { id: (logs[0]?.id ?? 0) + 1, dir, text, t: Date.now() };
  useApp.setState({ logs: [next, ...logs].slice(0, 400) });
}
