import React, { useState, useCallback } from 'react';
import { CheckCircle2, Clock, AlertTriangle, MinusCircle, Send, MoreHorizontal } from 'lucide-react';
import {
  computeTouchpoints,
  markMilestoneDone,
  markMilestoneSkipped,
  type Milestone,
  type MilestoneId,
} from '../../utils/donorLifecycle';
import './TouchpointTimeline.css';

interface Props {
  donor: { id: string | number; name: string; lastGift?: unknown };
  onApprove?: (mid: MilestoneId, milestone: Milestone) => void;
}

const STATE_ICON: Record<Milestone['state'], React.ElementType> = {
  done:     CheckCircle2,
  due:      Clock,
  overdue:  AlertTriangle,
  upcoming: Clock,
  skipped:  MinusCircle,
};

const STATE_COLOR: Record<Milestone['state'], string> = {
  done:     '#16A34A',
  due:      '#0F766E',
  overdue:  '#DC2626',
  upcoming: '#94a3b8',
  skipped:  '#94a3b8',
};

const fmt = (d: Date | null) =>
  d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const TouchpointTimeline: React.FC<Props> = ({ donor, onApprove }) => {
  // Local rev counter forces re-compute after persisted changes.
  const [rev, setRev] = useState(0);
  const milestones = computeTouchpoints(donor);

  const handleApprove = useCallback((m: Milestone) => {
    markMilestoneDone(donor.id, m.id);
    setRev(r => r + 1);
    onApprove?.(m.id, m);
  }, [donor.id, onApprove]);

  const handleSkip = useCallback((m: Milestone) => {
    markMilestoneSkipped(donor.id, m.id);
    setRev(r => r + 1);
  }, [donor.id]);

  // rev is referenced so React picks up the forced re-render dependency.
  void rev;

  return (
    <div className="touchpoint-timeline">
      <div className="touchpoint-timeline-header">
        <h3>Nurture Touchpoints</h3>
        <span className="touchpoint-timeline-sub">4-step cadence anchored to last gift</span>
      </div>
      <ol className="touchpoint-list">
        {milestones.map(m => {
          const Icon = STATE_ICON[m.state];
          const color = STATE_COLOR[m.state];
          const showApprove = m.state === 'due' || m.state === 'overdue';
          return (
            <li key={m.id} className={`touchpoint-item touchpoint-item--${m.state}`}>
              <div className="touchpoint-icon" style={{ color, borderColor: `${color}40`, background: `${color}10` }}>
                <Icon size={14} />
              </div>
              <div className="touchpoint-body">
                <div className="touchpoint-row">
                  <span className="touchpoint-label">{m.label}</span>
                  <span className="touchpoint-state-pill" style={{ color, background: `${color}15` }}>
                    {m.state === 'done' ? 'Sent' : m.state === 'overdue' ? 'Overdue' : m.state === 'due' ? 'Due now' : m.state === 'skipped' ? 'Skipped' : 'Upcoming'}
                  </span>
                </div>
                <div className="touchpoint-meta">
                  {m.state === 'done'
                    ? <>Sent {fmt(m.doneDate)}</>
                    : <>Due {fmt(m.dueDate)} · {m.description}</>}
                </div>
              </div>
              <div className="touchpoint-actions">
                {showApprove && (
                  <button className="touchpoint-approve" onClick={() => handleApprove(m)} title="Approve & send">
                    <Send size={11} /> Approve & Send
                  </button>
                )}
                {(m.state === 'due' || m.state === 'overdue' || m.state === 'upcoming') && (
                  <button className="touchpoint-skip" onClick={() => handleSkip(m)} title="Skip this touchpoint">
                    <MoreHorizontal size={11} /> Skip
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default TouchpointTimeline;
