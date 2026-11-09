import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { service } from '../lib/service';
import { BleTransport } from '../lib/transport';
import { vehicleLink, type NativeDevice } from '../lib/native/bridge';
import { caps, isIOS, isNativeShell, platformName } from '../lib/platform';
import { haptic } from '../lib/haptics';
import { Icon } from '../components/Icon';
import { InstallCard } from '../components/InstallCard';

function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function quality(rtt: number): { label: string; color: string } {
  if (!rtt) return { label: 'Waiting for data', color: 'var(--muted)' };
  if (rtt < 140) return { label: 'Excellent', color: 'var(--accent)' };
  if (rtt < 400) return { label: 'Good', color: 'var(--accent)' };
  if (rtt < 900) return { label: 'Slow — move closer', color: 'var(--warn)' };
  return { label: 'Very slow — link may be failing', color: 'var(--danger)' };
}

export function Connect() {
  const conn = useApp((s) => s.conn);
  const stats = useApp((s) => s.linkStats);
  const protocol = useApp((s) => s.protocol);
  const [wsUrl, setWsUrl] = useState('ws://192.168.0.10:35000');
  const [showWs, setShowWs] = useState(false);
  const [devices, setDevices] = useState<NativeDevice[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const busy = conn.status === 'connecting';
  const connected = conn.status === 'connected';
  const nativeApp = !!vehicleLink();
  const bleSupported = BleTransport.supported;
  const lastLink = service.lastLink;

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connected]);

  const scanNative = async () => {
    setScanError(null);
    setScanning(true);
    haptic('tap');
    try {
      const found = await service.scanNative();
      setDevices(found);
      if (!found.length) {
        setScanError('No adapters answered. Ignition on, dongle plugged in, and not already paired to another device.');
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const link = quality(stats.rtt);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Connect your adapter</h1>
          <p className="page-desc">
            Any ELM327-compatible OBD-II interface works: Bluetooth LE, Bluetooth Classic or Wi-Fi. Once an adapter has
            connected once, TorqueMedic remembers it and reattaches on its own.
          </p>
        </div>
        <span className="pill pill-muted">
          <Icon name="device" size={12} /> {platformName}
        </span>
      </div>

      {busy && (
        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="dot dot-live" style={{ color: 'var(--accent)' }} />
            <strong style={{ flex: 1 }}>{conn.message || 'Connecting…'}</strong>
            <button className="btn btn-sm btn-ghost" onClick={() => void service.cancelConnect()}>
              Cancel
            </button>
          </div>
          <div className="progress">
            <div style={{ width: '65%' }} />
          </div>
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>
            Keep the phone within a couple of metres of the dongle while it negotiates.
          </p>
        </div>
      )}

      {conn.status === 'error' && (
        <div className="notice notice-danger">
          <Icon name="info" size={17} />
          <div style={{ flex: 1 }}>
            <strong>Could not connect.</strong>
            <div>{conn.message}</div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              {lastLink && (
                <button className="btn btn-sm btn-primary" onClick={() => void service.reconnectLast()}>
                  <Icon name="refresh" size={13} /> Retry {lastLink.label}
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => void service.connectDemo()}>
                Try the demo vehicle
              </button>
            </div>
          </div>
        </div>
      )}

      {connected && (
        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="connect-icon">
              <Icon name="bluetooth" size={18} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{conn.label}</div>
              <div className="tiny muted">
                {protocol || 'Protocol detected'} · link up {formatUptime(now - stats.connectedAt)}
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => void service.disconnect()}>
              Disconnect
            </button>
          </div>
          <div className="grid grid-3-lg">
            <div>
              <div className="tiny muted">Link quality</div>
              <div className="mono" style={{ color: link.color, fontWeight: 650 }}>
                {link.label}
              </div>
            </div>
            <div>
              <div className="tiny muted">Response time</div>
              <div className="mono">{stats.rtt ? `${stats.rtt} ms` : '—'}</div>
            </div>
            <div>
              <div className="tiny muted">Drops / auto-recoveries</div>
              <div className="mono">
                {stats.drops} / {stats.reconnects}
              </div>
            </div>
          </div>
        </div>
      )}

      {!connected && !busy && lastLink && (
        <div className="card card-pad">
          <div className="row">
            <span className="connect-icon" style={{ background: 'rgba(70,184,245,0.1)', color: 'var(--sky)', borderColor: 'rgba(70,184,245,0.2)' }}>
              <Icon name="refresh" size={18} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>Reconnect to {lastLink.label}</div>
              <div className="tiny muted">No picker, no scanning — straight back to the adapter you used last.</div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => void service.reconnectLast()}>
              Reconnect
            </button>
          </div>
        </div>
      )}

      <div className="connect-grid">
        {nativeApp && (
          <div className="connect-card" style={{ gridColumn: '1 / -1' }}>
            <div className="row">
              <span className="connect-icon">
                <Icon name="bluetooth" size={20} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Bluetooth adapter (this app)</div>
                <div className="tiny muted">Native Bluetooth — BLE on iPhone and Android, Classic SPP on Android</div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => void scanNative()} disabled={busy || scanning}>
                {scanning ? (
                  <>
                    <Icon name="refresh" size={14} className="spin" /> Scanning
                  </>
                ) : (
                  <>
                    <Icon name="search" size={14} /> Scan
                  </>
                )}
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              The app scans with the real Bluetooth stack, so a paired dongle appears in the list immediately.
            </p>

            {scanError && <div className="notice notice-warn">{scanError}</div>}

            {devices && devices.length > 0 && (
              <div className="card">
                <div className="scan-list">
                  {devices.map((device) => (
                    <button
                      key={device.id}
                      className="scan-item"
                      disabled={busy}
                      onClick={() => {
                        haptic('tap');
                        void service.connectNative(device);
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 650 }}>{device.name || 'Unnamed adapter'}</div>
                        <div className="tiny muted mono">
                          {device.link === 'classic' ? 'Bluetooth Classic' : 'Bluetooth LE'}
                          {device.rssi ? ` · ${device.rssi} dBm` : ''}
                        </div>
                      </div>
                      <Icon name="chevron" size={16} className="muted" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {bleSupported && (
          <div className="connect-card">
            <div className="row">
              <span className="connect-icon">
                <Icon name="bluetooth" size={20} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Bluetooth LE adapter (browser)</div>
                <div className="tiny muted">Vgate iCar Pro BLE, Veepeak BLE+, OBDLink MX+</div>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Opens the browser&apos;s own Bluetooth picker, filtered to OBD dongles. Your adapter must be a BLE (4.0+)
              type — classic “MINI” dongles are not reachable from a browser tab.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => void service.connectBle()} disabled={busy}>
                <Icon name="search" size={14} /> Pair adapter
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void service.connectBle({ showAll: true })}
                disabled={busy}
              >
                Show all Bluetooth devices
              </button>
            </div>
            <span className="pill pill-ok">
              <Icon name="check" size={12} /> Available on this browser
            </span>
          </div>
        )}

        {!bleSupported && (
          <div className="connect-card">
            <div className="row">
              <span
                className="connect-icon"
                style={{ background: 'rgba(255,176,32,0.1)', color: 'var(--warn)', borderColor: 'rgba(255,176,32,0.24)' }}
              >
                <Icon name="bluetooth" size={20} />
              </span>
              <div>
                <div style={{ fontWeight: 700 }}>Bluetooth in the browser</div>
                <div className="tiny muted">{isIOS ? 'Not possible in iOS Safari' : 'Not available in this browser'}</div>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {isIOS
                ? 'Apple does not expose a Bluetooth API to Safari, so no web page can talk to a dongle on an iPhone. The installed TorqueMedic app uses CoreBluetooth instead — that is the supported route on iOS.'
                : 'Use Chrome or Edge over HTTPS for Bluetooth, or connect through the installed app.'}
            </p>
            {isIOS && <span className="pill pill-warn">Use the iOS app or a Wi-Fi adapter</span>}
          </div>
        )}

        <button className="connect-card" onClick={() => setShowWs((v) => !v)} disabled={busy}>
          <div className="row">
            <span className="connect-icon" style={{ background: 'rgba(70,184,245,0.1)', color: 'var(--sky)', borderColor: 'rgba(70,184,245,0.2)' }}>
              <Icon name="wifi" size={20} />
            </span>
            <div>
              <div style={{ fontWeight: 700 }}>Wi-Fi adapter or bridge</div>
              <div className="tiny muted">ELM327 WiFi, OBDLink WiFi, serial bridge</div>
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Point a WebSocket bridge at the dongle&apos;s TCP port and connect here. Works on every platform, including
            iPhone.
          </p>
        </button>

        <button className="connect-card" onClick={() => void service.connectDemo()} disabled={busy}>
          <div className="row">
            <span className="connect-icon" style={{ background: 'rgba(167,139,250,0.12)', color: 'var(--purple)', borderColor: 'rgba(167,139,250,0.24)' }}>
              <Icon name="spark" size={20} />
            </span>
            <div>
              <div style={{ fontWeight: 700 }}>Demo vehicle</div>
              <div className="tiny muted">Virtual ELM327 with two live ECUs</div>
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            A simulated car that answers real OBD-II commands — codes, freeze frame, monitors, live sensors. Great for
            learning the app before you plug in.
          </p>
          <span className="pill pill-accent">Always available</span>
        </button>
      </div>

      {showWs && (
        <div className="card card-pad col">
          <div className="field">
            <label htmlFor="ws">Bridge address</label>
            <input
              id="ws"
              className="input"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="ws://192.168.0.10:35000"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
          </div>
          <div className="tiny muted">
            A common setup is a small serial-to-WebSocket bridge on the same machine as a classic dongle. Use the
            adapter&apos;s IP when it is on your Wi-Fi network.
          </div>
          {caps.secureContext && wsUrl.startsWith('ws://') && (
            <div className="notice notice-warn">
              <Icon name="info" size={15} />
              <div>
                Phones block <span className="mono">ws://</span> from an HTTPS page. Either serve the app over plain HTTP
                on your local network, or give the bridge a TLS certificate and use{' '}
                <span className="mono">wss://</span>.
              </div>
            </div>
          )}
          <button className="btn btn-primary" onClick={() => void service.connectWs(wsUrl)} disabled={busy}>
            <Icon name="wifi" size={16} /> Connect
          </button>
        </div>
      )}

      <InstallCard />

      <div className="grid grid-3-lg">
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 10 }}>What you can do</div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Read stored, pending and permanent fault codes</li>
            <li>Clear codes and re-verify after a repair</li>
            <li>Live sensor data with charts and CSV logging</li>
            <li>Freeze-frame and readiness monitors</li>
            <li>Mode 06 on-board test results</li>
            <li>VIN decoding and module calibration data</li>
          </ul>
        </div>
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 10 }}>Vehicle coverage</div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            Any vehicle that implements the OBD-II / EOBD standard: US petrol from 1996, EU petrol from 2001 and diesel
            from 2004. The adapter auto-detects CAN, ISO 9141 and KWP2000.
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Body, ABS, airbag and manufacturer-specific modules only answer on their own protocols — see Tools → Custom
            PIDs to add them.
          </p>
        </div>
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 10 }}>If it will not connect</div>
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Check the dongle&apos;s LED — it should light with ignition on</li>
            <li>Close any other app or phone already paired to it</li>
            <li>Unplug, wait 10 seconds, plug back in</li>
            <li>Forget the adapter in system Bluetooth settings, then pair again</li>
            <li>Try “Show all Bluetooth devices” if the name looks unusual</li>
          </ol>
        </div>
      </div>

      <div className="notice notice-info">
        <Icon name="info" size={17} />
        <div>
          <strong>{platformName}</strong> · {isNativeShell ? 'running as an installed app' : 'running in a browser'} ·{' '}
          {caps.webBluetooth ? 'browser Bluetooth available' : 'no browser Bluetooth'} ·{' '}
          {caps.wakeLock ? 'screen stays awake while scanning' : 'screen may sleep during long scans'}.
        </div>
      </div>
    </div>
  );
}
