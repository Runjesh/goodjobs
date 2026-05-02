import React, { useEffect } from 'react';
import type { WizardData } from '../../../utils/wizard';
import { useStore } from '../../../store/useStore';
import { useAuth } from '../../../context/AuthContext';

type Value = NonNullable<WizardData['firstProgram']>;

interface Props {
  value: WizardData['firstProgram'];
  onChange: (next: Value) => void;
  setComplete: (b: boolean) => void;
}

const CAUSE_AREAS = [
  'Education', 'Health & Nutrition', 'Livelihoods', 'Women & Child Welfare',
  'Environment', 'Disability & Inclusion', 'Disaster Relief', 'Animal Welfare',
  'Arts & Culture', 'Other',
];

const FirstProgramStep: React.FC<Props> = ({ value, onChange, setComplete }) => {
  const v: Value = value ?? {};
  const { user } = useAuth();
  const addCampaign = useStore((s) => s.addCampaign);

  // Pre-fill cause area from signup data the first time we land here.
  useEffect(() => {
    if (!v.causeArea && user?.orgProfile?.causeArea) {
      onChange({ ...v, causeArea: user.orgProfile.causeArea });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Step is complete when the program has a name and cause area.
  useEffect(() => {
    setComplete(!!v.name?.trim() && !!v.causeArea);
  }, [v.name, v.causeArea, setComplete]);

  const patch = (p: Partial<Value>) => onChange({ ...v, ...p });

  // Side-effect: when name + cause are present, drop a draft campaign into the
  // store so the new tenant has at least one campaign on Funding screen.
  useEffect(() => {
    if (!v.name?.trim() || !v.causeArea) return;
    const existing = useStore.getState().campaigns;
    if (existing.some((c) => c.title === v.name)) return;
    addCampaign({
      title: v.name.trim(),
      goal: 250000,
      status: 'draft',
      image: 'linear-gradient(135deg, #0F766E, #14b8a6)',
      cause: v.causeArea,
      details: { source: 'signup-wizard', startDate: v.startDate ?? null, geography: v.geography ?? null },
    });
  }, [v.name, v.causeArea, v.startDate, v.geography, addCampaign]);

  return (
    <>
      <p style={{ marginTop: '-0.5rem', color: 'var(--color-text-secondary)', fontSize: '0.92rem' }}>
        What's the first program you want to track in GoodJobs? You can add more later.
      </p>

      <div>
        <label className="wizard-field-label" htmlFor="prog-name">Program name *</label>
        <input
          id="prog-name"
          className="wizard-input"
          placeholder="e.g. Digital Literacy for Rural Girls"
          value={v.name ?? ''}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </div>

      <div className="wizard-field-row">
        <div>
          <label className="wizard-field-label" htmlFor="prog-cause">Cause area *</label>
          <select
            id="prog-cause"
            className="wizard-select"
            value={v.causeArea ?? ''}
            onChange={(e) => patch({ causeArea: e.target.value })}
          >
            <option value="">Choose one…</option>
            {CAUSE_AREAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="wizard-field-label" htmlFor="prog-geo">Geography</label>
          <input
            id="prog-geo"
            className="wizard-input"
            placeholder="e.g. Nashik District, Maharashtra"
            value={v.geography ?? ''}
            onChange={(e) => patch({ geography: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="wizard-field-label" htmlFor="prog-date">Start date</label>
        <input
          id="prog-date"
          type="date"
          className="wizard-input"
          value={v.startDate ?? ''}
          onChange={(e) => patch({ startDate: e.target.value })}
        />
        <div className="wizard-field-hint">When did (or will) the program begin operating?</div>
      </div>
    </>
  );
};

export default FirstProgramStep;
