import React from 'react';
import { CheckCircle, AlertCircle, Clock, ArrowRight, Play, X, Edit3, Loader2 } from 'lucide-react';

export type ActionStatus = 'running' | 'done' | 'awaiting' | 'blocked' | 'failed';

interface ActionCardProps {
  status: ActionStatus;
  title: string;
  summary: string;
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  category?: string;
}

const ActionCard: React.FC<ActionCardProps> = ({ status, title, summary, onApprove, onReject, onEdit, category }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'running': return { icon: <Loader2 className="animate-spin" size={18} />, color: 'var(--color-primary)', label: 'Running' };
      case 'done': return { icon: <CheckCircle size={18} />, color: 'var(--color-success)', label: 'Completed' };
      case 'awaiting': return { icon: <Clock size={18} />, color: 'var(--color-warning)', label: 'Awaiting Review' };
      case 'blocked': return { icon: <AlertCircle size={18} />, color: 'var(--color-danger)', label: 'Needs Input' };
      case 'failed': return { icon: <X size={18} />, color: 'var(--color-text-tertiary)', label: 'Failed (Fallback active)' };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`action-card-container state-${status}`} style={{
      background: 'var(--color-bg-card)',
      border: `1px solid var(--color-border)`,
      borderRadius: 'var(--radius-lg)',
      padding: '1.25rem',
      marginBottom: '1rem',
      position: 'relative',
      transition: 'transform 0.2s, box-shadow 0.2s',
      boxShadow: status === 'awaiting' ? '0 4px 12px rgba(245, 158, 11, 0.1)' : 'var(--shadow-sm)',
    }}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <span style={{ color: config.color }}>{config.icon}</span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: config.color }}>
            {category || config.label}
          </span>
        </div>
        {status === 'awaiting' && <span className="badge badge-warning">Priority</span>}
      </div>

      <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-primary)' }}>{title}</h4>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: '1.25rem' }}>{summary}</p>

      <div className="flex gap-2">
        {status === 'awaiting' && (
          <>
            <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.8125rem' }} onClick={onApprove}>
              Approve Now
            </button>
            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }} onClick={onEdit}>
              <Edit3 size={14} /> Edit
            </button>
            <button className="btn btn-outline" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem', borderColor: 'var(--color-border)' }} onClick={onReject}>
              Reject
            </button>
          </>
        )}
        {(status === 'done' || status === 'running') && (
          <button className="btn btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.8125rem' }}>
            View Details <ArrowRight size={14} />
          </button>
        )}
        {status === 'blocked' && (
          <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.8125rem' }}>
            Provide Input <ArrowRight size={14} />
          </button>
        )}
      </div>

      <style>{`
        .action-card-container:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }
        .state-awaiting {
          border-left: 4px solid var(--color-warning) !important;
        }
        .state-blocked {
          border-left: 4px solid var(--color-danger) !important;
        }
        .state-running {
          border-left: 4px solid var(--color-primary) !important;
        }
      `}</style>
    </div>
  );
};

export default ActionCard;
