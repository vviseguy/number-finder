import { IconAlertTriangle, IconCheck, IconX } from '@tabler/icons-react';
import { dismissNotice, useAppState } from '../state/store';

export function NoticeBar() {
  const { notice } = useAppState();
  if (!notice) return null;
  return (
    <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.kind === 'info' ? <IconCheck size={15} aria-hidden /> : <IconAlertTriangle size={15} aria-hidden />}
      <span>{notice.text}</span>
      {notice.action && <button type="button" className="btn sm" onClick={notice.action.run}>{notice.action.label}</button>}
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissNotice}><IconX size={14} /></button>
    </div>
  );
}
