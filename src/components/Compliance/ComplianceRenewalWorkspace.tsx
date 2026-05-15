import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  X, CheckCircle2, Circle, ClipboardList, Upload,
  User, ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { toastComplianceRenewedSuccess } from '../../utils/workflowSuccess';
import { useStore, type ComplianceDocument } from '../../store/useStore';
import { apiFetch } from '../../api/client';
import { readApiError } from '../../utils/apiPersist';
import {
  RENEWAL_STATE_LABELS,
  type RenewalState,
  renewalStepsForDoc,
  renewalTaskIntentId,
  renewalWorkspacePath,
  daysUntilExpiry,
  deriveRenewalState,
  computeRenewalProgress,
  ensureRenewalTasks,
  patchDocRenewal,
  applyRenewalUploadComplete,
  syncRenewalStateAfterProgress,
  linkedGrantsForDoc,
  getStoredRenewalState,
} from '../../utils/complianceRenewal';
import './ComplianceRenewalWorkspace.css';

const OWNER_OPTIONS = [
  { value: '', label: 'Unassigned' },
  { value: 'role:finance', label: 'Finance' },
  { value: 'role:ed', label: 'Executive Director' },
  { value: 'role:field', label: 'Programme / Field' },
];

const ASSIGNEE_OPTIONS = [
  { value: '', label: 'Unassigned' },
  ...OWNER_OPTIONS.slice(1),
];

interface Props {
  doc: ComplianceDocument;
  onClose: () => void;
}

const ComplianceRenewalWorkspace: React.FC<Props> = ({ doc, onClose }) => {
  const navigate = useNavigate();
  const tasks = useStore(s => s.tasks);
  const upsertTaskByIntent = useStore(s => s.upsertTaskByIntent);
  const complianceDocs = useStore(s => s.complianceDocs);
  const setComplianceDocs = useStore(s => s.setComplianceDocs);
  const complianceGrantLinks = useStore(s => s.complianceGrantLinks);
  const csrCards = useStore(s => s.csrCards);

  const steps = useMemo(() => renewalStepsForDoc(doc.name, doc.type), [doc.name, doc.type]);
  const daysLeft = daysUntilExpiry(doc.expiry);
  const grantRisks = useMemo(
    () => linkedGrantsForDoc(doc.id, complianceGrantLinks, csrCards, complianceDocs),
    [doc.id, complianceGrantLinks, csrCards, complianceDocs],
  );

  const liveDoc = complianceDocs.find(d => d.id === doc.id) ?? doc;
  const { done, total, pct } = computeRenewalProgress(tasks, doc.id, steps.length);
  const pipelineState = deriveRenewalState(liveDoc, tasks, steps.length);

  const [owner, setOwner] = useState(
    () => (liveDoc.assigned_to || (liveDoc.details?.renewalOwner as string)) ?? '',
  );
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newExpiry, setNewExpiry] = useState('');

  useEffect(() => {
    ensureRenewalTasks(liveDoc, { tasks, upsertTaskByIntent }, owner || undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDoc.id]);

  useEffect(() => {
    syncRenewalStateAfterProgress(liveDoc, tasks, setComplianceDocs, complianceDocs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, liveDoc.id]);

  const setPipelineState = useCallback((state: RenewalState) => {
    const next = patchDocRenewal(liveDoc, { renewalState: state, renewalOwner: owner });
    setComplianceDocs(complianceDocs.map(d => (d.id === liveDoc.id ? next : d)));
  }, [liveDoc, owner, complianceDocs, setComplianceDocs]);

  const setOwnerAndPersist = useCallback((nextOwner: string) => {
    setOwner(nextOwner);
    const next = patchDocRenewal(liveDoc, {
      renewalOwner: nextOwner,
      renewalState: pipelineState === 'not_started' ? 'collecting_docs' : pipelineState,
    });
    setComplianceDocs(complianceDocs.map(d => (d.id === liveDoc.id ? next : d)));
    steps.forEach((_, i) => {
      const intent = renewalTaskIntentId(doc.id, i);
      const t = tasks.find(x => x.id === intent || x.sourceIntentId === intent);
      if (t && t.status !== 'done') {
        upsertTaskByIntent({ ...t, assignee: nextOwner || undefined, updatedAt: new Date().toISOString() });
      }
    });
  }, [liveDoc, pipelineState, complianceDocs, setComplianceDocs, steps, doc.id, tasks, upsertTaskByIntent]);

  const toggleStep = (i: number) => {
    const intent = renewalTaskIntentId(doc.id, i);
    const prior = tasks.find(t => t.id === intent || t.sourceIntentId === intent);
    const completed = prior?.status !== 'done';
    const now = new Date().toISOString();
    const title = steps[i];
    upsertTaskByIntent({
      ...(prior ?? {
        id: intent,
        title: `Renewal: ${title}`,
        description: `${doc.name} — step ${i + 1} of ${steps.length}`,
        sourceType: 'agent',
        sourceAgent: 'Compliance Guardian',
        sourceIntentId: intent,
        relatedEntityType: 'compliance',
        relatedEntityId: doc.id,
        onCompleteAction: { type: 'compliance_review', docId: doc.id },
        recurrence: 'none',
        createdAt: now,
        meta: { link: renewalWorkspacePath(doc.id), renewalStepIndex: i },
      }),
      status: completed ? 'done' : 'open',
      assignee: prior?.assignee ?? (owner || undefined),
      updatedAt: now,
      completedAt: completed ? now : undefined,
    });
    if (completed && pipelineState === 'not_started') {
      setPipelineState('collecting_docs');
    }
    toast.success(completed ? 'Step marked done — synced to Tasks' : 'Step reopened');
  };

  const setStepAssignee = (i: number, assignee: string) => {
    const intent = renewalTaskIntentId(doc.id, i);
    const prior = tasks.find(t => t.id === intent || t.sourceIntentId === intent);
    if (!prior) return;
    upsertTaskByIntent({
      ...prior,
      assignee: assignee || undefined,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRenewalUpload = async (file: File) => {
    if (!newExpiry.trim()) {
      toast.error('Enter the new expiry date for the renewed certificate.');
      return;
    }
    setUploading(true);
    try {
      const presignRes = await apiFetch('/storage/presigned-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: 'compliance',
          filename: file.name,
          content_type: file.type || 'application/pdf',
        }),
      });
      if (!presignRes.ok) throw new Error('presign failed');
      const presign = await presignRes.json();
      const putRes = await fetch(presign.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      });
      if (!putRes.ok) throw new Error('upload failed');

      const metaRes = await apiFetch('/compliance/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${doc.name} (renewed)`,
          doc_type: doc.type,
          status: 'Valid',
          expiry_date: newExpiry,
          s3_key: presign.key,
          details: {
            ...(doc.details ?? {}),
            renewedFromDocId: doc.id,
            renewalState: 'renewed',
          },
        }),
      });
      if (!metaRes.ok) throw new Error(await readApiError(metaRes));

      applyRenewalUploadComplete(
        liveDoc,
        newExpiry,
        { tasks, upsertTaskByIntent, setComplianceDocs, complianceDocs },
      );
      toastComplianceRenewedSuccess(liveDoc.name);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const storedState = getStoredRenewalState(liveDoc);

  return (
    <>
      <motion.div
        className="renewal-workspace-backdrop"
        role="presentation"
        onClick={onClose}
        onKeyDown={e => e.key === 'Escape' && onClose()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />
      <aside
        className="renewal-workspace-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="renewal-workspace-title"
      >
        <button type="button" className="action-btn renewal-workspace-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        <header className="renewal-workspace-header">
          <motion.div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <ClipboardList size={18} color="var(--color-warning)" />
            <h2 id="renewal-workspace-title" style={{ margin: 0, fontSize: '1.05rem' }}>
              Renewal workspace
            </h2>
          </motion.div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.88rem' }}>
            <strong>{liveDoc.name}</strong>
            <span style={{ color: 'var(--color-text-secondary)' }}> · {liveDoc.type}</span>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', fontSize: '0.78rem' }}>
            <span className="renewal-state-pill">{RENEWAL_STATE_LABELS[pipelineState]}</span>
            {daysLeft != null && (
              <span style={{ color: daysLeft <= 14 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                {daysLeft < 0
                  ? `${Math.abs(daysLeft)}d overdue`
                  : daysLeft === 0
                    ? 'Expires today'
                    : `${daysLeft}d remaining`}
              </span>
            )}
            <span style={{ color: 'var(--color-text-tertiary)' }}>· {pct}% complete</span>
          </div>
          <div className="renewal-progress-bar" aria-hidden>
            <div className="renewal-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <label style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'block', marginTop: '0.5rem' }}>
            Pipeline stage
            <select
              className="input"
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              value={storedState ?? pipelineState}
              onChange={e => setPipelineState(e.target.value as RenewalState)}
            >
              {(Object.keys(RENEWAL_STATE_LABELS) as RenewalState[]).map(k => (
                <option key={k} value={k}>{RENEWAL_STATE_LABELS[k]}</option>
              ))}
            </select>
          </label>
        </header>

        <motion.div className="renewal-workspace-body">
          {grantRisks.length > 0 && (
            <div className="renewal-grant-risk">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
                <ShieldAlert size={14} color="#c2410c" />
                Linked grant risk
              </div>
              {grantRisks.map(r => (
                <div key={r.link.id} style={{ marginTop: 4 }}>
                  <strong>{r.grant.company}</strong>
                  {' — '}
                  {r.daysToExpiry < 0 ? 'doc expired' : `${r.daysToExpiry}d to doc expiry`}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginLeft: 8, padding: '0.15rem 0.5rem', fontSize: '0.7rem' }}
                    onClick={() => navigate(`/grants/${r.grant.id}`)}
                  >
                    Open grant
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="renewal-owner-row">
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <User size={14} /> Renewal owner
            </label>
            <select
              className="input"
              value={owner}
              onChange={e => setOwnerAndPersist(e.target.value)}
            >
              {OWNER_OPTIONS.map(o => (
                <option key={o.value || 'none'} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)' }}>
            Checklist · synced to Tasks
          </h3>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {steps.map((step, i) => {
              const intent = renewalTaskIntentId(doc.id, i);
              const t = tasks.find(x => x.id === intent || x.sourceIntentId === intent);
              const isDone = t?.status === 'done';
              return (
                <li key={i} className="renewal-step-row">
                  <button type="button" className="step-toggle" onClick={() => toggleStep(i)} aria-pressed={isDone}>
                    {isDone ? <CheckCircle2 size={18} color="var(--color-success)" /> : <Circle size={18} />}
                  </button>
                  <div className="renewal-step-meta">
                    <span
                      style={{
                        fontSize: '0.85rem',
                        textDecoration: isDone ? 'line-through' : 'none',
                        color: isDone ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                      }}
                    >
                      {step}
                    </span>
                    <select
                      className="input"
                      value={t?.assignee ?? ''}
                      onChange={e => setStepAssignee(i, e.target.value)}
                    >
                      {ASSIGNEE_OPTIONS.map(o => (
                        <option key={o.value || 'u'} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ol>

          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, margin: '1.25rem 0 0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)' }}>
            Upload replacement
          </h3>
          <div className="renewal-upload-zone">
            <Upload size={22} style={{ margin: '0 auto 0.5rem', display: 'block', opacity: 0.6 }} />
            <p style={{ margin: '0 0 0.75rem' }}>
              Upload the renewed certificate. Open renewal tasks auto-close when this succeeds.
            </p>
            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: 6, textAlign: 'left' }}>
              New expiry date
              <input
                type="date"
                className="input"
                style={{ width: '100%', marginTop: 4 }}
                value={newExpiry}
                onChange={e => setNewExpiry(e.target.value)}
              />
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void handleRenewalUpload(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Choose renewed PDF'}
            </button>
          </div>

          {liveDoc.expiry && (
            <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '1rem' }}>
              Current expiry: <strong>{liveDoc.expiry}</strong>
              {liveDoc.registration_number && <> · Reg # {liveDoc.registration_number}</>}
            </p>
          )}
        </motion.div>

        <footer style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close workspace</button>
          {done === total && total > 0 && pipelineState !== 'renewed' && (
            <button type="button" className="btn btn-primary" onClick={() => setPipelineState('submitted')}>
              Mark submitted
            </button>
          )}
        </footer>
      </aside>
    </>
  );
};

export default ComplianceRenewalWorkspace;
