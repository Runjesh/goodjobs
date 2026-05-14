import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Plus, X, ArrowRight, AlertTriangle, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import { ModalOverlay } from '../ui/ModalOverlay';
import { programIdFromName } from '../../utils/programFinance';
import {
  selectGrantsForProgram,
  grantHealthForProgram,
  type GrantHealthStatus,
} from '../../utils/programGrantLink';

interface Props {
  programName: string;
}

const STATUS_META: Record<GrantHealthStatus, { label: string; color: string; bg: string; border: string; Icon: React.ComponentType<{ size?: number }> }> = {
  healthy:  { label: 'Healthy',  color: '#16A34A', bg: '#f0fdf4', border: '#86efac', Icon: CheckCircle2 },
  at_risk:  { label: 'At risk',  color: '#d97706', bg: '#fffbeb', border: '#fde68a', Icon: AlertTriangle },
  overdue:  { label: 'Overdue',  color: '#DC2626', bg: '#fef2f2', border: '#fecaca', Icon: AlertCircle },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const ProgramGrantsPanel: React.FC<Props> = ({ programName }) => {
  const navigate = useNavigate();
  const programId = programIdFromName(programName);

  const links     = useStore(s => s.programGrantLinks);
  const grants    = useStore(s => s.csrCards);
  const budgets   = useStore(s => s.programBudgets);
  const tranches  = useStore(s => s.grantTranches);
  const compLinks = useStore(s => s.complianceGrantLinks);
  const docs      = useStore(s => s.complianceDocs);
  const addLink    = useStore(s => s.addProgramGrantLink);
  const removeLink = useStore(s => s.removeProgramGrantLink);

  const [showAdd, setShowAdd] = useState(false);
  const [pickGrantId, setPickGrantId] = useState<string>('');
  const [pickRole, setPickRole] = useState<'primary' | 'co-funder'>('primary');

  const myLinks = useMemo(() => selectGrantsForProgram(links, programId), [links, programId]);
  const linkedGrantIds = new Set(myLinks.map(l => String(l.grantId)));
  const availableGrants = grants.filter(g => !linkedGrantIds.has(String(g.id)));

  const handleAdd = () => {
    if (!pickGrantId) { toast.error('Pick a grant to link.'); return; }
    addLink({
      id: `pgl-${pickGrantId}-${programId}`,
      programId,
      grantId: String(pickGrantId),
      role: pickRole,
    });
    toast.success('Grant linked to programme.');
    setShowAdd(false);
    setPickGrantId('');
    setPickRole('primary');
  };

  return (
    <div
      style={{
        marginTop: '0.4rem',
        padding: '0.6rem 0.75rem',
        background: 'var(--color-bg-main)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-light)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: myLinks.length ? '0.5rem' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <Wallet size={13} /> Funded by
          {myLinks.length > 0 && (
            <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
              · {myLinks.length} grant{myLinks.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="btn btn-secondary"
          style={{ padding: '0.2rem 0.55rem', fontSize: '0.7rem' }}
          title="Link an existing grant to this programme"
        >
          <Plus size={11} /> Link grant
        </button>
      </div>

      {myLinks.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
          No grants linked yet. Link one to see live utilisation, next report due, and at-risk status here.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {myLinks.map(l => {
            const grant = grants.find(g => String(g.id) === String(l.grantId));
            if (!grant) {
              return (
                <li key={l.id} style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                  Linked grant {l.grantId} not found.
                  <button onClick={() => removeLink(l.id)} className="btn btn-secondary" style={{ marginLeft: '0.5rem', padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}>Remove</button>
                </li>
              );
            }
            const health = grantHealthForProgram(programId, String(l.grantId), {
              budgets, tranches, complianceLinks: compLinks, docs,
            });
            const meta = STATUS_META[health.status];
            const Icon = meta.Icon;
            return (
              <li
                key={l.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                  padding: '0.5rem 0.6rem',
                  background: 'var(--color-bg-card)',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: `3px solid ${meta.color}`,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {grant.company} — {grant.project}
                    {l.role && (
                      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        · {l.role}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                    {health.utilisationPct}% utilised · next report {fmtDate(health.nextReportDue)}
                  </div>
                </div>
                <span
                  title={`Status: ${meta.label}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: '0.65rem', fontWeight: 700,
                    padding: '2px 7px', borderRadius: '99px',
                    background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Icon size={11} /> {meta.label}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                  onClick={() => navigate(`/grants/${grant.id}`)}
                >
                  Open <ArrowRight size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => { removeLink(l.id); toast.success('Link removed.'); }}
                  title="Unlink grant"
                  aria-label="Unlink grant"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--color-text-tertiary)' }}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showAdd && (
        <ModalOverlay onBackdropClick={() => setShowAdd(false)}>
          <div
            className="modal-card"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pg-add-title"
            style={{ maxWidth: '440px' }}
          >
            <button type="button" onClick={() => setShowAdd(false)} aria-label="Close" className="action-btn" style={{ position: 'absolute', right: '1rem', top: '1rem' }}>
              <X size={20} />
            </button>
            <div className="flex items-center gap-2 mb-4" style={{ paddingRight: '2.5rem' }}>
              <Wallet size={20} color="#0F766E" />
              <h2 id="pg-add-title" style={{ margin: 0, fontSize: '1.125rem' }}>Link grant to {programName}</h2>
            </div>
            {availableGrants.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                Every existing grant is already linked to this programme. Add a grant in the CSR pipeline first.
              </p>
            ) : (
              <div className="flex-col gap-4 flex">
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Grant *</label>
                  <select className="input-field" value={pickGrantId} onChange={e => setPickGrantId(e.target.value)}>
                    <option value="">Pick a grant…</option>
                    {availableGrants.map(g => (
                      <option key={g.id} value={g.id}>{g.company} — {g.project}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Role</label>
                  <select className="input-field" value={pickRole} onChange={e => setPickRole(e.target.value as 'primary' | 'co-funder')}>
                    <option value="primary">Primary funder</option>
                    <option value="co-funder">Co-funder</option>
                  </select>
                </div>
                <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={handleAdd}>
                  <Plus size={14} /> Link grant
                </button>
              </div>
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default ProgramGrantsPanel;
