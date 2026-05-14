import React, { useMemo } from 'react';
import { Briefcase, Users } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { programIdFromName } from '../../utils/programFinance';

interface Props {
  programName: string;
  compact?: boolean;
}

const ProgramEffortSummary: React.FC<Props> = ({ programName, compact = false }) => {
  const effortEntries = useStore(s => s.programEffort);
  const assignments   = useStore(s => s.volunteerAssignments);
  const volunteers    = useStore(s => s.volunteers);

  const data = useMemo(() => {
    const effortForProg = effortEntries.filter(e => e.programme === programName);
    const effortHours   = effortForProg.reduce((s, e) => s + e.hours, 0);
    const effortStaff   = Array.from(new Set(effortForProg.map(e => e.staffName)));
    const lastEffort    = effortForProg.length
      ? effortForProg.map(e => e.date).sort().reverse()[0]
      : null;

    const pid = programIdFromName(programName);
    const mine = assignments.filter(a => a.programId === pid);
    const volHours = mine.reduce((s, a) => s + a.hours, 0);
    const volIds   = Array.from(new Set(mine.map(a => a.volunteerId)));
    const namedVols = volIds.map(id => volunteers.find(v => v.id === id)?.name).filter(Boolean) as string[];
    const lastVol   = mine.reduce<string | null>((acc, a) => {
      if (a.lastVisit && (!acc || a.lastVisit > acc)) return a.lastVisit;
      return acc;
    }, null);

    return {
      effortHours,
      effortStaff,
      lastEffort,
      volHours,
      namedVols,
      lastVol,
      totalHours: effortHours + volHours,
      fieldVisits: effortForProg.filter(e => e.type === 'field_visit').length,
    };
  }, [effortEntries, assignments, volunteers, programName]);

  const hasAny = data.effortStaff.length > 0 || data.namedVols.length > 0;

  if (!hasAny) {
    if (compact) return null;
    return (
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <Users size={12} /> No effort logged yet
      </div>
    );
  }

  if (compact) {
    return (
      <span
        title={`Staff: ${[...data.effortStaff, ...data.namedVols].join(', ')}\nLast activity: ${data.lastEffort ?? data.lastVol ?? '—'}`}
        className="badge badge-outline"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem' }}
      >
        <Briefcase size={11} /> {data.totalHours}h logged
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
    >
      <Briefcase size={14} color="var(--color-primary)" />
      <span>
        <strong>{data.totalHours}h</strong> logged
        {data.fieldVisits > 0 && <> · <strong>{data.fieldVisits}</strong> field visit{data.fieldVisits > 1 ? 's' : ''}</>}
        {data.effortStaff.length > 0 && <> · {data.effortStaff.length} staff</>}
        {data.namedVols.length > 0 && <> · {data.namedVols.length} volunteer{data.namedVols.length > 1 ? 's' : ''}</>}
      </span>
      {(data.lastEffort ?? data.lastVol) && (
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)', fontSize: '0.72rem' }}>
          last {data.lastEffort ?? data.lastVol}
        </span>
      )}
    </div>
  );
};

export default ProgramEffortSummary;
