import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, ClipboardList } from 'lucide-react';
import { ModalOverlay } from '../ui/ModalOverlay';
import { useStore } from '../../store/useStore';
import type { Task } from '../../utils/tasks';
import toast from 'react-hot-toast';

const RENEWAL_STEPS: Record<string, string[]> = {
  fcra: [
    'Gather last 12 months FCRA bank statements',
    'Reconcile FC-4 annual return with audited accounts',
    'Obtain CA certificate and board resolution',
    'Submit renewal on fcraonline.nic.in before expiry',
  ],
  '80g': [
    'Download current 80G registration certificate',
    'Prepare list of donations received (FY)',
    'CA verification of Form 10BD / 10BE filings',
    'File renewal application with IT department',
  ],
  default: [
    'Download the expiring certificate from Compliance vault',
    'Assign owner and set internal deadline (30 days before expiry)',
    'Collect supporting documents from Finance & Programs',
    'Submit renewal to the issuing authority',
    'Upload renewed certificate and update expiry date',
  ],
};

function stepsForDoc(docName: string, docType?: string): string[] {
  const key = `${docType || ''} ${docName}`.toLowerCase();
  if (key.includes('fcra')) return RENEWAL_STEPS.fcra;
  if (key.includes('80g') || key.includes('donor deduction')) return RENEWAL_STEPS['80g'];
  return RENEWAL_STEPS.default;
}

function taskIdForStep(docId: string, stepIndex: number): string {
  return `compliance-renewal:${docId}:step:${stepIndex}`;
}

interface Props {
  docId: string;
  docName: string;
  docType?: string;
  daysUntilExpiry?: number;
  onClose: () => void;
}

const ComplianceRenewalChecklist: React.FC<Props> = ({ docId, docName, docType, daysUntilExpiry, onClose }) => {
  const steps = stepsForDoc(docName, docType);
  const tasks = useStore(s => s.tasks);
  const upsertTaskByIntent = useStore(s => s.upsertTaskByIntent);

  const [done, setDone] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    steps.forEach((_, i) => {
      const tid = taskIdForStep(docId, i);
      const t = tasks.find(x => x.id === tid || x.sourceIntentId === tid);
      if (t?.status === 'done') initial.add(i);
    });
    return initial;
  });

  const syncTask = useCallback((stepIndex: number, completed: boolean) => {
    const title = steps[stepIndex];
    const id = taskIdForStep(docId, stepIndex);
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title: `Renewal: ${title}`,
      description: `${docName} — step ${stepIndex + 1} of ${steps.length}`,
      priority: daysUntilExpiry != null && daysUntilExpiry <= 30 ? 'urgent' : 'high',
      status: completed ? 'done' : 'open',
      sourceType: 'agent',
      sourceAgent: 'Compliance Guardian',
      sourceIntentId: id,
      relatedEntityType: 'compliance',
      relatedEntityId: docId,
      onCompleteAction: { type: 'compliance_review', docId },
      recurrence: 'none',
      createdAt: now,
      updatedAt: now,
      completedAt: completed ? now : undefined,
      meta: { link: `/compliance?alert=true&doc=${encodeURIComponent(docName)}` },
    };
    upsertTaskByIntent(task);
  }, [docId, docName, daysUntilExpiry, steps, upsertTaskByIntent]);

  useEffect(() => {
    steps.forEach((_, i) => {
      if (!tasks.some(t => t.id === taskIdForStep(docId, i))) {
        syncTask(i, done.has(i));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const toggle = (i: number) => {
    setDone(prev => {
      const n = new Set(prev);
      const nextDone = !n.has(i);
      if (nextDone) n.add(i);
      else n.delete(i);
      syncTask(i, nextDone);
      return n;
    });
  };

  const handleSave = () => {
    toast.success(
      done.size === steps.length
        ? 'Renewal checklist complete — upload the renewed certificate.'
        : `Saved — ${done.size}/${steps.length} steps tracked in Tasks.`,
    );
    onClose();
  };

  return (
    <ModalOverlay onClose={onClose}>
      <motion.div
        className="card"
        style={{ maxWidth: 480, width: '100%', padding: '1.25rem' }}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <ClipboardList size={18} color="var(--color-warning)" />
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Renewal workflow</h2>
        </motion.div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: '0 0 1rem' }}>
          <strong>{docName}</strong>
          {typeof daysUntilExpiry === 'number' && (
            <> · expires in <strong>{daysUntilExpiry}</strong> day{daysUntilExpiry === 1 ? '' : 's'}</>
          )}
          <span style={{ display: 'block', fontSize: '0.75rem', marginTop: 4, color: 'var(--color-text-tertiary)' }}>
            Progress syncs to Tasks → Compliance
          </span>
        </p>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {steps.map((step, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.5rem', width: '100%',
                  textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.85rem', color: done.has(i) ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                  textDecoration: done.has(i) ? 'line-through' : 'none',
                }}
              >
                {done.has(i) ? <CheckCircle2 size={16} color="var(--color-success)" /> : <Circle size={16} />}
                <span>{step}</span>
              </button>
            </li>
          ))}
        </ol>
        <motion.div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }} initial={false}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            {done.size === steps.length ? 'Done — upload renewed doc' : 'Save progress'}
          </button>
        </motion.div>
      </motion.div>
    </ModalOverlay>
  );
};

export default ComplianceRenewalChecklist;
