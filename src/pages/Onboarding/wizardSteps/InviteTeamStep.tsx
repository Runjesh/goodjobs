import React, { useEffect } from 'react';
import { Plus, X, Mail } from 'lucide-react';
import type { WizardData } from '../../../utils/wizard';

type Invite = { email: string; role: string };
type Value = NonNullable<WizardData['inviteTeam']>;

interface Props {
  value: WizardData['inviteTeam'];
  onChange: (next: Value) => void;
  setComplete: (b: boolean) => void;
}

const ROLES: { id: string; label: string }[] = [
  { id: 'finance',  label: 'Finance Officer' },
  { id: 'programs', label: 'Program Manager' },
  { id: 'field',    label: 'Field Staff' },
  { id: 'board',    label: 'Board Member' },
  { id: 'ed',       label: 'Co-ED' },
];

const MAX_INVITES = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function blankRow(): Invite { return { email: '', role: 'programs' }; }

const InviteTeamStep: React.FC<Props> = ({ value, onChange, setComplete }) => {
  const invites: Invite[] = (value?.invites?.length ? value.invites : [blankRow()]);

  const validInvites = invites.filter((i) => EMAIL_RE.test(i.email.trim()));

  // Step is "complete" if at least one valid invite exists. (Skip is always allowed.)
  useEffect(() => {
    setComplete(validInvites.length >= 1);
  }, [validInvites.length, setComplete]);

  const update = (next: Invite[]) => onChange({ invites: next });

  const patchRow = (i: number, patch: Partial<Invite>) => {
    const next = invites.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
    update(next);
  };

  const addRow = () => {
    if (invites.length >= MAX_INVITES) return;
    update([...invites, blankRow()]);
  };

  const removeRow = (i: number) => {
    const next = invites.filter((_, idx) => idx !== i);
    update(next.length ? next : [blankRow()]);
  };

  return (
    <>
      <p style={{ marginTop: '-0.5rem', color: 'var(--color-text-secondary)', fontSize: '0.92rem' }}>
        Bring in up to {MAX_INVITES} teammates. Each role sees only what they need —
        you can change permissions later in Settings.
      </p>

      <div className="wizard-invite-list">
        {invites.map((row, i) => {
          const isInvalid = row.email.trim().length > 0 && !EMAIL_RE.test(row.email.trim());
          return (
            <div className="wizard-invite-row" key={i}>
              <input
                type="email"
                className="wizard-input"
                placeholder="teammate@yourngo.org"
                value={row.email}
                onChange={(e) => patchRow(i, { email: e.target.value })}
                aria-invalid={isInvalid}
                style={isInvalid ? { borderColor: '#DC2626' } : undefined}
              />
              <select
                className="wizard-select"
                value={row.role}
                onChange={(e) => patchRow(i, { role: e.target.value })}
              >
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button
                type="button"
                className="wizard-invite-remove"
                onClick={() => removeRow(i)}
                aria-label="Remove invite"
                title="Remove this invite"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="wizard-add-btn"
        onClick={addRow}
        disabled={invites.length >= MAX_INVITES}
      >
        <Plus size={14} /> Add another teammate {invites.length >= MAX_INVITES && '(max 5)'}
      </button>

      <div
        className="wizard-field-hint"
        style={{
          marginTop: '0.5rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}
      >
        <Mail size={12} /> {validInvites.length > 0
          ? `${validInvites.length} invite${validInvites.length > 1 ? 's' : ''} ready to send when you continue.`
          : 'Add at least one valid email to continue, or skip for now.'}
      </div>
    </>
  );
};

export default InviteTeamStep;
