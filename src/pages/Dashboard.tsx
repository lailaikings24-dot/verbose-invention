import { useEffect, useMemo } from 'react';
import { useApp } from '../state/store';
import { service } from '../lib/service';
import { PID_BY_ID, convertValue, displayUnit, formatPidValue } from '../lib/obd/pids';
import { lookupDtc, driveVerdict } from '../lib/dtc/repair';
import { Gauge } from '../components/Gauge';
import { Icon } from '../components/Icon';
import { fmt } from '../lib/format';

export function Dashboard() {
  const { vin, protocol, voltage, dtcs, pending, permanent, monitors, live, livePids, imperial, scanning, scanLabel, scanProgress, lastScanAt, conn, adapterId } =
    useApp();
  const setScreen = useApp((s) => s.setScreen);

  const allCodes = useMemo(() => [...dtcs, ...pending, ...permanent], [dtcs, pending, permanent]);
  const verdict = useMemo(() => driveVerdict(dtcs.map((d) => d.code)), [dtcs]);

  useEffect(() => {
    if (conn.status === 'connected' && !useApp.getState().liveActive) service.startLive();
  }, [conn.status]);

  const quick = [0x0c, 0x0d, 0x05, 0x42];
  const readyMonitors = monitors?.sinceClear.filter((m) => m.available) ?? [];
  const doneMonitors = readyMonitors.filter((m) => m.complete === true).length;

  const codeCounts = [
    { label: 'Stored', value: dtcs.length, tone: dtcs.length ? 'danger' : 'ok' },
    { label: 'Pending', value: pending.length, tone: pending.length ? 'warn' : 'ok' },
    { label: 'Permanent', value: permanent.length, tone: permanent.length ? 'warn' : 'ok' },
  ] as const;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">{vin?.make && vin.make !== 'Unknown' ? `${vin.make}${vin.year ? ` ${vin.year}` : ''}` : 'Vehicle dashboard'}</h1>
          <p className="page-desc">
            {vin?.vin ? <span className="mono">{vin.vin}</span> : 'VIN not reported by this ECU'} · {protocol || 'protocol pending'}
            {lastScanAt ? ` · scanned ${new Date(lastScanAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => void service.fullScan()} disabled={scanning}>
          <Icon name={scanning ? 'refresh' : 'search'} size={16} className={scanning ? 'spin' : undefined} />
          {scanning ? 'Scanning…' : 'Run full scan'}
        </button>
      </div>

      {scanning && (
        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 8 }}>
            <strong className="small">{scanLabel}</strong>
            <div className="spacer" />
            <span className="tiny muted mono">{scanProgress}%</span>
          </div>
          <div className="progress">
            <div style={{ width: `${scanProgress}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 14 }}>
        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 12 }}>
            <span
              className={`pill ${verdict.level === 'stop' ? 'pill-danger' : verdict.level === 'careful' ? 'pill-warn' : 'pill-ok'}`}
            >
              <span className="dot" /> {verdict.headline}
            </span>
            <div className="spacer" />
            <span className={`pill ${monitors?.mil ? 'pill-danger' : 'pill-muted'}`}>MIL {monitors?.mil ? 'ON' : 'OFF'}</span>
          </div>
          <p className="small muted" style={{ marginBottom: 14 }}>{verdict.detail}</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {codeCounts.map((c) => (
              <div key={c.label}>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value" style={{ color: c.value ? (c.tone === 'danger' ? 'var(--danger)' : 'var(--warn)') : 'var(--ok)' }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>
          <div className="divider" style={{ margin: '14px 0 10px' }} />
          <div className="row row-wrap">
            <button className="btn btn-sm" onClick={() => setScreen('codes')}>
              <Icon name="codes" size={14} /> View codes
            </button>
            <button className="btn btn-sm" onClick={() => setScreen('repair')}>
              <Icon name="wrench" size={14} /> Repair guide
            </button>
          </div>
        </div>

        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="card-title">Live snapshot</div>
            <div className="spacer" />
            <span className="pill pill-muted mono">{adapterId || 'adapter'}</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {quick.map((pid) => {
              const def = PID_BY_ID.get(pid);
              const series = live[pid];
              const raw = series?.values[series.values.length - 1];
              if (!def) return null;
              const shown = raw !== undefined ? convertValue(def, raw, imperial) : Number.NaN;
              return (
                <div key={pid}>
                  <div className="stat-label">{def.short}</div>
                  <div className="stat-value" style={{ fontSize: 21 }}>
                    {Number.isFinite(shown) ? shown.toFixed(def.digits ?? (Math.abs(shown) >= 100 ? 0 : 1)) : '—'}
                    <span className="tiny muted" style={{ marginLeft: 4, fontWeight: 500 }}>
                      {displayUnit(def, imperial)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="divider" style={{ margin: '14px 0 10px' }} />
          <div className="row">
            <span className="tiny muted">
              Battery {voltage ? `${fmt(voltage, 1)} V` : '—'} · {readyMonitors.length ? `${doneMonitors}/${readyMonitors.length} monitors reported ready` : 'monitor data unavailable'}
            </span>
            <div className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => setScreen('live')}>
              Live data <Icon name="chevron" size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-auto">
        {quick.map((pid) => {
          const def = PID_BY_ID.get(pid);
          if (!def) return null;
          const raw = live[pid]?.values.at(-1) ?? 0;
          const shown = convertValue(def, raw, imperial);
          return (
            <Gauge
              key={pid}
              label={def.name}
              value={shown}
              unit={displayUnit(def, imperial)}
              min={convertValue(def, def.min, imperial)}
              max={convertValue(def, def.max, imperial)}
              digits={def.digits ?? (Math.abs(shown) >= 100 ? 0 : 1)}
            />
          );
        })}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Trouble codes</div>
          <button className="btn btn-sm btn-ghost" onClick={() => setScreen('codes')}>
            Manage <Icon name="chevron" size={13} />
          </button>
        </div>
        {allCodes.length === 0 ? (
          <div className="empty">
            <Icon name="check" size={22} className="muted" />
            <div style={{ marginTop: 6 }}>No trouble codes reported. {scanning ? '' : 'Run a scan to refresh.'}</div>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Module</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {allCodes.slice(0, 6).map((d) => {
                const info = lookupDtc(d.code);
                return (
                  <tr key={`${d.code}-${d.kind}-${d.header}`} style={{ cursor: 'pointer' }} onClick={() => { useApp.getState().selectCode(d.code); setScreen('codes'); }}>
                    <td className="mono strong">{d.code}</td>
                    <td style={{ maxWidth: 320 }}>{info.title}</td>
                    <td className="small muted">{d.ecu}</td>
                    <td>
                      <span className={`pill ${d.kind === 'stored' ? 'pill-danger' : d.kind === 'pending' ? 'pill-warn' : 'pill-muted'}`}>{d.kind}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="notice notice-info">
        <Icon name="info" size={17} />
        <div>
          Live data is sampled at about {useApp.getState().liveHz || '—'} Hz. {livePids.length} sensors selected — adjust
          them on the Live data screen. Readings update while the ignition is on; some PIDs only report with the engine
          running.
        </div>
      </div>
    </div>
  );
}import { Obd2Service } from './obd2Service.js';
import { Obd2Parser } from './obd2Parser.js';

// DOM Element Registry
const connectBtn = document.getElementById('connectBtn');
const scanDtcBtn = document.getElementById('scanDtcBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const rpmValue = document.getElementById('rpmValue');
const speedValue = document.getElementById('speedValue');
const dtcContainer = document.getElementById('dtcContainer');

let liveDataInterval = null;

// Handle Initial Adapter Search/Connection Routine
connectBtn.addEventListener('click', () => {
  statusText.innerText = "Scanning...";
  connectBtn.disabled = true;

  Obd2Service.scanForAdapter(async (device) => {
    statusText.innerText = `Connecting to ${device.name || 'Adapter'}...`;
    
    // Attempt link using device payload identifiers via core BLE plugins
    await Obd2Service.connectToAdapter(device.id, handleLiveStreamBytes);
    
    // UI Updates following execution
    statusDot.classList.add('connected');
    statusText.innerText = "Connected";
    connectBtn.innerText = "Disconnect";
    connectBtn.disabled = false;
    scanDtcBtn.disabled = false;
    
    // Begin continuous background updates (request telemetry data every 500ms)
    startLivePolling();
  });
});

// Periodic Request Loop (Alters commands sequentially to avoid bandwidth collision)
function startLivePolling() {
  let toggle = true;
  liveDataInterval = setInterval(() => {
    if (toggle) {
      Obd2Service.requestEngineRPM();
    } else {
      Obd2Service.requestVehicleSpeed();
    }
    toggle = !toggle;
  }, 500);
}

// Global Parser router binding raw streams back onto specific elements
function handleLiveStreamBytes(rawString) {
  if (rawString.includes("41 0C") || rawString.includes("410C")) {
    const rpm = Obd2Parser.parseRPM(rawString);
    if (rpm !== null) rpmValue.innerText = rpm;
  } 
  
  else if (rawString.includes("41 0D") || rawString.includes("410D")) {
    const speed = Obd2Parser.parseSpeed(rawString, false);
    if (speed !== null) speedValue.innerText = speed;
  } 
  
  else if (rawString.includes("43")) {
    const codes = Obd2Parser.parseTroubleCodes(rawString);
    renderTroubleCodes(codes);
  }
}

// Request Stored Vehicle ECU Error Arrays 
scanDtcBtn.addEventListener('click', () => {
  dtcContainer.innerHTML = '<div class="no-faults" style="color: var(--text-muted)">Querying codes...</div>';
  Obd2Service.requestTroubleCodes();
});

// UI Code Renderer for Active Engine Malfunctions
function renderTroubleCodes(codesArray) {
  dtcContainer.innerHTML = ''; // Clear fallback states

  if (codesArray.length === 0) {
    dtcContainer.innerHTML = '<div class="no-faults">🎉 System Clear! No Engine Error Codes detected.</div>';
    return;
  }

  codesArray.forEach(code => {
    const item = document.createElement('div');
    item.className = 'dtc-item';
    item.innerHTML = `
      <span class="dtc-code">${code}</span>
      <span style="color: var(--text-muted); font-size: 0.85rem;">Fault Code Detected</span>
    `;
    dtcContainer.appendChild(item);
  });
}

