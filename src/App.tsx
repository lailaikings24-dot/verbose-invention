import { useEffect } from 'react';
import { useApp, type Screen } from './state/store';
import { Connect } from './pages/Connect';
import { Dashboard } from './pages/Dashboard';
import { LiveData } from './pages/LiveData';
import { Codes } from './pages/Codes';
import { Repair } from './pages/Repair';
import { Vehicle } from './pages/Vehicle';
import { Tools } from './pages/Tools';
import { Icon } from './components/Icon';
import { pathForScreen, screenForPath, titleForScreen } from './lib/routes';

const NAV: { id: Screen; label: string; icon: string; mobile: boolean }[] = [
  { id: 'dashboard', label: 'Home', icon: 'dashboard', mobile: true },
  { id: 'live', label: 'Live', icon: 'live', mobile: true },
  { id: 'codes', label: 'Codes', icon: 'codes', mobile: true },
  { id: 'repair', label: 'Repair', icon: 'wrench', mobile: true },
  { id: 'vehicle', label: 'Vehicle', icon: 'car', mobile: true },
  { id: 'tools', label: 'Tools', icon: 'tools', mobile: true },
];

export default function App() {
  const screen = useApp((s) => s.screen);
  const setScreen = useApp((s) => s.setScreen);
  const conn = useApp((s) => s.conn);
  const scanning = useApp((s) => s.scanning);
  const dtcs = useApp((s) => s.dtcs);
  const pending = useApp((s) => s.pending);

  const connected = conn.status === 'connected';

  useEffect(() => {
    if (connected && screen === 'connect') setScreen('dashboard');
  }, [connected, screen, setScreen]);

  // Back/forward is part of the shell: the browser buttons move between screens
  // instead of leaving the app.
  useEffect(() => {
    const onPop = () => {
      const next = screenForPath(window.location.pathname);
      if (next) setScreen(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setScreen]);

  // Keep the address bar in step with the visible screen, whichever component
  // changed it, so every screen has a URL you can copy. An unrecognised path is
  // normalised to the screen it resolves to rather than left dangling.
  useEffect(() => {
    const path = pathForScreen(screen);
    if (window.location.pathname !== path) {
      window.history.pushState({ screen }, '', path);
    }
    document.title = titleForScreen(screen);
  }, [screen]);

  const target: Screen = connected ? screen : 'connect';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand" style={{ padding: '4px 10px 18px' }}>
          <span className="brand-mark">
            <Icon name="gauge" size={18} className="muted" />
          </span>
          <div>
            <div className="brand-name">TorqueMedic</div>
            <div className="brand-sub">OBD-II diagnostics</div>
          </div>
        </div>
        {NAV.map((item) => (
          <button
            key={item.id}
            className="side-item"
            data-active={target === item.id}
            onClick={() => setScreen(item.id)}
            disabled={!connected}
            style={!connected ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          >
            <Icon name={item.icon} />
            {item.label}
            {connected && item.id === 'codes' && dtcs.length + pending.length > 0 && (
              <span className="pill pill-danger" style={{ marginLeft: 'auto', padding: '1px 7px' }}>
                {dtcs.length + pending.length}
              </span>
            )}
          </button>
        ))}
        <div className="spacer" />
        <button className="side-item" data-active={target === 'connect'} onClick={() => setScreen('connect')}>
          <Icon name="bluetooth" />
          Connection
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="gauge" size={18} className="muted" />
            </span>
            <div>
              <div className="brand-name">TorqueMedic</div>
              <div className="brand-sub">{connected ? 'Live link' : 'Not connected'}</div>
            </div>
          </div>
          <div className="topbar-spacer" />
          {scanning && (
            <span className="pill pill-info">
              <Icon name="refresh" size={12} className="spin" /> Scanning
            </span>
          )}
          <button
            className="conn-banner"
            onClick={() => setScreen(target === 'connect' ? 'dashboard' : 'connect')}
            style={{
              color: conn.status === 'connected' ? 'var(--accent)' : conn.status === 'connecting' ? 'var(--warn)' : conn.status === 'error' ? 'var(--danger)' : 'var(--muted)',
            }}
          >
            <span className={`dot ${conn.status === 'connected' ? 'dot-live' : ''}`} />
            <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {conn.status === 'connected' ? conn.kind === 'demo' ? 'Demo vehicle' : 'Adapter connected' : conn.status === 'connecting' ? 'Connecting…' : conn.status === 'error' ? 'Link failed' : 'Connect adapter'}
            </span>
          </button>
        </header>

        {target === 'connect' && <Connect />}
        {target === 'dashboard' && <Dashboard />}
        {target === 'live' && <LiveData />}
        {target === 'codes' && <Codes />}
        {target === 'repair' && <Repair />}
        {target === 'vehicle' && <Vehicle />}
        {target === 'tools' && <Tools />}
      </main>

      <nav className="tabbar">
        <button className="tab" data-active={target === 'dashboard'} onClick={() => setScreen('dashboard')} disabled={!connected}>
          <Icon name="dashboard" />
          Home
        </button>
        <button className="tab" data-active={target === 'live'} onClick={() => setScreen('live')} disabled={!connected}>
          <Icon name="live" />
          Live
        </button>
        <button className="tab" data-active={target === 'codes'} onClick={() => setScreen('codes')} disabled={!connected}>
          <Icon name="codes" />
          Codes
        </button>
        <button className="tab" data-active={target === 'repair'} onClick={() => setScreen('repair')} disabled={!connected}>
          <Icon name="wrench" />
          Repair
        </button>
        <button className="tab" data-active={target === 'vehicle'} onClick={() => setScreen('vehicle')} disabled={!connected}>
          <Icon name="car" />
          Vehicle
        </button>
        <button className="tab" data-active={target === 'tools'} onClick={() => setScreen('tools')} disabled={!connected}>
          <Icon name="tools" />
          Tools
        </button>
        <button className="tab" data-active={target === 'connect'} onClick={() => setScreen('connect')}>
          <Icon name="bluetooth" />
          Link
        </button>
      </nav>
    </div>
  );
}
