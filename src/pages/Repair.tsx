import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { service } from '../lib/service';
import { lookupDtc } from '../lib/dtc/repair';
import { DIFFICULTY_LABEL, MONITOR_HELP_FALLBACK, SEVERITY_LABEL } from '../lib/dtc/labels';
import { MONITOR_HELP } from '../lib/obd/dtc';
import { Icon } from '../components/Icon';
import { load, save } from '../lib/storage';
import { Modal } from '../components/Modal';
import { timeAgo } from '../lib/format';

export function Repair() {
  const { dtcs, pending, permanent, selectedCode, monitors, vin, scanning, lastScanAt, repairs } = useApp();
  const selectCode = useApp((s) => s.selectCode);
  const addRepair = useApp((s) => s.addRepair);
  const updateRepair = useApp((s) => s.updateRepair);
  const [manual, setManual] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [logOpen, setLogOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const activeCodes = useMemo(() => [...new Set([...dtcs, ...pending, ...permanent].map((d) => d.code))], [dtcs, pending, permanent]);
  const code = selectedCode || activeCodes[0] || null;
  const info = code ? lookupDtc(code) : null;

  useEffect(() => {
    if (code) setChecked(load<Record<string, boolean>>(`steps:${code}`, {}));
  }, [code]);

  const toggleStep = (step: string) => {
    if (!code) return;
    const next = { ...checked, [step]: !checked[step] };
    setChecked(next);
    save(`steps:${code}`, next);
  };

  const doneCount = info ? info.steps.filter((s) => checked[s]).length : 0;
  const progress = info && info.steps.length ? Math.round((doneCount / info.steps.length) * 100) : 0;

  const codeHistory = repairs.filter((r) => r.code === code);

  const logRepair = () => {
    if (!code) return;
    addRepair({
      id: `${code}-${Date.now()}`,
      code,
      action: info?.title ?? code,
      at: Date.now(),
      outcome: 'pending',
      note,
      vin: vin?.vin,
    });
    setNote('');
    setLogOpen(false);
    setToast('Repair logged. Clear the codes and re-scan after a drive cycle to confirm the fix.');
  };

  const verify = async () => {
    setBusy(true);
    const res = await service.clearCodes();
    setToast(res.message);
    await service.fullScan();
    setBusy(false);
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Repair assistant</h1>
          <p className="page-desc">
            Guided diagnostics for the codes this car is reporting, with a verification step so you know the fix worked
            instead of guessing.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void service.fullScan()} disabled={scanning || busy}>
            <Icon name={scanning || busy ? 'refresh' : 'search'} size={15} className={scanning || busy ? 'spin' : undefined} /> Rescan
          </button>
        </div>
      </div>

      {toast && (
        <div className="notice notice-ok">
          <Icon name="check" size={16} />
          <div style={{ flex: 1 }}>{toast}</div>
          <button className="btn btn-sm btn-ghost" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}

      <div className="card card-pad">
        <div className="row row-wrap" style={{ marginBottom: 10 }}>
          <div className="card-title">Active codes</div>
          <div className="spacer" />
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input"
              style={{ width: 130, padding: '6px 9px', fontSize: 12 }}
              placeholder="e.g. P0420"
              value={manual}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              maxLength={5}
            />
            <button
              className="btn btn-sm"
              disabled={!/^[PCBU][0-3][0-9A-F]{3}$/.test(manual)}
              onClick={() => {
                selectCode(manual);
                setManual('');
              }}
            >
              Look up
            </button>
          </div>
        </div>
        {activeCodes.length === 0 ? (
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <span className="small muted">No codes to work from. You can still look one up manually.</span>
          </div>
        ) : (
          <div className="chip-list">
            {activeCodes.map((c) => (
              <button key={c} className="chip" data-on={c === code} onClick={() => selectCode(c)}>
                <span className="mono">{c}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!info && (
        <div className="card empty">
          <Icon name="wrench" size={24} className="muted" />
          <div style={{ marginTop: 8 }}>Select a code above, or enter one to see its repair path.</div>
        </div>
      )}

      {info && (
        <>
          <div className="card card-pad">
            <div className="row row-wrap" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <span className="code-badge" style={{ fontSize: 15 }}>{info.code}</span>
                  <h2 style={{ fontSize: 18 }}>{info.title}</h2>
                </div>
                <p className="small muted" style={{ maxWidth: '70ch' }}>{info.summary}</p>
              </div>
              <div className="spacer" />
              <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
                <span className="pill pill-muted">{SEVERITY_LABEL[info.severity]} severity</span>
                <span className="pill pill-muted">{DIFFICULTY_LABEL[info.difficulty]}</span>
                <span className="pill pill-accent">{info.cost}</span>
              </div>
            </div>

            <div className="divider" style={{ margin: '14px 0' }} />

            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="stat-label">Repair progress</span>
              <span className="tiny muted mono">{doneCount}/{info.steps.length} steps</span>
            </div>
            <div className="progress">
              <div style={{ width: `${progress}%` }} />
            </div>

            <div className="steps" style={{ marginTop: 14 }}>
              {info.steps.map((step, i) => (
                <button className="step" key={step} data-done={!!checked[step]} onClick={() => toggleStep(step)} style={{ textAlign: 'left' }}>
                  <span className="step-num">{checked[step] ? '✓' : i + 1}</span>
                  <span className="step-body">{step}</span>
                </button>
              ))}
            </div>

            <div className="row row-wrap" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => setLogOpen(true)}>
                <Icon name="check" size={15} /> Log this repair
              </button>
              <button className="btn" onClick={() => void verify()} disabled={busy}>
                <Icon name="trash" size={15} /> Clear & re-verify
              </button>
              <div className="spacer" />
              <span className="tiny muted">
                {lastScanAt ? `Last scan ${timeAgo(lastScanAt)}` : 'Not scanned yet'}
              </span>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card card-pad">
              <div className="card-title" style={{ marginBottom: 10 }}>Likely causes</div>
              <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.75 }}>
                {info.causes.map((c) => <li key={c}>{c}</li>)}
              </ol>
              {info.parts.length > 0 && (
                <>
                  <div className="divider" style={{ margin: '12px 0' }} />
                  <div className="stat-label" style={{ marginBottom: 8 }}>Parts to price up</div>
                  <div className="chip-list">
                    {info.parts.map((p) => <span className="chip" key={p}>{p}</span>)}
                  </div>
                </>
              )}
            </div>

            <div className="card card-pad">
              <div className="card-title" style={{ marginBottom: 10 }}>Related codes</div>
              {info.related.length ? (
                <div className="chip-list">
                  {info.related.map((r) => (
                    <button key={r} className="chip" onClick={() => selectCode(r)}>
                      <span className="mono">{r}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="small muted">No directly related codes catalogued.</p>
              )}
              <div className="divider" style={{ margin: '12px 0' }} />
              <div className="card-title" style={{ marginBottom: 8 }}>Verification</div>
              <p className="small muted" style={{ marginBottom: 10 }}>
                After the repair: clear the codes, complete the drive cycle below, then rescan. If the code stays away
                through a full cycle the repair held.
              </p>
              <div className="col" style={{ gap: 0 }}>
                {(monitors?.sinceClear ?? []).filter((m) => m.available).slice(0, 4).map((m) => (
                  <div className="monitor-row" key={m.name}>
                    <span className="small">{m.name}</span>
                    <span className={`pill ${m.complete === true ? 'pill-ok' : 'pill-warn'}`}>
                      {m.complete === true ? 'Ready' : 'Needs cycle'}
                    </span>
                  </div>
                ))}
                {!monitors && <div className="empty">Readiness monitors unavailable.</div>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">Repair log for {info.code}</div>
              <span className="tiny muted">{codeHistory.length} entr{codeHistory.length === 1 ? 'y' : 'ies'}</span>
            </div>
            {codeHistory.length === 0 ? (
              <div className="empty">Nothing logged yet. Log the repair to track whether it actually fixed the fault.</div>
            ) : (
              <div className="card-pad col" style={{ gap: 10 }}>
                {codeHistory.map((entry) => {
                  const resolvedOutside = lastScanAt && entry.at < lastScanAt && !activeCodes.includes(info.code);
                  return (
                    <div key={entry.id} className="card card-pad" style={{ background: 'var(--bg-soft)' }}>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <strong className="small">{entry.action}</strong>
                        <div className="spacer" />
                        <span className={`pill ${entry.outcome === 'fixed' ? 'pill-ok' : entry.outcome === 'returned' ? 'pill-danger' : 'pill-warn'}`}>
                          {entry.outcome === 'fixed' ? 'Fixed' : entry.outcome === 'returned' ? 'Came back' : 'Awaiting verification'}
                        </span>
                      </div>
                      <div className="tiny muted" style={{ marginBottom: 8 }}>
                        {new Date(entry.at).toLocaleString()} · {entry.vin ?? 'no VIN'}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </div>
                      {entry.outcome === 'pending' && (
                        <div className="row row-wrap">
                          <button className="btn btn-sm" onClick={() => updateRepair(entry.id, { outcome: 'fixed' })} disabled={!resolvedOutside}>
                            <Icon name="check" size={13} /> {resolvedOutside ? `Confirm fixed (${info.code} clear)` : `Re-scan to confirm ${info.code} is gone`}
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => updateRepair(entry.id, { outcome: 'returned' })}>
                            Code came back
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-title" style={{ marginBottom: 10 }}>Drive cycle to re-run monitors</div>
            <div className="col" style={{ gap: 8 }}>
              {Object.values(MONITOR_HELP).slice(0, 4).map((m) => (
                <div key={m.name} className="small">
                  <strong>{m.name}</strong>
                  <div className="muted">{m.driveCycle}</div>
                </div>
              ))}
              <div className="small muted">{MONITOR_HELP_FALLBACK}</div>
            </div>
          </div>
        </>
      )}

      <Modal
        open={logOpen}
        title="Log this repair"
        onClose={() => setLogOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setLogOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={logRepair}>Save entry</button>
          </>
        }
      >
        <p className="small muted">
          Records what was done against <span className="mono">{info?.code}</span> so you can prove whether the repair
          worked after the next drive cycle.
        </p>
        <div className="field">
          <label htmlFor="note">What did you do? (optional)</label>
          <input
            id="note"
            className="input"
            placeholder="Cleaned MAF, replaced intake boot"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="tiny muted">
          {doneCount}/{info?.steps.length ?? 0} diagnostic steps checked. You can still log a partial repair.
        </div>
      </Modal>
    </div>
  );
}
