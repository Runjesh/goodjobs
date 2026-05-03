import React, { useMemo } from 'react';
import { Users } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { programIdFromName } from '../../utils/programFinance';

interface Props {
  programName: string;
  /** Compact mode renders a single inline pill (for table rows). */
  compact?: boolean;
}

/**
 * Inline rollup of volunteer effort on a single programme — pulls from
 * `volunteerAssignments` so an NGO can answer "who actually delivered this?".
 */
const ProgramEffortSummary: React.FC<Props> = ({ programName, compact = false }) => {
  const assignments = useStore(s => s.volunteerAssignments);
  const volunteers  = useStore(s => s.volunteers);

  const data = useMemo(() => {
    const pid = programIdFromName(programName);
    const mine = assignments.filter(a => a.programId === pid);
    const totalHours = mine.reduce((s, a) => s + a.hours, 0);
    const volIds = Array.from(new Set(mine.map(a => a.volunteerId)));
    const lastVisit = mine.reduce<string | null>((acc, a) => {
      if (a.lastVisit && (!acc || a.lastVisit > acc)) return a.lastVisit;
      return acc;
    }, null);
    const namedVols = volIds
      .map(id => volunteers.find(v => v.id === id)?.name)
      .filter(Boolean) as string[];
    return { totalHours, volunteerCount: volIds.length, lastVisit, namedVols };
  }, [assignments, volunteers, programName]);

  if (data.volunteerCount === 0) {
    if (compact) return null;
    return (
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <Users size={12} /> No volunteers assigned yet
      </div>
    );
  }

  if (compact) {
    return (
      <span
        title={`Volunteers: ${data.namedVols.join(', ')}\nLast visit: ${data.lastVisit ?? '—'}`}
        className="badge badge-outline"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem' }}
      >
        <Users size={11} /> {data.volunteerCount} vol · {data.totalHours}h
      </span>
    );
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
        background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)',
        fontSize: '0.8rem',
      }}
      title={`Volunteers: ${data.namedVols.join(', ')}`}
    >
      <Users size={14} color="var(--color-primary)" />
      <span>
        <strong>{data.volunteerCount}</strong> {data.volunteerCount === 1 ? 'volunteer' : 'volunteers'} ·{' '}
        <strong>{data.totalHours}h</strong> logged
      </span>
      {data.lastVisit && (
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)', fontSize: '0.72rem' }}>
          last visit {data.lastVisit}
        </span>
      )}
    </div>
  );
};

export default ProgramEffortSummary;
