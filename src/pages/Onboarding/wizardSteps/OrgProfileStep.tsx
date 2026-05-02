import React, { useEffect, useRef } from 'react';
import { Upload, ShieldCheck } from 'lucide-react';
import type { WizardData } from '../../../utils/wizard';

type Value = NonNullable<WizardData['orgProfile']>;

interface Props {
  value: WizardData['orgProfile'];
  onChange: (next: Value) => void;
  setComplete: (b: boolean) => void;
}

const FCRA_OPTIONS: { id: NonNullable<Value['fcraStatus']>; label: string }[] = [
  { id: 'none',    label: 'No FCRA' },
  { id: 'pending', label: 'Pending' },
  { id: 'active',  label: 'Active' },
];

const OrgProfileStep: React.FC<Props> = ({ value, onChange, setComplete }) => {
  const v: Value = value ?? {};
  const fileRef = useRef<HTMLInputElement>(null);

  // Step considered complete when registration number has any value (logo + 80G + FCRA optional).
  useEffect(() => {
    setComplete(!!v.registrationNumber?.trim());
  }, [v.registrationNumber, setComplete]);

  const patch = (p: Partial<Value>) => onChange({ ...v, ...p });

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      alert('Please pick an image under 1.5 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patch({ logoDataUrl: typeof reader.result === 'string' ? reader.result : undefined });
    reader.readAsDataURL(file);
  };

  return (
    <>
      <p style={{ marginTop: '-0.5rem', color: 'var(--color-text-secondary)', fontSize: '0.92rem' }}>
        Add your registration details so we can pre-fill receipts and reports correctly.
      </p>

      <div className="wizard-logo-upload">
        <div className="wizard-logo-preview">
          {v.logoDataUrl ? <img src={v.logoDataUrl} alt="Logo preview" /> : 'NGO'}
        </div>
        <div className="wizard-logo-upload-cta">
          <span className="wizard-field-label">Organisation logo</span>
          <button type="button" className="wizard-file-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Upload logo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleLogoChange}
            style={{ display: 'none' }}
          />
          <span className="wizard-field-hint">PNG or JPG · square works best · under 1.5 MB</span>
        </div>
      </div>

      <div className="wizard-field-row">
        <div>
          <label className="wizard-field-label" htmlFor="reg-number">Registration number *</label>
          <input
            id="reg-number"
            className="wizard-input"
            placeholder="e.g. F-1234 (Mumbai)"
            value={v.registrationNumber ?? ''}
            onChange={(e) => patch({ registrationNumber: e.target.value })}
          />
          <div className="wizard-field-hint">From your Trust Deed / Society / Sec-8 registration.</div>
        </div>
        <div>
          <label className="wizard-field-label" htmlFor="g80-number">80G certificate number</label>
          <input
            id="g80-number"
            className="wizard-input"
            placeholder="e.g. AAAAA1234A/01/2023"
            value={v.section80GNumber ?? ''}
            onChange={(e) => patch({ section80GNumber: e.target.value })}
          />
          <div className="wizard-field-hint">Lets us auto-issue 80G receipts for donors.</div>
        </div>
      </div>

      <div>
        <span className="wizard-field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <ShieldCheck size={14} color="#0F766E" /> FCRA status
        </span>
        <div className="wizard-radio-group">
          {FCRA_OPTIONS.map((opt) => {
            const active = v.fcraStatus === opt.id;
            return (
              <label key={opt.id} className={`wizard-radio ${active ? 'is-active' : ''}`}>
                <input
                  type="radio"
                  name="fcra"
                  value={opt.id}
                  checked={active}
                  onChange={() => patch({ fcraStatus: opt.id })}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
        <div className="wizard-field-hint">
          Foreign Contribution Regulation Act — required if you accept overseas donations.
        </div>
      </div>
    </>
  );
};

export default OrgProfileStep;
