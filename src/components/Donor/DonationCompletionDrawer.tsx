import React, { useState } from 'react';
import {
  X, CheckCircle2, AlertCircle, Download, MessageCircle, Mail, Heart, ListTodo,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { DonationCompletionSnapshot } from '../../utils/donationCompletion';
import {
  donationCompletionHeadline,
  generateDonationReceiptPdf,
  sendDonationReceiptChannel,
} from '../../utils/donationCompletion';
import RecordTasksPanel from '../Common/RecordTasksPanel';
import '../../components/Programs/EnrollCompletionDrawer.css';

export interface DonationCompletionActions {
  onClose: () => void;
  onSnapshotChange: (snap: DonationCompletionSnapshot) => void;
  onMarkThanked: () => void;
}

interface Props {
  snapshot: DonationCompletionSnapshot;
  donorPan: string;
  ngoName: string;
  ngoPan: string;
  eightyGRegNo: string;
  variant?: 'drawer' | 'inline';
  onActions: DonationCompletionActions;
}

const DonationCompletionDrawer: React.FC<Props> = ({
  snapshot: s,
  donorPan,
  ngoName,
  ngoPan,
  eightyGRegNo,
  variant = 'drawer',
  onActions,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const headline = donationCompletionHeadline(s);

  const handleGenerate80G = async () => {
    setBusy('receipt');
    try {
      const receiptNo = await generateDonationReceiptPdf({
        snapshot: s,
        donorPan,
        ngoName,
        ngoPan,
        eightyGRegNo,
      });
      onActions.onSnapshotChange({
        ...s,
        receiptGenerated: true,
        receiptNumber: receiptNo,
      });
      toast.success('Receipt generated. Donor stewardship started.');
    } catch {
      toast.error('Could not generate receipt.');
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async (channel: 'whatsapp' | 'email') => {
    setBusy(channel);
    const ok = await sendDonationReceiptChannel(s, channel, s.receiptNumber);
    setBusy(null);
    if (ok) toast.success(channel === 'whatsapp' ? 'Receipt queued on WhatsApp.' : 'Receipt email queued.');
    else toast.error(`Could not queue ${channel} message.`);
  };

  const handleThanked = () => {
    onActions.onMarkThanked();
    onActions.onSnapshotChange({ ...s, thanked: true });
    toast.success('Marked as thanked.');
  };

  const inner = (
    <>
      <header className="enroll-completion-header">
        <h2 id="donation-complete-title">
          <CheckCircle2 size={20} color="var(--color-success)" style={{ verticalAlign: 'middle', marginRight: 6 }} />
          ₹{s.amount.toLocaleString('en-IN')} from {s.donorName}
        </h2>
        <p className="enroll-completion-sub">{headline}</p>
      </header>

      <div className="enroll-completion-body">
        <div className="enroll-completion-status-grid">
          <StatusRow
            label="Donor"
            ok={s.donorMatched || s.donorCreated}
            okText={s.donorCreated ? 'New donor created' : 'Matched in CRM'}
            missText="Link donor record"
          />
          <StatusRow
            label="Transaction"
            ok={!!s.transactionId}
            okText={`${s.method} · ${s.campaignTitle}`}
            missText="Not recorded"
          />
          <StatusRow
            label="80G receipt"
            ok={s.receiptGenerated}
            warn={s.is80GEligible && !s.receiptGenerated}
            okText={s.receiptNumber ? s.receiptNumber : 'Issued'}
            missText={s.is80GEligible ? 'Pending — generate below' : 'Not applicable (anonymous)'}
          />
          <StatusRow
            label="Stewardship"
            ok={s.thanked}
            warn={!s.thanked}
            okText="Thanked"
            missText="Thank-you due in 7 days"
          />
        </div>

        <section className="enroll-completion-actions">
          <h3>Next best actions</h3>
          <div className="enroll-completion-actions-grid">
            {s.is80GEligible && !s.receiptGenerated && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy === 'receipt'}
                onClick={() => void handleGenerate80G()}
              >
                <Download size={16} /> {busy === 'receipt' ? 'Generating…' : 'Generate 80G'}
              </button>
            )}
            {s.receiptGenerated && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={() => void handleSend('whatsapp')}
                >
                  <MessageCircle size={16} /> Send via WhatsApp
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!!busy}
                  onClick={() => void handleSend('email')}
                >
                  <Mail size={16} /> Send via email
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleThanked}
              disabled={s.thanked}
            >
              <Heart size={16} /> {s.thanked ? 'Thanked' : 'Mark thanked'}
            </button>
          </div>
        </section>

        <section>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
            <ListTodo size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Stewardship tasks
          </h3>
          <RecordTasksPanel
            entityType="donor"
            entityId={s.donorId}
            entityLabel={s.donorName}
            compact
          />
        </section>

        <button type="button" className="btn btn-ghost" style={{ width: '100%' }} onClick={onActions.onClose}>
          Done for now
        </button>
      </div>
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="donation-completion-inline card" role="region" aria-labelledby="donation-complete-title" style={{ padding: '1.25rem', marginTop: '1rem' }}>
        {inner}
      </div>
    );
  }

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
        aria-labelledby="donation-complete-title"
      >
        <button
          type="button"
          className="action-btn enroll-completion-close"
          onClick={onActions.onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>
        {inner}
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

export default DonationCompletionDrawer;
