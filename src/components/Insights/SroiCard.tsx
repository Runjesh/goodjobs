import React, { useMemo, useState } from 'react';
import { TrendingUp, IndianRupee, Download, Settings as SettingsIcon, X, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import {
  computeAllSroi,
  portfolioSroi,
  buildSroiCsv,
  loadSroiInputs,
  setProgramInputs,
  type SroiConfidence,
  type SroiProgramInputs,
  type SroiResult,
} from '../../utils/sroi';
import './OutcomesAggregateCard.css';

const fmtINR = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return '₹0';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
};

const ConfidenceChip: React.FC<{ value: SroiConfidence }> = ({ value }) => {
  const styles: Record<SroiConfidence, { bg: string; fg: string; label: string }> = {
    low:    { bg: '#fee2e2', fg: '#b91c1c', label: 'Low confidence' },
    medium: { bg: '#fef3c7', fg: '#b45309', label: 'Medium confidence' },
    high:   { bg: '#dcfce7', fg: '#15803d', label: 'High confidence' },
  };
  const s = styles[value];
  return (
    <span style={{
      background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 99,
      fontSize: '0.7rem', fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
};

interface EditModalProps {
  initial: SroiProgramInputs;
  onClose: () => void;
  onSave: (next: SroiProgramInputs) => void;
}
const EditInputsModal: React.FC<EditModalProps> = ({ initial, onClose, onSave }) => {
  const [cost, setCost] = useState(String(initial.inputCost));
  const [val,  setVal]  = useState(String(initial.perOutcomeValue));
  const [conf, setConf] = useState<SroiConfidence>(initial.confidence);

  const submit = () => {
    const c = Number(cost), v = Number(val);
    if (!Number.isFinite(c) || c < 0) { toast.error('Programme cost must be a positive number.'); return; }
    if (!Number.isFinite(v) || v < 0) { toast.error('Per-outcome value must be a positive number.'); return; }
    onSave({ programId: initial.programId, inputCost: c, perOutcomeValue: v, confidence: conf });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 'var(--radius-lg)', width: 'min(440px, 92vw)',
          padding: '1.25rem 1.4rem', boxShadow: 'var(--shadow-xl)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>SROI inputs · {initial.programId.replace(/-/g, ' ')}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Programme cost (₹)</label>
            <input className="input-field" type="number" min={0} value={cost} onChange={e => setCost(e.target.value)} />
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              Total spent on this programme during the SROI period.
            </div>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Per-outcome social value (₹)</label>
            <input className="input-field" type="number" min={0} value={val} onChange={e => setVal(e.target.value)} />
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              ₹ society pays per <em>1% positive improvement</em> per beneficiary record.
            </div>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Attribution confidence</label>
            <select className="input-field" value={conf} onChange={e => setConf(e.target.value as SroiConfidence)}>
              <option value="low">Low — proxy data, weak attribution (×0.50)</option>
              <option value="medium">Medium — programme data with some controls (×0.75)</option>
              <option value="high">High — RCT / matched comparison (×1.00)</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}><Save size={14} /> Save inputs</button>
        </div>
      </div>
    </div>
  );
};

const SroiCard: React.FC = () => {
  const records = useStore(s => s.beneficiaryOutcomes);
  const [version, setVersion] = useState(0); // bump to re-read from localStorage
  const [editing, setEditing] = useState<SroiProgramInputs | null>(null);

  const results = useMemo<SroiResult[]>(
    () => computeAllSroi(records),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, version],
  );
  const portfolio = useMemo(() => portfolioSroi(results), [results]);

  const onExport = () => {
    if (results.length === 0) {
      toast.error('No programmes with SROI data to export yet.');
      return;
    }
    const csv = buildSroiCsv(results);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `GoodJobs_SROI_Report_${today}.csv`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`Exported ${filename}`);
  };

  const onEdit = (programId: string) => {
    const map = loadSroiInputs();
    setEditing(map[programId] ?? { programId, inputCost: 500_000, perOutcomeValue: 1_000, confidence: 'medium' });
  };

  const onSaveInputs = (next: SroiProgramInputs) => {
    setProgramInputs(next);
    setEditing(null);
    setVersion(v => v + 1);
    toast.success('SROI inputs saved.');
  };

  return (
    <div className="outcomes-card">
      <div className="outcomes-card-header">
        <div className="outcomes-card-icon"><IndianRupee size={16} /></div>
        <h3>Social Return on Investment (SROI)</h3>
        <span className="outcomes-card-badge">Monetised model</span>
        <button
          onClick={onExport}
          style={{
            marginLeft: 'auto',
            background: 'var(--color-primary)', color: 'white',
            border: 'none', borderRadius: 'var(--radius-sm)',
            padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Download size={13} /> Funder CSV
        </button>
      </div>

      {results.length === 0 ? (
        <div className="outcomes-card-empty">
          No programme outcomes recorded yet — record outcomes in <strong>Programs</strong> and configure programme cost / per-outcome value below to compute SROI.
        </div>
      ) : (
        <>
          {/* Portfolio summary */}
          <div className="outcomes-card-summary">
            <div className="outcomes-card-summary-cell">
              <div className="outcomes-card-summary-label">Total invested</div>
              <div className="outcomes-card-summary-value">{fmtINR(portfolio.totalCost)}</div>
            </div>
            <div className="outcomes-card-summary-cell">
              <div className="outcomes-card-summary-label">Monetised social value</div>
              <div className="outcomes-card-summary-value">{fmtINR(portfolio.totalValue)}</div>
            </div>
            <div className="outcomes-card-summary-cell">
              <div className="outcomes-card-summary-label">Portfolio SROI ratio</div>
              <div className="outcomes-card-summary-value" style={{ color: portfolio.ratio >= 1 ? '#15803d' : '#b91c1c' }}>
                <TrendingUp size={14} /> {portfolio.ratio.toFixed(2)} : 1
              </div>
            </div>
          </div>

          <table className="outcomes-card-table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>People</th>
                <th>Cost</th>
                <th>Monetised value</th>
                <th>Ratio</th>
                <th>Confidence band</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.programId}>
                  <td>
                    {r.programId.replace(/-/g, ' ')}
                    <div style={{ marginTop: 4 }}><ConfidenceChip value={r.confidence} /></div>
                  </td>
                  <td>{r.beneficiaryCount}</td>
                  <td>{fmtINR(r.inputCost)}</td>
                  <td>{fmtINR(r.monetisedValue)}</td>
                  <td>
                    <strong style={{ color: r.ratio >= 1 ? '#15803d' : '#b91c1c' }}>
                      {r.ratio.toFixed(2)} : 1
                    </strong>
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                    {r.confidenceBand.low.toFixed(2)} – {r.confidenceBand.high.toFixed(2)}
                  </td>
                  <td>
                    <button
                      onClick={() => onEdit(r.programId)}
                      title="Edit SROI inputs"
                      style={{
                        background: 'transparent', border: '1px solid var(--color-border-light)',
                        borderRadius: 'var(--radius-sm)', padding: '4px 8px',
                        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: '0.72rem', color: 'var(--color-text-secondary)',
                      }}
                    >
                      <SettingsIcon size={11} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '0.6rem', lineHeight: 1.5 }}>
            Ratio = monetised value ÷ programme cost. Confidence band widens with weaker attribution
            (Low ±50%, Medium ±25%, High ±10%).
          </p>
        </>
      )}

      {editing && (
        <EditInputsModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={onSaveInputs}
        />
      )}
    </div>
  );
};

export default SroiCard;
