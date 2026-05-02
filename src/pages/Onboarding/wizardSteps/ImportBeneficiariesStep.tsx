import React, { useEffect, useRef } from 'react';
import { Upload, FileText, X, Plus } from 'lucide-react';
import type { WizardData } from '../../../utils/wizard';

type Mode = 'csv' | 'manual';
type Value = NonNullable<WizardData['importBeneficiaries']>;

interface Props {
  value: WizardData['importBeneficiaries'];
  onChange: (next: Value) => void;
  setComplete: (b: boolean) => void;
}

interface ManualBen { name: string; program: string; familySize: string }
const blank = (): ManualBen => ({ name: '', program: '', familySize: '1' });

const ImportBeneficiariesStep: React.FC<Props> = ({ value, onChange, setComplete }) => {
  const v: Value = value ?? { mode: 'manual' };
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual rows live entirely in wizard state so reload/back resumes draft data.
  // No localStorage; the wizard shell already persists state.data on every change.
  const manualRows: ManualBen[] = v.manualRows ?? [blank(), blank(), blank()];
  const mode: Mode = v.mode ?? 'manual';

  // Step considered complete when we either picked a CSV file or have ≥1 valid manual row.
  useEffect(() => {
    if (mode === 'csv') {
      setComplete(!!v.csvName);
    } else {
      const valid = manualRows.filter((r) => r.name.trim().length > 0);
      setComplete(valid.length >= 1);
    }
  }, [mode, v.csvName, manualRows, setComplete]);

  const switchMode = (next: Mode) => {
    onChange({ ...v, mode: next, count: 0, csvName: undefined });
  };

  const handleCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Roughly estimate row count from byte size — UX-only.
    const estimatedRows = Math.max(1, Math.round(file.size / 80));
    onChange({ ...v, mode: 'csv', csvName: file.name, count: estimatedRows });
  };

  const writeRows = (next: ManualBen[]) => {
    const validCount = next.filter((r) => r.name.trim()).length;
    onChange({ ...v, mode: 'manual', manualRows: next, count: validCount });
  };

  const updateRow = (i: number, patch: Partial<ManualBen>) => {
    writeRows(manualRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const removeRow = (i: number) => {
    if (manualRows.length === 1) return;
    writeRows(manualRows.filter((_, idx) => idx !== i));
  };

  const addRow = () => writeRows([...manualRows, blank()]);

  return (
    <>
      <p style={{ marginTop: '-0.5rem', color: 'var(--color-text-secondary)', fontSize: '0.92rem' }}>
        Get your existing list into GoodJobs so you can track services from day one.
        Pick whichever is easier — you can always import more later.
      </p>

      <div className="wizard-mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'csv'}
          className={`wizard-mode-tab ${mode === 'csv' ? 'is-active' : ''}`}
          onClick={() => switchMode('csv')}
        >
          <strong>📄 Upload CSV</strong>
          <span>Have a spreadsheet? Drop it in.</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'manual'}
          className={`wizard-mode-tab ${mode === 'manual' ? 'is-active' : ''}`}
          onClick={() => switchMode('manual')}
        >
          <strong>✍️ Add a few manually</strong>
          <span>Just type a few names to feel the system.</span>
        </button>
      </div>

      {mode === 'csv' ? (
        <div className="wizard-csv-drop">
          <Upload size={28} color="#0F766E" />
          <div className="wizard-csv-drop-title">
            {v.csvName ? `Uploaded: ${v.csvName}` : 'Drop your CSV here or browse'}
          </div>
          <div className="wizard-csv-drop-hint">
            Required columns: <code>name, program, location, family_size</code>
          </div>
          <button
            type="button"
            className="wizard-file-btn"
            onClick={() => fileRef.current?.click()}
          >
            <FileText size={14} /> {v.csvName ? 'Replace file' : 'Choose CSV'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsv}
            style={{ display: 'none' }}
          />
          {v.count ? (
            <div className="wizard-field-hint">
              ~{v.count} record{v.count > 1 ? 's' : ''} detected · we'll process them in the background.
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="wizard-manual-list">
            {manualRows.map((r, i) => (
              <div className="wizard-manual-row" key={i}>
                <input
                  className="wizard-input"
                  placeholder="Beneficiary name"
                  value={r.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                />
                <input
                  className="wizard-input"
                  placeholder="Program (optional)"
                  value={r.program}
                  onChange={(e) => updateRow(i, { program: e.target.value })}
                />
                <input
                  className="wizard-input"
                  type="number"
                  min={1}
                  placeholder="Family size"
                  value={r.familySize}
                  onChange={(e) => updateRow(i, { familySize: e.target.value })}
                />
                <button
                  type="button"
                  className="wizard-invite-remove"
                  onClick={() => removeRow(i)}
                  aria-label="Remove row"
                  disabled={manualRows.length === 1}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="wizard-add-btn" onClick={addRow}>
            <Plus size={14} /> Add another row
          </button>
          <div className="wizard-field-hint">
            We'll add these to your beneficiary list when you click <strong>Save &amp; continue</strong>.
          </div>
        </>
      )}
    </>
  );
};

export default ImportBeneficiariesStep;
