import React, { useState } from 'react';
import { Plus, ArrowRight, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import './TheoryOfChange.css';

interface ToCNode {
  id: string;
  type: 'input' | 'activity' | 'output' | 'outcome' | 'impact';
  content: string;
  metric?: string;
}

const INITIAL_NODES: ToCNode[] = [
  { id: '1', type: 'input', content: '₹5L Funding & 10 Trainers' },
  { id: '2', type: 'activity', content: 'Conduct 50 Sewing Workshops', metric: 'MIS: Sessions Logged' },
  { id: '3', type: 'output', content: '500 Women Trained', metric: 'MIS: Beneficiaries Enrolled' },
  { id: '4', type: 'outcome', content: '80% Gain Employment', metric: 'MIS: Post-training Survey' },
  { id: '5', type: 'impact', content: 'Increased Household Income & Financial Independence' },
];

const TheoryOfChangeBuilder: React.FC = () => {
  const [nodes, setNodes] = useState<ToCNode[]>(INITIAL_NODES);

  const handleAdd = (type: ToCNode['type']) => {
    setNodes([...nodes, { id: Date.now().toString(), type, content: 'New ' + type }]);
  };

  const handleUpdate = (id: string, content: string) => {
    setNodes(nodes.map(n => n.id === id ? { ...n, content } : n));
  };

  const handleDelete = (id: string) => {
    setNodes(nodes.filter(n => n.id !== id));
  };

  const renderColumn = (type: ToCNode['type'], title: string, colorClass: string) => {
    const columnNodes = nodes.filter(n => n.type === type);
    return (
      <div className={`toc-column ${colorClass}`}>
        <div className="toc-column-header">
          <h3>{title}</h3>
          <button className="action-btn-small" onClick={() => handleAdd(type)}><Plus size={14} /></button>
        </div>
        <div className="toc-nodes">
          {columnNodes.map(node => (
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
              <button className="toc-delete" onClick={() => handleDelete(node.id)}><Trash2 size={12} /></button>
            </div>
          ))}
          {columnNodes.length === 0 && <div className="toc-empty">Click + to add</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="toc-builder">
      <div className="toc-toolbar flex justify-between items-center">
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Theory of Change (ToC) Canvas</h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Map your program logic. Linked MIS metrics update automatically.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            try {
              localStorage.setItem('goodjobs.toc.v1', JSON.stringify(nodes));
              toast.success('Saved locally.');
            } catch {
              toast.error('Failed to save.');
            }
          }}
        >
          <Save size={16} /> Save Canvas
        </button>
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
