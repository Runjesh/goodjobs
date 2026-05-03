import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Plus, Trash2, AlertTriangle, ArrowRight, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import { ModalOverlay } from '../ui/ModalOverlay';
import {
  selectGrantUtilisation,
  budgetSanity,
  type GrantBudgetHead,
} from '../../utils/grantBudgetHeads';

interface Props {
  grantId: string;
  /** Total grant amount, used for the allocation-vs-grant sanity line. */
  grantTotal: number;
}

const fmtINR = (v: number) => {
  if (!Number.isFinite(v)) return '₹0';
  if (Math.abs(v) >= 1e7) return `${v < 0 ? '-' : ''}₹${Math.abs(v / 1e7).toFixed(2)}Cr`;
  if (Math.abs(v) >= 1e5) return `${v < 0 ? '-' : ''}₹${Math.abs(v / 1e5).toFixed(1)}L`;
  if (Math.abs(v) >= 1e3) return `${v < 0 ? '-' : ''}₹${Math.round(Math.abs(v) / 1e3)}k`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

const GrantBudgetHeadsPanel: React.FC<Props> = ({ grantId, grantTotal }) => {
  const navigate = useNavigate();
  const heads        = useStore(s => s.grantBudgetHeads);
  const transactions = useStore(s => s.transactions);
  const tagsById     = useStore(s => s.transactionGrantTags);
  const upsert       = useStore(s => s.upsertGrantBudgetHead);
  const removeHead   = useStore(s => s.removeGrantBudgetHead);

  const myHeads = useMemo(
    () => heads.filter(h => String(h.grantId) === String(grantId))
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [heads, grantId],
  );

  const utilisation = useMemo(
    () => selectGrantUtilisation(grantId, heads, transactions, tagsById),
    [grantId, heads, transactions, tagsById],
  );

  const sanity = useMemo(() => budgetSanity(grantTotal, myHeads), [grantTotal, myHeads]);

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; allocatedAmount: number; notes: string }>({
    label: '', allocatedAmount: 0, notes: '',
  });

  const openAdd = () => {
    setEditingId(null);
    setDraft({ label: '', allocatedAmount: 0, notes: '' });
    setShowAdd(true);
  };

  const openEdit = (h: GrantBudgetHead) => {
    setEditingId(h.id);
    setDraft({ label: h.label, allocatedAmount: h.allocatedAmount, notes: h.notes ?? '' });
    setShowAdd(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const label = draft.label.trim();
    if (!label) { toast.error('Give the head a label.'); return; }
    if (!Number.isFinite(draft.allocatedAmount) || draft.allocatedAmount < 0) {
      toast.error('Allocation must be ≥ 0.');
      return;
    }
    const id = editingId || `gbh-${grantId}-${Date.now()}`;
    upsert({
      id,
      grantId: String(grantId),
      label,
      allocatedAmount: Number(draft.allocatedAmount),
      notes: draft.notes.trim() || undefined,
      sortOrder: editingId
        ? myHeads.find(h => h.id === editingId)?.sortOrder
        : (myHeads[myHeads.length - 1]?.sortOrder ?? 0) + 1,
    });
    toast.success(editingId ? 'Head updated.' : 'Head added.');
    setShowAdd(false);
  };

  const onDelete = (h: GrantBudgetHead) => {
    if (!confirm(`Delete budget head "${h.label}"? Existing tags become orphan spend until re-tagged.`)) return;
    removeHead(h.id);
    toast.success('Head removed.');
  };

  const sanityTone =
    sanity.status === 'over' ? '#DC2626'
    : sanity.status === 'under' ? '#D97706'
    : sanity.status === 'fully_allocated' ? '#16A34A'
    : 'var(--color-text-tertiary)';

  return (
    <div
      style={{
        padding: '1rem 1.1rem',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border-light)',
        marginBottom: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wallet size={16} color="var(--color-primary)" />
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            Budget heads
            {myHeads.length > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.78rem', marginLeft: '0.4rem', fontWeight: 500 }}>
                · {myHeads.length}
              </span>
            )}
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
            onClick={() => navigate('/finance')}
            title="Tag transactions to grant heads in Finance"
          >
            Tag in Finance <ArrowRight size={12} />
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
            onClick={openAdd}
          >
            <Plus size={12} /> Add head
          </button>
        </div>
      </div>

      {/* Sanity line */}
      <div style={{
        fontSize: '0.78rem', color: sanityTone,
        marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {sanity.status === 'over' && <AlertTriangle size={12} />}
        {sanity.status === 'no_grant_total'
          ? 'No grant total set — utilisation % will use head totals only.'
          : sanity.status === 'over'
            ? `${fmtINR(sanity.totalAllocated)} allocated of ${fmtINR(sanity.grantTotal)} grant — over by ${fmtINR(sanity.overAllocated)}.`
          : sanity.status === 'fully_allocated'
            ? `${fmtINR(sanity.totalAllocated)} fully allocated of ${fmtINR(sanity.grantTotal)} grant.`
          : `${fmtINR(sanity.totalAllocated)} allocated of ${fmtINR(sanity.grantTotal)} grant — ${fmtINR(sanity.unallocated)} unallocated.`
        }
      </div>

      {myHeads.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
          No heads yet. Add the categories the funder approved (e.g. Programme delivery, M&E, Admin) so Finance expenses can be tagged.
        </div>
      ) : (
        <>
          {/* Totals row */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center',
            padding: '0.5rem 0.7rem', marginBottom: '0.5rem',
            background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)',
            fontSize: '0.78rem',
          }}>
            <span><strong>Allocated</strong> {fmtINR(utilisation.totalAllocated)}</span>
            <span><strong>Spent</strong> {fmtINR(utilisation.totalSpent)}</span>
            <span><strong>Remaining</strong> {fmtINR(utilisation.totalRemaining)}</span>
            <span><strong>Util</strong> {utilisation.utilisationPct}%</span>
            {utilisation.orphanSpent > 0 && (
              <span style={{ color: '#D97706', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={12} /> Orphan {fmtINR(utilisation.orphanSpent)} (head removed)
              </span>
            )}
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {utilisation.rows.map(r => {
              const head = myHeads.find(h => h.id === r.headId)!;
              const tone = r.utilisationPct >= 100 ? '#DC2626' : r.utilisationPct >= 80 ? '#D97706' : 'var(--color-primary)';
              return (
                <li key={r.headId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.55rem 0.7rem',
                    background: 'var(--color-bg-main)',
                    borderRadius: 'var(--radius-md)',
                    borderLeft: `3px solid ${tone}`,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.label}</div>
                    {head.notes && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{head.notes}</div>
                    )}
                    <div style={{
                      marginTop: 4, height: 6, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${Math.min(100, r.utilisationPct)}%`, height: '100%', background: tone,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                    <div style={{ fontWeight: 600 }}>{fmtINR(r.spent)} / {fmtINR(r.allocated)}</div>
                    <div style={{ fontSize: '0.7rem', color: tone, fontWeight: 600 }}>
                      {r.utilisationPct}% · {fmtINR(r.remaining)} left
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                    onClick={() => openEdit(head)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(head)}
                    title="Remove head"
                    aria-label={`Remove ${head.label}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--color-text-tertiary)' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {showAdd && (
        <ModalOverlay onBackdropClick={() => setShowAdd(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="gbh-form-title" style={{ maxWidth: 460 }}>
            <button type="button" onClick={() => setShowAdd(false)} aria-label="Close" className="action-btn" style={{ position: 'absolute', right: '1rem', top: '1rem' }}>
              <X size={20} />
            </button>
            <div className="flex items-center gap-2 mb-4" style={{ paddingRight: '2.5rem' }}>
              <Wallet size={20} color="var(--color-primary)" />
              <h2 id="gbh-form-title" style={{ margin: 0, fontSize: '1.125rem' }}>{editingId ? 'Edit budget head' : 'New budget head'}</h2>
            </div>
            <form onSubmit={submit} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Label *</label>
                <input
                  className="input-field"
                  required
                  placeholder="e.g. Programme delivery"
                  value={draft.label}
                  onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Allocated amount (₹)</label>
                <input
                  className="input-field"
                  type="number"
                  min={0}
                  value={draft.allocatedAmount}
                  onChange={e => setDraft(d => ({ ...d, allocatedAmount: Number(e.target.value) }))}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Notes (optional)</label>
                <input
                  className="input-field"
                  placeholder="e.g. Travel + per-diem only"
                  value={draft.notes}
                  onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                {editingId ? 'Save changes' : 'Add head'}
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default GrantBudgetHeadsPanel;
