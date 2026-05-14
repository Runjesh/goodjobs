import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardCheck, Check, Pencil, X } from 'lucide-react';
import { useStore, type MisReviewIntent } from '../../store/useStore';
import './MisReviewQueue.css';

const MisReviewRow: React.FC<{ intent: MisReviewIntent }> = ({ intent }) => {
  const decide = useStore(s => s.decideMisReviewIntent);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(intent.extracted);

  const approve  = () => { decide(intent.id, 'approved'); toast.success('Approved — counted in dashboard.'); };
  const dismiss  = () => { decide(intent.id, 'dismissed'); toast('Dismissed.', { icon: '✕' }); };
  const saveEdit = () => { decide(intent.id, 'edited', draft); setEditing(false); toast.success('Edited & approved.'); };

  return (
    <div className="mis-review-row" data-status={intent.status}>
      <div className="mis-review-row-head">
        <span className="mis-review-row-tag"><ClipboardCheck size={11} /> Field report</span>
        <span className="mis-review-row-time">{new Date(intent.createdAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
      </div>
      <p className="mis-review-row-narrative">"{intent.narrative}"</p>

      {!editing ? (
        <div className="mis-review-row-grid">
          {intent.extracted.beneficiary && <div><span>Beneficiary</span><strong>{intent.extracted.beneficiary}</strong></div>}
          {intent.extracted.location    && <div><span>Location</span><strong>{intent.extracted.location}</strong></div>}
          {intent.extracted.metric      && <div><span>Metric</span><strong>{intent.extracted.metric}</strong></div>}
          {intent.extracted.value       && <div><span>Value</span><strong>{intent.extracted.value}</strong></div>}
          {intent.extracted.program     && <div><span>Program</span><strong>{intent.extracted.program}</strong></div>}
        </div>
      ) : (
        <div className="mis-review-row-grid">
          {(['beneficiary','location','metric','value','program'] as const).map(k => (
            <div key={k}>
              <span>{k}</span>
              <input
                className="input-field"
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                value={draft[k] ?? ''}
                onChange={e => setDraft({ ...draft, [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      <div className="mis-review-row-actions">
        {!editing ? (
          <>
            <button type="button" className="intent-btn intent-btn--approve" onClick={approve}><Check size={14} /> Approve</button>
            <button type="button" className="intent-btn intent-btn--modify" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>
            <button type="button" className="intent-btn intent-btn--reject" onClick={dismiss}><X size={14} /> Dismiss</button>
          </>
        ) : (
          <>
            <button type="button" className="intent-btn intent-btn--approve" onClick={saveEdit}><Check size={14} /> Save & approve</button>
            <button type="button" className="intent-btn intent-btn--reject" onClick={() => { setDraft(intent.extracted); setEditing(false); }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
};

const MisReviewQueue: React.FC = () => {
  const misReviewIntents = useStore(s => s.misReviewIntents);
  const pending = useMemo(() => misReviewIntents.filter(i => i.status === 'pending'), [misReviewIntents]);
  if (pending.length === 0) return null;

  return (
    <div className="mis-review-queue">
      <div className="mis-review-queue-header">
        <ClipboardCheck size={15} />
        <h3>Field reports awaiting review</h3>
        <span className="mis-review-queue-count">{pending.length}</span>
      </div>
      <p className="mis-review-queue-help">
        Field officers submitted these via Conversational MIS. They don't count in dashboards until you approve.
      </p>
      <div className="mis-review-queue-list">
        {pending.map(i => <MisReviewRow key={i.id} intent={i} />)}
      </div>
    </div>
  );
};

export default MisReviewQueue;
