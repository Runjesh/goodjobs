import React, { useMemo, useState } from 'react';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { programIdFromName } from '../../utils/programFinance';
import { selectAssignmentsForVolunteer } from '../../utils/volunteerProgram';
import toast from 'react-hot-toast';

interface Props {
  volunteerId: string;
  volunteerName: string;
}

/**
 * Lists every programme this volunteer is assigned to, with cumulative hours,
 * and lets a coordinator add a new assignment or log additional hours.
 * The Programs page consumes the same `volunteerAssignments` slice so the
 * effort number on a programme card always matches what's recorded here.
 */
const VolunteerProgramAssignments: React.FC<Props> = ({ volunteerId, volunteerName }) => {
  const assignments = useStore(s => s.volunteerAssignments);
  const upsertVolunteerAssignment = useStore(s => s.upsertVolunteerAssignment);
  const removeVolunteerAssignment = useStore(s => s.removeVolunteerAssignment);
  const programBudgets = useStore(s => s.programBudgets);
  const beneficiaries  = useStore(s => s.beneficiaries);

  const myAssignments = useMemo(
    () => selectAssignmentsForVolunteer(assignments, volunteerId),
    [assignments, volunteerId],
  );

  // Programme list = budgets + distinct programmes from beneficiaries.
  const programOptions = useMemo(() => {
    const set = new Map<string, string>();
    programBudgets.forEach(b => set.set(b.programId, b.label));
    beneficiaries.forEach(b => {
      if (b.program) set.set(programIdFromName(b.program), b.program);
    });
    return Array.from(set.entries()).map(([id, label]) => ({ id, label }));
  }, [programBudgets, beneficiaries]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    programLabel: programOptions[0]?.label ?? '',
    hours: '4',
    role: '',
    lastVisit: new Date().toISOString().slice(0, 10),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const label = draft.programLabel.trim();
    if (!label) { toast.error('Pick a programme.'); return; }
    const hours = Number(draft.hours);
    if (!Number.isFinite(hours) || hours <= 0) { toast.error('Hours must be positive.'); return; }

    const programId = programIdFromName(label);
    const existing = myAssignments.find(a => a.programId === programId);
    if (existing) {
      upsertVolunteerAssignment({
        ...existing,
        hours: existing.hours + hours,
        lastVisit: draft.lastVisit || existing.lastVisit,
        role: draft.role.trim() || existing.role,
      });
      toast.success(`Logged ${hours}h to ${label}.`);
    } else {
      upsertVolunteerAssignment({
        id: `va-${Date.now()}`,
        volunteerId,
        programId,
        programLabel: label,
        hours,
        lastVisit: draft.lastVisit || undefined,
        role: draft.role.trim() || undefined,
        createdAt: new Date().toISOString(),
      });
      toast.success(`${volunteerName} assigned to ${label}.`);
    }
    setAdding(false);
    setDraft({ programLabel: programOptions[0]?.label ?? '', hours: '4', role: '', lastVisit: new Date().toISOString().slice(0, 10) });
  }

  return (
    <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>
          <Briefcase size={14} color="var(--color-primary)" /> Programme assignments
        </div>
        {!adding && (
          <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }} onClick={() => setAdding(true)}>
            <Plus size={12} /> Assign / log hours
          </button>
        )}
      </div>

      {myAssignments.length === 0 && !adding && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', margin: 0 }}>
          No programme assignments yet. Logging hours here will roll up into the programme's effort total.
        </p>
      )}

      {myAssignments.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {myAssignments.map(a => (
            <li key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.5rem 0.65rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{a.programLabel}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                  {a.role || 'Volunteer'} · last visit {a.lastVisit ?? '—'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge badge-outline" style={{ fontVariantNumeric: 'tabular-nums' }}>{a.hours}h</span>
                <button
                  type="button"
                  aria-label="Remove assignment"
                  onClick={() => { removeVolunteerAssignment(a.id); toast.success('Assignment removed.'); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form onSubmit={submit} style={{ marginTop: '0.6rem', display: 'grid', gap: '0.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
            <input
              type="text"
              list={`prog-opts-${volunteerId}`}
              className="input-field"
              placeholder="Programme"
              value={draft.programLabel}
              onChange={e => setDraft({ ...draft, programLabel: e.target.value })}
            />
            <datalist id={`prog-opts-${volunteerId}`}>
              {programOptions.map(o => <option key={o.id} value={o.label} />)}
            </datalist>
            <input
              type="number"
              min={0.5}
              step={0.5}
              className="input-field"
              placeholder="Hours"
              value={draft.hours}
              onChange={e => setDraft({ ...draft, hours: e.target.value })}
            />
            <input
              type="date"
              className="input-field"
              value={draft.lastVisit}
              onChange={e => setDraft({ ...draft, lastVisit: e.target.value })}
            />
          </div>
          <input
            type="text"
            className="input-field"
            placeholder="Role on programme (optional)"
            value={draft.role}
            onChange={e => setDraft({ ...draft, role: e.target.value })}
          />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 0.8rem' }}>Save</button>
          </div>
        </form>
      )}
    </div>
  );
};

export default VolunteerProgramAssignments;
