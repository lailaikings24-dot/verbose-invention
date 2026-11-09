import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { service } from '../lib/service';
import { PID_BY_ID, PIDS, convertValue, displayUnit } from '../lib/obd/pids';
import { Gauge } from '../components/Gauge';
import { Sparkline } from '../components/Sparkline';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { download } from '../lib/storage';

const COLORS = ['#2ee6a8', '#46b8f5', '#ffb020', '#a78bfa', '#ff7d7d', '#5eead4', '#f472b6', '#facc15'];

export function LiveData() {
  const { livePids, live, liveActive, liveHz, supported, imperial } = useApp();
  const setLivePids = useApp((s) => s.setLivePids);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');

  const defs = livePids.map((pid) => PID_BY_ID.get(pid)).filter((d): d is NonNullable<typeof d> => !!d);

  const candidates = useMemo(() => {
    const available = supported.length ? PIDS.filter((p) => supported.includes(p.pid)) : PIDS;
    const q = query.trim().toLowerCase();
    return available
      .filter((p) => !livePids.includes(p.pid))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.short.toLowerCase().includes(q) || p.pid.toString(16).includes(q))
      .slice(0, 60);
  }, [supported, query, livePids]);

  const toggle = (pid: number) => {
    if (livePids.includes(pid)) setLivePids(livePids.filter((p) => p !== pid));
    else setLivePids([...livePids, pid]);
  };

  const exportCsv = () => {
    const active = livePids.filter((p) => (live[p]?.values.length ?? 0) > 1);
    if (!active.length) return;
    const base = active.reduce((a, b) => ((live[a]?.stamps.length ?? 0) >= (live[b]?.stamps.length ?? 0) ? a : b));
    const stamps = live[base]?.stamps ?? [];
    const header = ['timestamp', ...active.map((p) => {
      const d = PID_BY_ID.get(p);
      return `${d?.short ?? p} (${displayUnit(d!, imperial)})`;
    })];
    const lines = [header.join(',')];
    for (const t of stamps) {
      const row = [new Date(t).toISOString()];
      for (const p of active) {
        const s = live[p];
        if (!s) {
          row.push('');
          continue;
        }
        let idx = s.stamps.findIndex((x) => x >= t);
        if (idx < 0) idx = s.stamps.length - 1;
        const def = PID_BY_ID.get(p);
        const v = s.values[idx];
        row.push(def && v !== undefined ? convertValue(def, v, imperial).toFixed(2) : '');
      }
      lines.push(row.join(','));
    }
    download(`torquemedic-live-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, lines.join('\n'), 'text/csv');
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Live data</h1>
          <p className="page-desc">
            Polling {defs.length} sensor{defs.length === 1 ? '' : 's'} at {liveHz || '—'} Hz.
            {liveActive ? ' Streaming now.' : ' Paused.'}
          </p>
        </div>
        <div className="row row-wrap">
          <button className="btn" onClick={() => (liveActive ? service.stopLive() : service.startLive())}>
            <Icon name={liveActive ? 'pause' : 'play'} size={15} />
            {liveActive ? 'Pause' : 'Resume'}
          </button>
          <button className="btn" onClick={() => setPicker(true)}>
            <Icon name="plus" size={15} /> Sensors
          </button>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={!liveActive && !Object.keys(live).length}>
            <Icon name="download" size={15} /> CSV
          </button>
        </div>
      </div>

      {defs.length === 0 ? (
        <div className="card empty">
          <Icon name="live" size={24} className="muted" />
          <div style={{ marginTop: 8 }}>No sensors selected.</div>
          <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} onClick={() => setPicker(true)}>
            <Icon name="plus" size={14} /> Add a sensor
          </button>
        </div>
      ) : (
        <div className="grid grid-auto">
          {defs.map((def, i) => {
            const series = live[def.pid];
            const raw = series?.values.at(-1);
            const value = raw !== undefined ? convertValue(def, raw, imperial) : 0;
            return (
              <Gauge
                key={def.pid}
                label={def.name}
                value={value}
                unit={displayUnit(def, imperial)}
                min={convertValue(def, def.min, imperial)}
                max={convertValue(def, def.max, imperial)}
                color={COLORS[i % COLORS.length]}
                digits={def.digits ?? (Math.abs(value) >= 100 ? 0 : 1)}
                onRemove={() => toggle(def.pid)}
              />
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="card-title">Trends</div>
          <span className="tiny muted">Last 150 samples</span>
        </div>
        <div className="card-pad col" style={{ gap: 18 }}>
          {defs.length === 0 && <div className="empty">Add a sensor to see its trend.</div>}
          {defs.map((def, i) => {
            const values = (live[def.pid]?.values ?? []).map((v) => convertValue(def, v, imperial));
            const current = values.at(-1);
            const min = values.length ? Math.min(...values) : 0;
            const max = values.length ? Math.max(...values) : 0;
            return (
              <div key={def.pid}>
                <div className="row" style={{ marginBottom: 4 }}>
                  <strong className="small">{def.name}</strong>
                  <div className="spacer" />
                  <span className="mono small">{current !== undefined ? current.toFixed(def.digits ?? 1) : '—'} {displayUnit(def, imperial)}</span>
                </div>
                <Sparkline values={values} color={COLORS[i % COLORS.length]} height={54} />
                <div className="row tiny muted" style={{ justifyContent: 'space-between', marginTop: 2 }}>
                  <span className="mono">min {min.toFixed(1)}</span>
                  <span className="mono">max {max.toFixed(1)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="notice notice-warn">
        <Icon name="shock" size={17} />
        <div>
          Never watch the screen while driving. Live data is a diagnostic aid — have a passenger hold the phone, or log
          to CSV and review the session afterwards.
        </div>
      </div>

      <Modal open={picker} title="Choose sensors" onClose={() => setPicker(false)}>
        <div className="field">
          <label htmlFor="pid-search">Search</label>
          <input
            id="pid-search"
            className="input"
            placeholder="RPM, coolant, 0C…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="tiny muted">
          {supported.length ? `${supported.length} PIDs advertised by this vehicle` : 'Selecting from the full generic PID set'}
        </div>
        <div className="scan-list" style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
          {candidates.length === 0 && <div className="empty">Nothing matches.</div>}
          {candidates.map((p) => (
            <button key={p.pid} className="scan-item" onClick={() => toggle(p.pid)}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                <span className="tiny muted mono">01 {p.pid.toString(16).toUpperCase().padStart(2, '0')} · {p.unit ?? 'raw'}</span>
              </span>
              <Icon name="plus" size={16} className="muted" />
            </button>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="tiny muted">{livePids.length}/16 selected</span>
          <button className="btn btn-sm" onClick={() => setLivePids([])} disabled={!livePids.length}>
            Clear all
          </button>
        </div>
      </Modal>
    </div>
  );
}
