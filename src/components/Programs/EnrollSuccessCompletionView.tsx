import React from 'react';
import {
  CheckCircle2, AlertCircle, ClipboardList, Upload, Target, Briefcase, ListTodo,
} from 'lucide-react';
import type { EnrollCompletionSnapshot } from '../../utils/enrollCompletion';
import RecordTasksPanel from '../Common/RecordTasksPanel';
import './EnrollCompletionDrawer.css';

export interface EnrollSuccessActions {
  onLogVisit: () => void;
  onUploadDocuments: () => void;
  onRecordOutcome: () => void;
  onClose: () => void;
}

interface Props {
  snapshot: EnrollCompletionSnapshot;
  showUploadDocuments: boolean;
  onActions: EnrollSuccessActions;
}

const EnrollSuccessCompletionView: React.FC<Props> = ({ snapshot: s, showUploadDocuments, onActions }) => (
  <div className="enroll-success-view">
    <header className="enroll-completion-header" style={{ padding: 0, marginBottom: '1rem' }}>
      <h2 id="enroll-success-title" style={{ margin: 0, fontSize: '1.15rem' }}>
        <CheckCircle2 size={20} color="var(--color-success)" style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {s.beneficiaryName} enrolled successfully
      </h2>
      <p className="enroll-completion-sub" style={{ margin: '0.35rem 0 0' }}>
        Enrolled in <strong>{s.program}</strong> — choose the next step to close the intake loop.
      </p>
    </header>

    <div className="enroll-completion-status-grid">
      <StatusRow label="Consent" ok={s.consentCaptured} okText="Captured on file" missText="Not recorded" />
      <StatusRow label="Aadhaar" ok={s.aadhaarVerified} okText="Verified" missText="Not verified" />
      <StatusRow label="Household" ok={s.householdLinked} okText="Linked" missText="Not linked" />
      <StatusRow
        label="Documents"
        ok={s.documentsComplete && !s.docsSkipped}
        warn={s.docsSkipped}
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

    <section className="enroll-completion-actions">
      <h3>Next best actions</h3>
      <div className="enroll-completion-actions-grid">
        <button type="button" className="btn btn-primary" onClick={onActions.onLogVisit}>
          <Briefcase size={16} /> Log first service visit
        </button>
        {showUploadDocuments && (
          <button type="button" className="btn btn-secondary" onClick={onActions.onUploadDocuments}>
            <Upload size={16} /> Upload missing documents
          </button>
        )}
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
      <RecordTasksPanel entityType="beneficiary" entityId={s.beneficiaryId} entityLabel={s.beneficiaryName} compact />
    </section>

    <div className="enroll-completion-timeline">
      <ClipboardList size={12} /> Activity saved to beneficiary timeline.
    </div>

    <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: '0.75rem' }} onClick={onActions.onClose}>
      Done for now
    </button>
  </div>
);

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

export default EnrollSuccessCompletionView;
