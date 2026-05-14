import React, { useMemo, useState } from 'react';
import { Target, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../../store/useStore';
import {
  selectGrantProgramRollups,
  summariseGrantFunding,
} from '../../utils/programGrantLink';

interface Props {
  grantId: string;
}

/**
 * One-line "funds N programmes · M beneficiaries" summary for a grant,
 * with a click-to-expand list of linked programmes. Designed to slot
 * into the CSR Kanban card under the project name so reps see grant
 * roll-up data without opening the detail page.
 */
const GrantFundingSummary: React.FC<Props> = ({ grantId }) => {
  const links          = useStore(s => s.programGrantLinks);
  const beneficiaries  = useStore(s => s.beneficiaries);
  const customPrograms = useStore(s => s.customPrograms);
  const outcomes       = useStore(s => s.beneficiaryOutcomes);

  const rollups = useMemo(
    () => selectGrantProgramRollups(grantId, {
      links, beneficiaries, customPrograms, outcomes,
    }),
    [grantId, links, beneficiaries, customPrograms, outcomes],
  );
  const summary = summariseGrantFunding(rollups);
  const [open, setOpen] = useState(false);

  if (summary.programCount === 0) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: '0.7rem', color: 'var(--color-text-secondary)',
        }}
        aria-expanded={open}
        title="Show / hide linked programmes"
      >
        <Target size={11} color="var(--color-primary)" />
        <span>
          Funds <strong>{summary.programCount}</strong> programme{summary.programCount === 1 ? '' : 's'}
          {' · '}
          <Users size={10} style={{ verticalAlign: 'middle', marginRight: 2 }} />
          <strong>{summary.beneficiaryTotal}</strong> beneficiar{summary.beneficiaryTotal === 1 ? 'y' : 'ies'}
        </span>
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <ul
          onClick={(e) => e.stopPropagation()}
          style={{
            listStyle: 'none', padding: '4px 0 0 16px', margin: 0,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {rollups.map(r => (
            <li
              key={r.linkId}
              style={{
                fontSize: '0.68rem', color: 'var(--color-text-secondary)',
                display: 'flex', alignItems: 'center', gap: 6,
                lineHeight: 1.35,
              }}
              title={r.role ? `${r.role} funder` : undefined}
            >
              <span
                aria-hidden
                style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'var(--color-primary)', flex: 'none',
                }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.programLabel}
              </span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                {r.beneficiaryCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default GrantFundingSummary;
