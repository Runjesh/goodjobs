import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Plus, X, ArrowRight, Users, Activity, ClipboardCheck, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import { ModalOverlay } from '../ui/ModalOverlay';
import { programIdFromName } from '../../utils/programFinance';
import { selectProgramsForGrant } from '../../utils/programGrantLink';

interface Props {
  grantId: string;
  /** Lookback window for "this period" calculations (days). */
  periodDays?: number;
}

interface ProgramRollup {
  programId: string;
  programLabel: string;
  beneficiaryCount: number;
  serviceLogCount: number;
  reportReadinessPct: number;
}

/**
 * Grant detail panel — lists every programme this grant funds with live
 * beneficiary count, service-log count for the period, and a simple
 * report-readiness score (% of linked beneficiaries with at least one
 * outcome captured in the period).
 */
const GrantProgramsPanel: React.FC<Props> = ({ grantId, periodDays = 90 }) => {
  const navigate = useNavigate();
  const links          = useStore(s => s.programGrantLinks);
  const beneficiaries  = useStore(s => s.beneficiaries);
  const outcomes       = useStore(s => s.beneficiaryOutcomes);
  const customPrograms = useStore(s => s.customPrograms);
  const addLink    = useStore(s => s.addProgramGrantLink);
  const removeLink = useStore(s => s.removeProgramGrantLink);

  const [showAdd, setShowAdd] = useState(false);
  const [pickProgram, setPickProgram] = useState<string>('');
  const [pickRole, setPickRole] = useState<'primary' | 'co-funder'>('primary');

  // The set of programme names the org knows about — derived from beneficiaries
  // plus any custom programmes added on the Programs page.
  const knownProgramLabels = useMemo(() => {
    const fromBens = beneficiaries.map(b => b.program).filter(Boolean);
    return Array.from(new Set([...fromBens, ...customPrograms]));
  }, [beneficiaries, customPrograms]);

  const myLinks = useMemo(() => selectProgramsForGrant(links, grantId), [links, grantId]);
  const linkedIds = new Set(myLinks.map(l => l.programId));
  const availablePrograms = knownProgramLabels.filter(name => !linkedIds.has(programIdFromName(name)));

  const periodCutoff = Date.now() - periodDays * 86_400_000;

  const rollups: ProgramRollup[] = useMemo(() => {
    return myLinks.map(l => {
      // Resolve a display label: prefer link's known programme name from beneficiaries.
      const labelFromBens = beneficiaries.find(b => programIdFromName(b.program || '') === l.programId)?.program;
      const labelFromCustom = customPrograms.find(c => programIdFromName(c) === l.programId);
      const programLabel = labelFromBens || labelFromCustom || l.programId;

      const programBens = beneficiaries.filter(b => programIdFromName(b.program || '') === l.programId);
      const benIds = new Set(programBens.map(b => b.id));

      const periodOutcomes = outcomes.filter(o => {
        if (o.programId !== l.programId) return false;
        const t = new Date(o.measuredAt).getTime();
        return Number.isFinite(t) && t >= periodCutoff;
      });

      const measuredBenIds = new Set(periodOutcomes.map(o => o.beneficiaryId).filter(id => benIds.has(id)));
      const reportReadinessPct = programBens.length === 0
        ? 0
        : Math.round((measuredBenIds.size / programBens.length) * 100);

      return {
        programId: l.programId,
        programLabel,
        beneficiaryCount: programBens.length,
        serviceLogCount: periodOutcomes.length,
        reportReadinessPct,
      };
    });
  }, [myLinks, beneficiaries, outcomes, customPrograms, periodCutoff]);

  const handleAdd = () => {
    if (!pickProgram) { toast.error('Pick a programme to link.'); return; }
    const pid = programIdFromName(pickProgram);
    addLink({
      id: `pgl-${grantId}-${pid}`,
      programId: pid,
      grantId: String(grantId),
      role: pickRole,
    });
    toast.success(`Linked ${pickProgram}.`);
    setShowAdd(false);
    setPickProgram('');
    setPickRole('primary');
  };

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Target size={16} color="var(--color-primary)" />
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            Funds these programmes
            {myLinks.length > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.78rem', marginLeft: '0.4rem', fontWeight: 500 }}>
                · {myLinks.length}
              </span>
            )}
          </h3>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
          onClick={() => setShowAdd(true)}
        >
          <Plus size={12} /> Add programme
        </button>
      </div>

      {myLinks.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
          No programmes linked yet. Link one to see live beneficiary count, service logs, and report-readiness here.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {rollups.map((r, i) => {
            const link = myLinks[i];
            const ready = r.reportReadinessPct;
            const readyTone = ready >= 75 ? '#16A34A' : ready >= 40 ? '#d97706' : '#DC2626';
            const readyBg   = ready >= 75 ? '#f0fdf4' : ready >= 40 ? '#fffbeb' : '#fef2f2';
            const readyBd   = ready >= 75 ? '#86efac' : ready >= 40 ? '#fde68a' : '#fecaca';
            return (
              <li
                key={link.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.55rem 0.7rem',
                  background: 'var(--color-bg-main)',
                  borderRadius: 'var(--radius-md)',
                  borderLeft: '3px solid var(--color-primary)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {r.programLabel}
                    {link.role && (
                      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        · {link.role}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Users size={11} /> {r.beneficiaryCount} active
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Activity size={11} /> {r.serviceLogCount} service log{r.serviceLogCount === 1 ? '' : 's'} (last {periodDays}d)
                    </span>
                  </div>
                </div>
                <span
                  title={`${ready}% of linked beneficiaries have a recorded outcome this period`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: '0.65rem', fontWeight: 700,
                    padding: '2px 7px', borderRadius: '99px',
                    background: readyBg, color: readyTone, border: `1px solid ${readyBd}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <ClipboardCheck size={11} /> {ready}% report-ready
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                  onClick={() => navigate(`/programs?focus=${encodeURIComponent(r.programId)}`)}
                >
                  Open <ArrowRight size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => { removeLink(link.id); toast.success('Link removed.'); }}
                  title="Unlink programme"
                  aria-label="Unlink programme"
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
            aria-labelledby="gp-add-title"
            style={{ maxWidth: '440px' }}
          >
            <button type="button" onClick={() => setShowAdd(false)} aria-label="Close" className="action-btn" style={{ position: 'absolute', right: '1rem', top: '1rem' }}>
              <X size={20} />
            </button>
            <div className="flex items-center gap-2 mb-4" style={{ paddingRight: '2.5rem' }}>
              <Target size={20} color="var(--color-primary)" />
              <h2 id="gp-add-title" style={{ margin: 0, fontSize: '1.125rem' }}>Link a programme</h2>
            </div>
            {availablePrograms.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                No unlinked programmes are available. Add a programme on the Programs page first.
              </p>
            ) : (
              <div className="flex-col gap-4 flex">
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Programme *</label>
                  <select className="input-field" value={pickProgram} onChange={e => setPickProgram(e.target.value)}>
                    <option value="">Pick a programme…</option>
                    {availablePrograms.map(name => (
                      <option key={name} value={name}>{name}</option>
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
                  <Plus size={14} /> Link programme
                </button>
              </div>
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default GrantProgramsPanel;
