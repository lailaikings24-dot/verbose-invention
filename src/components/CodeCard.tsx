import { lookupDtc } from '../lib/dtc/repair';
import { SEVERITY_LABEL } from '../lib/dtc/database';
import { Icon } from './Icon';

export function CodeCard({
  code,
  ecu,
  kind,
  active,
  onClick,
}: {
  code: string;
  ecu: string;
  kind: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const info = lookupDtc(code);
  return (
    <button className={`code-card sev-${info.severity}`} data-selected={active} onClick={onClick}>
      <span className="code-badge">{code}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {info.title}
        </span>
        <span className="tiny muted" style={{ display: 'block', marginTop: 1 }}>
          {ecu} · {kind} · {SEVERITY_LABEL[info.severity]}
        </span>
      </span>
      <Icon name="chevron" size={16} className="muted" />
    </button>
  );
}
