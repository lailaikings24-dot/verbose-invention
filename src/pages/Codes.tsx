import { useMemo, useState } from 'react';
import { useApp, type DtcKind } from '../state/store';
import { service } from '../lib/service';
import { lookupDtc } from '../lib/dtc/repair';
import { DIFFICULTY_LABEL, SEVERITY_LABEL, SEVERITY_RANK } from '../lib/dtc/database';
import { PID_BY_ID, convertValue, displayUnit } from '../lib/obd/pids';
import { CodeCard } from '../components/CodeCard';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { download } from '../lib/storage';
import { hex } from '../lib/format';

const TABS: { id: DtcKind; label: string }[] = [
  { id: 'stored', label: 'Stored' },
  { id: 'pending', label: 'Pending' },
  { id: 'permanent', label: 'Permanent' },
];

export function Codes() {
  const { dtcs, pending, permanent, selectedCode, monitors, freeze, freezeCode, tests, vin, scanning, live, imperial, versions } = useApp();
  const selectCode = useApp((s) => s.selectCode);
  const setScreen = useApp((s) => s.setScreen);
  const [tab, setTab] = useState<DtcKind>('stored');
  const [clearOpen, setClearOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const list = tab === 'stored' ? dtcs : tab === 'pending' ? pending : permanent;
  const selected = selectedCode ? lookupDtc(selectedCode) : null;

  const allCodes = useMemo(
    () => [...new Set([...dtcs, ...pending, ...permanent].map((d) => d.code))],
    [dtcs, pending, permanent],
  );

  const doClear = async () => {
    setClearing(true);
    const res = await service.clearCodes();
    setClearResult(res.message);
    setClearing(false);
    if (res.ok) await service.fullScan();
  };

  const report = useMemo(() => {
    const lines: string[] = [];
    lines.push('TorqueMedic diagnostic report');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Vehicle VIN: ${vin?.vin || 'not reported'}`);
    if (vin) lines.push(`Decoded: ${vin.make} ${vin.year ?? ''} (${vin.country})`);
    lines.push(`Protocol: ${useApp.getState().protocol}`);
    lines.push(`Battery: ${useApp.getState().voltage.toFixed(1)} V`);
    lines.push('');
    lines.push(`Fault codes: ${allCodes.length ? allCodes.join(', ') : 'none'}`);
    for (const record of [...dtcs, ...pending, ...permanent]) {
      const info = lookupDtc(record.code);
      lines.push(`  ${record.code} [${record.kind}] ${info.title} — ${record.ecu}`);
      lines.push(`    Severity: ${SEVERITY_LABEL[info.severity]} · ${DIFFICULTY_LABEL[info.difficulty]} · Est. ${info.cost}`);
      lines.push(`    ${info.summary}`);
      lines.push('    Likely causes:');
      info.causes.forEach((c, i) => lines.push(`      ${i + 1}. ${c}`));
      lines.push('    Recommended steps:');
      info.steps.forEach((s, i) => lines.push(`      ${i + 1}. ${s}`));
      lines.push('');
    }
    if (freeze.length) {
      lines.push('Freeze frame:');
      for (const row of freeze) lines.push(`  ${row.pid.toString(16).toUpperCase().padStart(2, '0')} ${row.short}: ${row.value.toFixed(2)} ${row.unit ?? ''}`);
    }
    lines.push('');
    lines.push('Readiness monitors:');
    (monitors?.sinceClear ?? []).forEach((m) =>
      lines.push(`  ${m.name}: ${m.available ? (m.complete === null ? 'supported (completion not reported)' : m.complete ? 'complete' : 'NOT complete') : 'not supported'}`),
    );
    return lines.join('\n');
  }, [vin, allCodes, dtcs, pending, permanent, freeze, monitors]);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Diagnostics</h1>
          <p className="page-desc">
            {allCodes.length
              ? `${allCodes.length} unique code${allCodes.length === 1 ? '' : 's'} across ${dtcs.length + pending.length + permanent.length} fault record${dtcs.length + pending.length + permanent.length === 1 ? '' : 's'}.`
              : 'No faults stored. If the light is on, scan again with the engine running.'}
          </p>
        </div>
        <div className="row row-wrap">
          <button className="btn" onClick={() => void service.fullScan()} disabled={scanning}>
            <Icon name={scanning ? 'refresh' : 'search'} size={15} className={scanning ? 'spin' : undefined} /> Rescan
          </button>
          <button className="btn btn-ghost" onClick={() => setReportOpen(true)}>
            <Icon name="print" size={15} /> Report
          </button>
          <button className="btn btn-danger" onClick={() => setClearOpen(true)} disabled={!dtcs.length && !pending.length}>
            <Icon name="trash" size={15} /> Clear codes
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 10 }}>MIL & readiness</div>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className={`pill ${monitors?.mil ? 'pill-danger' : 'pill-ok'}`}>
              <span className="dot" /> {monitors?.mil ? 'Check engine light ON' : 'Light OFF'}
            </span>
            <span className="pill pill-muted">{monitors?.ignition === 'compression' ? 'Compression ignition' : 'Spark ignition'}</span>
          </div>
          <div className="col" style={{ gap: 0 }}>
            {(monitors?.sinceClear ?? []).filter((m) => m.available).slice(0, 6).map((m) => (
              <div className="monitor-row" key={m.name}>
                <span>{m.name}</span>
                <span className={`pill ${m.complete === true ? 'pill-ok' : m.complete === false ? 'pill-warn' : 'pill-muted'}`}>
                  {m.complete === true ? 'Ready' : m.complete === false ? 'Not ready' : 'Supported'}
                </span>
              </div>
            ))}
            {!monitors && <div className="empty">Readiness data not reported by this ECU.</div>}
          </div>
        </div>

        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 10 }}>Freeze frame{freezeCode ? ` — ${freezeCode}` : ''}</div>
          {freeze.length === 0 ? (
            <div className="empty">No freeze-frame snapshot stored.</div>
          ) : (
            <div className="col" style={{ gap: 0 }}>
              {freeze.slice(0, 7).map((row) => {
                const def = PID_BY_ID.get(row.pid);
                const shown = def ? convertValue(def, row.value, imperial) : row.value;
                return (
                  <div className="monitor-row" key={row.pid}>
                    <span>{row.short}</span>
                    <span className="mono small">
                      {shown.toFixed(1)} {def ? displayUnit(def, imperial) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ paddingBottom: 10 }}>
          <div className="tabs-inline">
            {TABS.map((t) => {
              const count = t.id === 'stored' ? dtcs.length : t.id === 'pending' ? pending.length : permanent.length;
              return (
                <button key={t.id} data-active={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label} {count ? `(${count})` : ''}
                </button>
              );
            })}
          </div>
          <span className="tiny muted">{scanning ? 'Scanning…' : `${list.length} record${list.length === 1 ? '' : 's'}`}</span>
        </div>
        <div className="card-pad col" style={{ gap: 8 }}>
          {list.length === 0 && (
            <div className="empty">
              {tab === 'permanent'
                ? 'No permanent codes. These only clear themselves after the ECU verifies a repair over several drive cycles.'
                : 'Nothing in this list.'}
            </div>
          )}
          {list.map((record) => (
            <CodeCard
              key={`${record.code}-${record.header}`}
              code={record.code}
              ecu={record.ecu}
              kind={record.kind}
              active={selectedCode === record.code}
              onClick={() => selectCode(record.code)}
            />
          ))}
        </div>
      </div>

      {tests.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">On-board test results (Mode 06)</div>
            <span className="tiny muted">{tests.length} rows</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Monitor</th>
                <th>TID</th>
                <th className="num">Value</th>
                <th className="num">Limit</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={`${t.mid}-${t.tid}`}>
                  <td>{t.name}</td>
                  <td className="mono small">{hex(t.tid)}</td>
                  <td className="num">{t.value}</td>
                  <td className="num small muted">{t.min}–{t.max}</td>
                  <td>
                    <span className={`pill ${t.pass ? 'pill-ok' : 'pill-warn'}`}>{t.pass ? 'Pass' : 'Review'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!selected} title={selected ? `${selected.code} — ${selected.title}` : ''} onClose={() => selectCode(null)}>
        {selected && (
          <>
            <div className="row row-wrap">
              <span className={`pill sev-${selected.severity} ${selected.severity === 'critical' || selected.severity === 'high' ? 'pill-danger' : selected.severity === 'medium' ? 'pill-warn' : 'pill-info'}`}>
                {SEVERITY_LABEL[selected.severity]} severity
              </span>
              <span className="pill pill-muted">{DIFFICULTY_LABEL[selected.difficulty]}</span>
              <span className="pill pill-muted">{selected.cost}</span>
              <span className="pill pill-muted">{selected.driveable === 'no' ? 'Do not drive' : selected.driveable === 'caution' ? 'Drive with care' : 'Driveable'}</span>
            </div>
            <p className="small muted">{selected.summary}</p>

            {selected.watch.length > 0 && (
              <div className="card card-pad" style={{ background: 'var(--bg-soft)' }}>
                <div className="card-title" style={{ marginBottom: 8 }}>Watch these sensors</div>
                <div className="col" style={{ gap: 6 }}>
                  {selected.watch.slice(0, 5).map((pid) => {
                    const def = PID_BY_ID.get(pid);
                    const series = live[pid];
                    const raw = series?.values.at(-1);
                    if (!def) return null;
                    const shown = raw !== undefined ? convertValue(def, raw, imperial) : Number.NaN;
                    return (
                      <div className="monitor-row" key={pid}>
                        <span className="small">{def.name}</span>
                        <span className="mono small">
                          {Number.isFinite(shown) ? shown.toFixed(def.digits ?? 1) : '—'} {displayUnit(def, imperial)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="card-title" style={{ marginBottom: 8 }}>Likely causes, most common first</div>
              <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {selected.causes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            </div>

            <div>
              <div className="card-title" style={{ marginBottom: 8 }}>Symptoms you may notice</div>
              <div className="chip-list">
                {selected.symptoms.map((s) => (
                  <span className="chip" key={s}>{s}</span>
                ))}
              </div>
            </div>

            {selected.parts.length > 0 && (
              <div>
                <div className="card-title" style={{ marginBottom: 8 }}>Parts commonly involved</div>
                <div className="chip-list">
                  {selected.parts.map((p) => (
                    <span className="chip" key={p}>{p}</span>
                  ))}
                </div>
              </div>
            )}

            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                selectCode(selected.code);
                setScreen('repair');
              }}
            >
              <Icon name="wrench" size={16} /> Open guided repair
            </button>
          </>
        )}
      </Modal>

      <Modal
        open={clearOpen}
        title="Clear all trouble codes?"
        onClose={() => {
          setClearOpen(false);
          setClearResult(null);
        }}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setClearOpen(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => void doClear()} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Clear codes'}
            </button>
          </>
        }
      >
        {clearResult ? (
          <div className="notice notice-ok">{clearResult}</div>
        ) : (
          <>
            <div className="notice notice-warn">
              <Icon name="shock" size={17} />
              <div>
                Clearing codes erases the freeze frame, resets every readiness monitor and will fail an emissions test
                until the monitors re-run. It does <strong>not</strong> fix anything — if the fault is still present the
                code returns.
              </div>
            </div>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Do not clear codes to sell a car — the buyer's inspection will see "not ready".</li>
              <li>Permanent codes cannot be cleared by any scan tool; they self-clear after verified repairs.</li>
              <li>Note the codes down first: {allCodes.join(', ') || 'none'}</li>
            </ul>
          </>
        )}
      </Modal>

      <Modal open={reportOpen} title="Diagnostic report" onClose={() => setReportOpen(false)} footer={
        <>
          <button className="btn btn-ghost" onClick={() => download(`torquemedic-report-${Date.now()}.txt`, report)}>
            <Icon name="download" size={15} /> Download
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            <Icon name="print" size={15} /> Print
          </button>
        </>
      }>
        <pre className="term" style={{ maxHeight: 420, fontSize: 11 }}>{report}</pre>
        <div className="tiny muted">
          Calibration ID: {versions.calId ?? '—'} · CVN: {versions.cvn ?? '—'}
        </div>
      </Modal>
    </div>
  );
}
