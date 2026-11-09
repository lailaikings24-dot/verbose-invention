import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { installState, isIOS, promptInstall, subscribeInstall, type InstallState } from '../lib/platform';

/**
 * Install affordance that matches each platform's real behaviour:
 * Android/Chrome and desktop get one button that opens the browser's install
 * sheet; iOS never fires that event, so it gets the two-tap Safari recipe.
 */
export function InstallCard() {
  const [state, setState] = useState<InstallState>(() => installState());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeInstall(() => setState(installState())), []);

  if (state === 'native' || state === 'installed') return null;

  const install = async () => {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
      setState(installState());
    }
  };

  return (
    <div className="card card-pad col">
      <div className="row">
        <span className="connect-icon">
          <Icon name="download" size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>Install TorqueMedic</div>
          <div className="tiny muted">
            Full screen, home-screen icon, works with no signal in a garage or car park.
          </div>
        </div>
      </div>

      {state === 'ready' && (
        <button className="btn btn-primary btn-block" onClick={() => void install()} disabled={busy}>
          <Icon name="download" size={16} /> Add to this device
        </button>
      )}

      {state === 'ios-manual' && (
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.85 }}>
          <li>
            Tap the <strong>Share</strong> button in Safari&apos;s toolbar
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>
          </li>
          <li>
            Tap <strong>Add</strong> — it launches like a normal app
          </li>
        </ol>
      )}

      {state === 'unsupported' && (
        <div className="tiny muted">
          {isIOS
            ? 'Open this page in Safari to install it.'
            : 'Your browser has not offered an install yet. Use Chrome or Edge, and give the page a moment to register.'}
        </div>
      )}
    </div>
  );
}
