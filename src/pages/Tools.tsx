import { useState } from 'react';
import { useApp, type CustomPid } from '../state/store';
import { service } from '../lib/service';
import { evalFormula, hex } from '../lib/format';
import { download } from '../lib/storage';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

export function Tools() {
  const { customPids, addCustomPid, removeCustomPid, logs, clearLogs, imperial, setImperial, conn } = useApp();
  const [cmd, setCmd] = useState('ATI');
  const [output, setOutput] = useState<{ cmd: string; res: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Omit<CustomPid, 'id'>>({
    name: '',
    mode: 0x22,
    pid: 0xf190,
    bytes: 4,
    expr: 'A*256+B',
    unit: '',
    min: 0,
    max: 100,
    header: '',
  });

  const send = async () => {
    if (!cmd.trim()) return;
    setBusy(true);
    const res = await service.sendRaw(cmd.trim());
    setOutput([{ cmd: cmd.trim(), res: res || '(no response)' }, ...output].slice(0, 40));
    setBusy(false);
  };

  const readCustom = async (p: CustomPid) => {
    setBusy(true);
    const bytes = await service.readCustom(p.mode, p.pid, p.header || undefined);
    if (!bytes) {
      setResults((r) => ({ ...r, [p.id]: 'No data — this module did not answer that identifier.' }));
    } else {
      const vars = { A: bytes[0] ?? 0, B: bytes[1] ?? 0, C: bytes[2] ?? 0, D: bytes[3] ?? 0 };
      const value = evalFormula(p.expr, vars);
      setResults((r) => ({
        ...r,
        [p.id]: Number.isFinite(value)
          ? `${value.toFixed(2)} ${p.unit ?? ''}  ·  raw ${bytes.map((b) => hex(b)).join(' ')}`
          : `Formula did not evaluate  ·  raw ${bytes.map((b) => hex(b)).join(' ')}`,
      }));
    }
    setBusy(false);
  };

  const exportLog = () => {
    const text = [...logs]
      .slice()
      .reverse()
      .map((l) => `${new Date(l.t).toISOString()} ${l.dir.toUpperCase().padEnd(5)} ${l.text}`)
      .join('\n');
    download(`torquemedic-adapter-log-${Date.now()}.txt`, text);
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Tools</h1>
          <p className="page-desc">
            Adapter terminal, manufacturer-specific identifiers and session settings. Everything here talks straight to
            the dongle.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Custom PIDs (Mode 22 / Mode 01)</div>
          <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={14} /> Add
          </button>
        </div>
        <div className="card-pad col" style={{ gap: 10 }}>
          {customPids.length === 0 && (
            <div className="small muted">
              Manufacturer-specific data lives behind Mode 22 identifiers. Add one if you know the identifier and scaling
              for your car — this is how you reach values the generic standard does not expose.
            </div>
          )}
          {customPids.map((p) => (
            <div key={p.id} className="card card-pad" style={{ background: 'var(--bg-soft)' }}>
              <div className="row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="strong small">{p.name}</div>
                  <div className="tiny muted mono">
                    {hex(p.mode)}{hex(p.pid, 4)} · {p.expr} {p.unit ? `· ${p.unit}` : ''} {p.header ? `· header ${p.header}` : ''}
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => void readCustom(p)} disabled={busy}>
                  Read
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => removeCustomPid(p.id)} aria-label="Delete">
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {results[p.id] && <div className="mono small" style={{ marginTop: 8, color: 'var(--accent)' }}>{results[p.id]}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Adapter terminal</div>
            <span className="pill pill-muted mono">{conn.kind ?? 'offline'}</span>
          </div>
          <div className="card-pad col">
            <div className="row">
              <input
                className="input mono"
                value={cmd}
                onChange={(e) => setCmd(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send();
                }}
                placeholder="ATI, 0100, 0902…"
                spellCheck={false}
              />
              <button className="btn btn-primary" onClick={() => void send()} disabled={busy || conn.status !== 'connected'}>
                Send
              </button>
            </div>
            <div className="term" style={{ maxHeight: 200 }}>
              {output.length === 0 && <span className="term-line muted">Responses appear here. Try ATI or 0100.</span>}
              {output.map((o, i) => (
                <div key={i}>
                  <div className="term-line" data-dir="tx">&gt; {o.cmd}</div>
                  <div className="term-line" data-dir="rx">{o.res.replace(/\r/g, '\n')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Settings & data</div>
          </div>
          <div className="card-pad col">
            <div className="row">
              <div style={{ flex: 1 }}>
                <div className="strong small">Imperial units</div>
                <div className="tiny muted">mph, °F and psi instead of km/h, °C and kPa</div>
              </div>
              <button className="btn btn-sm" onClick={() => setImperial(!imperial)}>
                {imperial ? 'On' : 'Off'}
              </button>
            </div>
            <div className="divider" />
            <div className="row">
              <div style={{ flex: 1 }}>
                <div className="strong small">Adapter traffic log</div>
                <div className="tiny muted">{logs.length} lines captured this session</div>
              </div>
              <button className="btn btn-sm" onClick={exportLog} disabled={!logs.length}>
                <Icon name="download" size={13} /> Export
              </button>
            </div>
            <div className="divider" />
            <div className="row">
              <div style={{ flex: 1 }}>
                <div className="strong small">Clear captured traffic</div>
                <div className="tiny muted">Repairs and PINs are stored separately and untouched</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={clearLogs}>Clear</button>
            </div>
            <div className="divider" />
            <div className="row">
              <div style={{ flex: 1 }}>
                <div className="strong small">Session</div>
                <div className="tiny muted">Bluetooth and Wi-Fi links are not persisted between visits</div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => void service.disconnect()} disabled={conn.status !== 'connected'}>
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Recent adapter traffic</div>
          <span className="tiny muted">last {Math.min(logs.length, 40)}</span>
        </div>
        <div className="card-pad">
          <div className="term">
            {logs.slice(0, 40).map((l) => (
              <div key={l.id} className="term-line" data-dir={l.dir}>
                {l.dir === 'tx' ? '> ' : l.dir === 'rx' ? '< ' : '· '}
                {l.text.replace(/\r?\n/g, ' ⏎ ')}
              </div>
            ))}
            {logs.length === 0 && <div className="term-line muted">No traffic yet.</div>}
          </div>
        </div>
      </div>

      <Modal
        open={addOpen}
        title="Add custom PID"
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!draft.name.trim()}
              onClick={() => {
                addCustomPid({ ...draft, id: `custom-${Date.now()}` });
                setAddOpen(false);
                setDraft({ ...draft, name: '' });
              }}
            >
              Save
            </button>
          </>
        }
      >
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="cp-name">Name</label>
            <input id="cp-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Transmission fluid temp" />
          </div>
          <div className="field">
            <label htmlFor="cp-mode">Mode (hex)</label>
            <input
              id="cp-mode"
              className="input mono"
              value={hex(draft.mode)}
              onChange={(e) => setDraft({ ...draft, mode: Number.parseInt(e.target.value || '22', 16) })}
            />
          </div>
          <div className="field">
            <label htmlFor="cp-pid">PID / identifier (hex)</label>
            <input
              id="cp-pid"
              className="input mono"
              value={hex(draft.pid, 4)}
              onChange={(e) => setDraft({ ...draft, pid: Number.parseInt(e.target.value || '0', 16) })}
            />
          </div>
          <div className="field">
            <label htmlFor="cp-expr">Formula</label>
            <input
              id="cp-expr"
              className="input mono"
              value={draft.expr}
              onChange={(e) => setDraft({ ...draft, expr: e.target.value })}
              placeholder="A*256+B or ((A*256+B)/4)-40"
            />
          </div>
          <div className="field">
            <label htmlFor="cp-unit">Unit</label>
            <input id="cp-unit" className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="°C" />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="cp-header">Module header (optional)</label>
            <input
              id="cp-header"
              className="input mono"
              value={draft.header}
              onChange={(e) => setDraft({ ...draft, header: e.target.value.toUpperCase() })}
              placeholder="7E1 for the transmission module"
            />
          </div>
        </div>
        <div className="notice notice-info">
          <Icon name="info" size={15} />
          <div>
            Variables <span className="mono">A B C D</span> are the response data bytes. Operators{' '}
            <span className="mono">+ - * / ( )</span> are supported. Set the header to reach a non-engine module.
          </div>
        </div>
      </Modal>
    </div>
  );
}
