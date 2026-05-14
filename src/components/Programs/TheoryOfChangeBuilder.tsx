import React, { useEffect, useMemo, useState } from 'react';
import { Plus, ArrowRight, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import './TheoryOfChange.css';
import {
  type ToCNode,
  tocProgramKey as programKey,
  tocStorageKey as storageKeyFor,
  TOC_GENERAL_KEY as GENERAL_KEY,
  TOC_LEGACY_KEY as LEGACY_KEY,
} from '../../utils/tocStorage';
import { useStore } from '../../store/useStore';
import { programIdFromName } from '../../utils/programFinance';
import { improvementPct } from '../../utils/outcomes';

const INITIAL_NODES: ToCNode[] = [
  { id: '1', type: 'input', content: '₹5L Funding & 10 Trainers' },
  { id: '2', type: 'activity', content: 'Conduct 50 Sewing Workshops', metric: 'MIS: Sessions Logged' },
  { id: '3', type: 'output', content: '500 Women Trained', metric: 'MIS: Beneficiaries Enrolled' },
  { id: '4', type: 'outcome', content: '80% Gain Employment', metric: 'MIS: Post-training Survey' },
  { id: '5', type: 'impact', content: 'Increased Household Income & Financial Independence' },
];

function loadNodes(program: string): ToCNode[] {
  try {
    const raw = localStorage.getItem(storageKeyFor(program));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ToCNode[];
    }
    // One-time migration: legacy single-canvas → General bucket
    if (programKey(program) === GENERAL_KEY) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localStorage.setItem(storageKeyFor(program), JSON.stringify(parsed));
          return parsed as ToCNode[];
        }
      }
    }
  } catch {
    /* ignore — fall through to defaults */
  }
  return INITIAL_NODES;
}

interface Props {
  programs?: string[];
}

const TheoryOfChangeBuilder: React.FC<Props> = ({ programs = [] }) => {
  const allOutcomes = useStore(s => s.beneficiaryOutcomes);
  const programOptions = useMemo(() => {
    const list = ['General', ...programs.filter(p => p && p.trim() && p !== 'General')];
    return Array.from(new Set(list));
  }, [programs]);

  const [selectedProgram, setSelectedProgram] = useState<string>(programOptions[0] || 'General');
  const [nodes, setNodes] = useState<ToCNode[]>(() => loadNodes(programOptions[0] || 'General'));
  const [dirty, setDirty] = useState(false);

  // When program changes, swap canvases.
  useEffect(() => {
    setNodes(loadNodes(selectedProgram));
    setDirty(false);
  }, [selectedProgram]);

  // Keep selected program valid when the program list changes upstream.
  // If unsaved edits exist, persist them under the previous key before swapping
  // so a beneficiary list refresh never silently discards operator work.
  useEffect(() => {
    if (programOptions.length && !programOptions.includes(selectedProgram)) {
      if (dirty) {
        try {
          localStorage.setItem(storageKeyFor(selectedProgram), JSON.stringify(nodes));
          if (programKey(selectedProgram) === GENERAL_KEY) {
            localStorage.setItem(LEGACY_KEY, JSON.stringify(nodes));
          }
        } catch {
          /* ignore */
        }
      }
      setSelectedProgram(programOptions[0]);
    }
  }, [programOptions, selectedProgram, dirty, nodes]);

  const handleAdd = (type: ToCNode['type']) => {
    setNodes(prev => [...prev, { id: Date.now().toString(), type, content: 'New ' + type }]);
    setDirty(true);
  };

  const handleUpdate = (id: string, content: string) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, content } : n));
    setDirty(true);
  };

  const handleDelete = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setDirty(true);
  };

  const handleSave = () => {
    try {
      localStorage.setItem(storageKeyFor(selectedProgram), JSON.stringify(nodes));
      // Keep legacy key warm so any old reader keeps working with the General canvas.
      if (programKey(selectedProgram) === GENERAL_KEY) {
        localStorage.setItem(LEGACY_KEY, JSON.stringify(nodes));
      }
      setDirty(false);
      toast.success(`Saved ToC for "${selectedProgram}".`);
    } catch {
      toast.error('Failed to save.');
    }
  };

  const liveMetricByNode = useMemo(() => {
    const progId = programIdFromName(selectedProgram);
    const map = new Map<string, { avg: number; count: number; label: string }>();
    for (const o of allOutcomes) {
      if (o.programId !== progId || !o.tocNodeId) continue;
      const imp = improvementPct(o);
      const cur = map.get(o.tocNodeId);
      if (cur) {
        map.set(o.tocNodeId, { avg: cur.avg + imp, count: cur.count + 1, label: o.metricLabel });
      } else {
        map.set(o.tocNodeId, { avg: imp, count: 1, label: o.metricLabel });
      }
    }
    const result = new Map<string, { avg: number; label: string }>();
    map.forEach((v, k) => result.set(k, { avg: v.avg / v.count, label: v.label }));
    return result;
  }, [allOutcomes, selectedProgram]);

  const renderColumn = (type: ToCNode['type'], title: string, colorClass: string) => {
    const columnNodes = nodes.filter(n => n.type === type);
    return (
      <div className={`toc-column ${colorClass}`}>
        <div className="toc-column-header">
          <h3>{title}</h3>
          <button className="action-btn-small" onClick={() => handleAdd(type)}><Plus size={14} /></button>
        </div>
        <div className="toc-nodes">
          {columnNodes.map(node => {
            const live = liveMetricByNode.get(node.id);
            return (
              <div key={node.id} className="toc-node">
                <textarea
                  value={node.content}
                  onChange={(e) => handleUpdate(node.id, e.target.value)}
                  className="toc-textarea"
                  placeholder={`Enter ${type}...`}
                />
                {node.metric && (
                  <div className="toc-metric-badge">🔗 {node.metric}</div>
                )}
                {live && (
                  <div style={{
                    marginTop: 4,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 6,
                    background: live.avg >= 0 ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
                    color: live.avg >= 0 ? '#15803d' : '#b91c1c',
                    display: 'inline-block',
                  }}>
                    {live.avg >= 0 ? '↑' : '↓'} {Math.abs(live.avg).toFixed(1)}% avg ({live.label})
                  </div>
                )}
                <button className="toc-delete" onClick={() => handleDelete(node.id)}><Trash2 size={12} /></button>
              </div>
            );
          })}
          {columnNodes.length === 0 && <div className="toc-empty">Click + to add</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="toc-builder">
      <div className="toc-toolbar flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Theory of Change (ToC) Canvas</h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
            Map program logic per program. Linked MIS metrics update automatically.
          </p>
        </div>
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            Program
            <select
              className="input-field"
              style={{ marginLeft: 8, display: 'inline-block', width: 'auto', minWidth: 180, padding: '0.35rem 0.6rem' }}
              value={selectedProgram}
              onChange={(e) => {
                if (dirty && !confirm('Unsaved changes will be lost. Switch program?')) return;
                setSelectedProgram(e.target.value);
              }}
            >
              {programOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!dirty}
            title={dirty ? 'Save changes' : 'Nothing to save'}
          >
            <Save size={16} /> {dirty ? 'Save Canvas' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="toc-canvas">
        {renderColumn('input', 'Inputs', 'col-input')}
        <div className="toc-arrow"><ArrowRight color="var(--color-text-tertiary)" /></div>

        {renderColumn('activity', 'Activities', 'col-activity')}
        <div className="toc-arrow"><ArrowRight color="var(--color-text-tertiary)" /></div>

        {renderColumn('output', 'Outputs', 'col-output')}
        <div className="toc-arrow"><ArrowRight color="var(--color-text-tertiary)" /></div>

        {renderColumn('outcome', 'Outcomes', 'col-outcome')}
        <div className="toc-arrow"><ArrowRight color="var(--color-text-tertiary)" /></div>

        {renderColumn('impact', 'Impact', 'col-impact')}
      </div>
    </div>
  );
};

export default TheoryOfChangeBuilder;
