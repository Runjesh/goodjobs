import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Activity, X } from 'lucide-react';
import { ModalOverlay } from '../ui/ModalOverlay';
import { useStore } from '../../store/useStore';
import { programIdFromName } from '../../utils/programFinance';
import { improvementPct, type BeneficiaryOutcome } from '../../utils/outcomes';

interface Props {
  beneficiaryId: string;
  beneficiaryName: string;
  programName: string;
  onClose: () => void;
}

const METRIC_PRESETS = [
  { metric: 'weight_kg',        metricLabel: 'Weight',                       unit: 'kg',  higherIsBetter: true  },
  { metric: 'literacy_score',   metricLabel: 'Literacy assessment score',    unit: '%',   higherIsBetter: true  },
  { metric: 'monthly_income',   metricLabel: 'Monthly household income',     unit: '₹',   higherIsBetter: true  },
  { metric: 'attendance_rate',  metricLabel: 'School attendance',            unit: '%',   higherIsBetter: true  },
  { metric: 'malnutrition_idx', metricLabel: 'Malnutrition index',           unit: '',    higherIsBetter: false },
];

const OutcomeForm: React.FC<Props> = ({ beneficiaryId, beneficiaryName, programName, onClose }) => {
  const upsert = useStore(s => s.upsertBeneficiaryOutcome);
  const existing = useStore(s => s.beneficiaryOutcomes.find(o => o.beneficiaryId === beneficiaryId));

  const [metricIdx, setMetricIdx] = useState(0);
  const preset = METRIC_PRESETS[metricIdx];
  const [baseline, setBaseline] = useState<string>(existing?.baseline?.toString() ?? '');
  const [current,  setCurrent]  = useState<string>(existing?.current?.toString() ?? '');
  const [note, setNote] = useState(existing?.note ?? '');

  const baselineNum = Number(baseline);
  const currentNum  = Number(current);
  const valid = Number.isFinite(baselineNum) && Number.isFinite(currentNum) && baseline !== '' && current !== '';

  const previewImprovement = valid
    ? improvementPct({
        id: '_', beneficiaryId, programId: '_', metric: preset.metric,
        metricLabel: preset.metricLabel, baseline: baselineNum, current: currentNum,
        higherIsBetter: preset.higherIsBetter, measuredAt: '',
      })
    : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const record: BeneficiaryOutcome = {
      id: existing?.id ?? `OUT-${beneficiaryId}-${preset.metric}-${Date.now()}`,
      beneficiaryId,
      programId: programIdFromName(programName),
      metric: preset.metric,
      metricLabel: preset.metricLabel,
      baseline: baselineNum,
      current: currentNum,
      higherIsBetter: preset.higherIsBetter,
      unit: preset.unit,
      measuredAt: new Date().toISOString().slice(0, 10),
      note: note.trim() || undefined,
    };
    upsert(record);
    toast.success(`Outcome saved for ${beneficiaryName}.`);
    onClose();
  };

  return (
    <ModalOverlay onBackdropClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <button type="button" onClick={onClose} className="action-btn" aria-label="Close" style={{ position: 'absolute', right: '1rem', top: '1rem' }}><X size={20} /></button>
        <div className="flex items-center gap-2 mb-3" style={{ paddingRight: '2.5rem' }}>
          <Activity size={20} color="#7C3AED" />
          <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Record outcome</h2>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
          For <strong>{beneficiaryName}</strong> in <strong>{programName}</strong>. This feeds the Insights aggregate and grant utilization reports.
        </p>

        <form onSubmit={submit} className="flex-col gap-3 flex">
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Metric</label>
            <select className="input-field" value={metricIdx} onChange={e => setMetricIdx(Number(e.target.value))}>
              {METRIC_PRESETS.map((m, i) => (
                <option key={m.metric} value={i}>{m.metricLabel}{m.unit ? ` (${m.unit})` : ''}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Baseline (pre)</label>
              <input className="input-field" type="number" inputMode="decimal" value={baseline} onChange={e => setBaseline(e.target.value)} required />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Current (post)</label>
              <input className="input-field" type="number" inputMode="decimal" value={current} onChange={e => setCurrent(e.target.value)} required />
            </div>
          </div>

          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Supervisor note (optional)</label>
            <textarea className="input-field" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Context, methodology, anything funders should know" />
          </div>

          {valid && (
            <div style={{
              padding: '0.5rem 0.75rem',
              borderRadius: 8,
              background: previewImprovement >= 0 ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
              color: previewImprovement >= 0 ? '#15803d' : '#b91c1c',
              fontSize: '0.8125rem',
              fontWeight: 600,
            }}>
              {previewImprovement >= 0 ? '↑' : '↓'} {Math.abs(previewImprovement).toFixed(1)}% change vs baseline
              <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.85 }}>
                ({preset.higherIsBetter ? 'higher is better' : 'lower is better'})
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!valid}>Save outcome</button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
};

export default OutcomeForm;
