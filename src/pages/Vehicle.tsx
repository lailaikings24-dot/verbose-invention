import { useState } from 'react';
import { useApp } from '../state/store';
import { decodeVin, type VinInfo } from '../lib/obd/vin';
import { PID_BY_ID } from '../lib/obd/pids';
import { MONITOR_HELP } from '../lib/obd/dtc';
import { Icon } from '../components/Icon';

export function Vehicle() {
  const { vin, protocol, adapterId, voltage, supported, monitors, ecus, versions, conn } = useApp();
  const [manual, setManual] = useState('');
  const [manualVin, setManualVin] = useState<VinInfo | null>(null);

  const shown = vin ?? manualVin;
  const pids = supported.map((p) => ({ pid: p, def: PID_BY_ID.get(p) })).filter((p) => p.def);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Vehicle</h1>
          <p className="page-desc">
            Identity, capabilities and calibration data read from the modules over the diagnostic link.
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 12 }}>Identification</div>
          {shown ? (
            <dl className="kv">
              <dt>VIN</dt>
              <dd>{shown.vin}</dd>
              <dt>Make</dt>
              <dd>{shown.make}</dd>
              <dt>Group</dt>
              <dd>{shown.makeGroup}</dd>
              <dt>Model year</dt>
              <dd>{shown.year ?? '—'}{shown.yearNote ? ` (${shown.yearNote})` : ''}</dd>
              <dt>Region</dt>
              <dd>{shown.region}</dd>
              <dt>Built in</dt>
              <dd>{shown.country}</dd>
              <dt>Plant code</dt>
              <dd>{shown.plant ?? '—'}</dd>
              <dt>Serial</dt>
              <dd>{shown.serial ?? '—'}</dd>
              {shown.checkDigitOk !== undefined && (
                <>
                  <dt>Check digit</dt>
                  <dd style={{ color: shown.checkDigitOk ? 'var(--ok)' : 'var(--warn)' }}>
                    {shown.checkDigitOk ? 'Valid' : 'Does not match — VIN may be mistyped'}
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <div className="empty">The ECU did not report a VIN.</div>
          )}

          <div className="divider" style={{ margin: '14px 0' }} />
          <div className="field">
            <label htmlFor="vin">Decode a VIN manually</label>
            <div className="row">
              <input
                id="vin"
                className="input mono"
                placeholder="17 characters"
                maxLength={17}
                value={manual}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  setManual(v);
                  setManualVin(v.length === 17 ? decodeVin(v) : null);
                }}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <span className="tiny muted">
              Works offline: region, manufacturer, model year and North American check digit.
            </span>
          </div>
        </div>

        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 12 }}>Link</div>
          <dl className="kv">
            <dt>Adapter</dt>
            <dd>{adapterId || '—'}</dd>
            <dt>Link type</dt>
            <dd>
              {conn.kind === 'ble'
                ? 'Bluetooth LE (browser)'
                : conn.kind === 'native'
                  ? 'Bluetooth (native app)'
                  : conn.kind === 'ws'
                    ? 'Wi-Fi / bridge'
                    : conn.kind === 'demo'
                      ? 'Demo simulator'
                      : '—'}
            </dd>
            <dt>Protocol</dt>
            <dd>{protocol || '—'}</dd>
            <dt>Battery</dt>
            <dd>{voltage ? `${voltage.toFixed(1)} V` : '—'}</dd>
            <dt>Modules</dt>
            <dd>{ecus.length || '—'}</dd>
            <dt>Calibration ID</dt>
            <dd>{versions.calId ?? 'not reported'}</dd>
            <dt>CVN</dt>
            <dd>{versions.cvn ?? 'not reported'}</dd>
            <dt>ECU name</dt>
            <dd>{versions.ecuName ?? 'not reported'}</dd>
          </dl>
          {voltage > 0 && (
            <div className={`notice ${voltage < 12.2 ? 'notice-warn' : 'notice-ok'}`} style={{ marginTop: 12 }}>
              <Icon name="info" size={15} />
              <div>
                {voltage < 11.8
                  ? 'Battery voltage is low. Charge or replace the battery before diagnosing — low voltage causes phantom codes.'
                  : voltage < 12.2
                    ? 'Battery is resting low. Expect 12.4–12.8 V with the engine off and 13.5–14.8 V running.'
                    : 'Charging voltage looks healthy.'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Modules answering on the bus</div>
          <span className="tiny muted">{ecus.length} found</span>
        </div>
        {ecus.length === 0 ? (
          <div className="empty">No module headers captured yet — run a scan.</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Header</th><th>Module</th></tr>
            </thead>
            <tbody>
              {ecus.map((ecu) => (
                <tr key={ecu.header}>
                  <td className="mono">{ecu.header}</td>
                  <td>{ecu.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Readiness monitors</div>
            <span className="tiny muted">{monitors?.ignition === 'compression' ? 'Diesel' : 'Petrol'}</span>
          </div>
          <div className="card-pad col" style={{ gap: 0 }}>
            {(monitors?.sinceClear ?? []).map((m) => {
              const help = MONITOR_HELP[m.name];
              return (
                <div key={m.name} style={{ padding: '9px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <div className="row">
                    <span className="small">{m.name}</span>
                    <div className="spacer" />
                    <span className={`pill ${!m.available ? 'pill-muted' : m.complete === true ? 'pill-ok' : m.complete === false ? 'pill-warn' : 'pill-info'}`}>
                      {!m.available ? 'Not supported' : m.complete === true ? 'Ready' : m.complete === false ? 'Not ready' : 'Supported'}
                    </span>
                  </div>
                  {m.available && help && <div className="tiny muted" style={{ marginTop: 3 }}>{help.description}</div>}
                </div>
              );
            })}
            {!monitors && <div className="empty">This ECU did not return monitor status (PID 01).</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Supported sensors</div>
            <span className="tiny muted">{pids.length} of {supported.length || 0}</span>
          </div>
          <div className="card-pad">
            {pids.length === 0 ? (
              <div className="empty">No supported-PID bitmap yet.</div>
            ) : (
              <div className="chip-list">
                {pids.map(({ pid, def }) => (
                  <span key={pid} className="chip" title={def!.name}>
                    <span className="mono">01 {pid.toString(16).toUpperCase().padStart(2, '0')}</span> · {def!.short}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="notice notice-info">
        <Icon name="info" size={17} />
        <div>
          Generic OBD-II exposes powertrain emissions data. Transmission, ABS, airbag and body modules answer on
          manufacturer protocols — use Tools → Custom PIDs with the right header to reach them, or a dealer-level tool
          for anything proprietary.
        </div>
      </div>
    </div>
  );
}
