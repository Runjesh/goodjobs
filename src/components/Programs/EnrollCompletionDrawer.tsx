import React from 'react';
import {
  X, CheckCircle2, AlertCircle, ClipboardList, Upload,
  Target, Briefcase, ListTodo,
} from 'lucide-react';
import type { EnrollCompletionSnapshot } from '../../utils/enrollCompletion';
import RecordTasksPanel from '../Common/RecordTasksPanel';

export interface EnrollCompletionActions {
  onLogVisit: () => void;
  onUploadDocuments: () => void;
  onRecordOutcome: () => void;
  onClose: () => void;
}

interface Props {
  snapshot: EnrollCompletionSnapshot;
  onActions: EnrollCompletionActions;
}

const EnrollCompletionDrawer: React.FC<Props> = ({ snapshot, onActions }) => {
  const s = snapshot;

  return (
    <>
      <div
        className="enroll-completion-backdrop"
        role="presentation"
        onClick={onActions.onClose}
        onKeyDown={e => e.key === 'Escape' && onActions.onClose()}
      />
      <aside
        className="enroll-completion-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enroll-complete-title"
      >
        <button
          type="button"
          className="action-btn enroll-completion-close"
          onClick={onActions.onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <header className="enroll-completion-header">
          <h2 id="enroll-complete-title">
            <CheckCircle2 size={20} color="var(--color-success)" style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {s.beneficiaryName} enrolled
          </h2>
          <p className="enroll-completion-sub">
            Enrolled in <strong>{s.program}</strong> — choose the next step to close the intake loop.
          </p>
        </header>

        <div className="enroll-completion-body">
          <div className="enroll-completion-status-grid">
            <StatusRow
              label="Consent"
              ok={s.consentCaptured}
              okText="Captured on file"
              missText="Not recorded — follow up before sharing data"
            />
            <StatusRow
              label="Aadhaar"
              ok={s.aadhaarVerified}
              okText="Verified"
              missText="Not verified — required for full MIS reporting"
            />
            <StatusRow
              label="Household"
              ok={s.householdLinked}
              okText="Linked"
              missText="Missing — link household head or ID"
            />
            <StatusRow
              label="Documents"
              ok={s.documentsComplete && !s.docsSkipped}
              warn={s.docsSkipped && s.consentCaptured}
              okText="Uploaded"
              missText={s.docsSkipped ? 'Skipped — collect soon' : 'Incomplete'}
            />
          </div>

          {s.sourceFieldNote && (
            <div className="enroll-completion-note">
              <strong>Field note (WhatsApp MIS)</strong>
              <p style={{ margin: '0.35rem 0 0' }}>{s.sourceFieldNote}</p>
            </div>
          )}

          {s.hasToCOutcomes && (
            <p style={{ fontSize: '0.8rem', margin: 0, color: '#0F766E' }}>
              This programme has outcomes in Theory of Change — capture a baseline when possible.
            </p>
          )}

          <section className="enroll-completion-actions">
            <h3>Next best actions</h3>
            <div className="enroll-completion-actions-grid">
              <button type="button" className="btn btn-primary" onClick={onActions.onLogVisit}>
                <Briefcase size={16} /> Log first service visit
              </button>
              <button type="button" className="btn btn-secondary" onClick={onActions.onUploadDocuments}>
                <Upload size={16} /> Upload missing documents
              </button>
              <button type="button" className="btn btn-secondary" onClick={onActions.onRecordOutcome}>
                <Target size={16} /> Record baseline outcome
              </button>
            </div>
          </section>

          <section>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
              <ListTodo size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Follow-up tasks
            </h3>
            <RecordTasksPanel
              entityType="beneficiary"
              entityId={s.beneficiaryId}
              entityLabel={s.beneficiaryName}
              compact
            />
          </section>

          <div className="enroll-completion-timeline">
            <ClipboardList size={12} /> Activity saved to beneficiary timeline.
          </div>

          <button type="button" className="btn btn-ghost" style={{ width: '100%' }} onClick={onActions.onClose}>
            Done for now
          </button>
        </div>
      </aside>
    </>
  );
};

function StatusRow({
  label, ok, warn, okText, missText,
}: {
  label: string;
  ok: boolean;
  warn?: boolean;
  okText: string;
  missText: string;
}) {
  const cls = ok ? 'ok' : warn ? 'warn' : 'miss';
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div className={`enroll-status-row ${cls}`}>
      <Icon size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <strong>{label}</strong>
        <div style={{ color: 'var(--color-text-secondary)' }}>{ok ? okText : missText}</div>
      </div>
    </div>
  );
}

export default EnrollCompletionDrawer;
