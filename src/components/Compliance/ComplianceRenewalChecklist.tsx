import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, ClipboardList } from 'lucide-react';
import { ModalOverlay } from '../ui/ModalOverlay';

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

interface Props {
  docName: string;
  docType?: string;
  daysUntilExpiry?: number;
  onClose: () => void;
}

const ComplianceRenewalChecklist: React.FC<Props> = ({ docName, docType, daysUntilExpiry, onClose }) => {
  const steps = stepsForDoc(docName, docType);
  const [done, setDone] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setDone(prev => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
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
        <motion.div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <ClipboardList size={18} color="var(--color-warning)" />
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Renewal workflow</h2>
        </motion.div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: '0 0 1rem' }}>
          <strong>{docName}</strong>
          {typeof daysUntilExpiry === 'number' && (
            <> · expires in <strong>{daysUntilExpiry}</strong> day{daysUntilExpiry === 1 ? '' : 's'}</>
          )}
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
        <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {done.size === steps.length ? 'Done — upload renewed doc' : 'Save progress'}
          </button>
        </div>
      </motion.div>
    </ModalOverlay>
  );
};

export default ComplianceRenewalChecklist;
