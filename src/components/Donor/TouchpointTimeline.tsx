import React, { useState, useCallback } from 'react';
import { CheckCircle2, Clock, AlertTriangle, MinusCircle, Send, MoreHorizontal } from 'lucide-react';
import {
  computeTouchpoints,
  markMilestoneDone,
  markMilestoneSkipped,
  type Milestone,
  type MilestoneId,
} from '../../utils/donorLifecycle';
import type { Donor } from '../../store/useStore';
import './TouchpointTimeline.css';

interface Props {
  donor: { id: string | number; name: string; lastGift?: unknown };
  /**
   * Called when the user clicks "Approve & Send" on a milestone.
   *
   * - If `onApprove` is **provided**, the parent owns the side-effect (e.g.
   *   call the outreach API) AND is responsible for marking the milestone
   *   done on success.  This component will NOT write to localStorage in
   *   that case — it only forces a re-render once the parent resolves.
   *   Return `true` from a successful send so the timeline re-renders;
   *   return `false`/throw and the milestone stays in its previous state.
   *
   * - If `onApprove` is **omitted**, this component falls back to writing
   *   the milestone done locally so it remains usable in standalone demos.
   */
  onApprove?: (mid: MilestoneId, milestone: Milestone) => boolean | void | Promise<boolean | void>;
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
  // Tracks milestones currently being sent so we can disable the button and
  // prevent double-submits.
  const [pending, setPending] = useState<Set<MilestoneId>>(new Set());
  const milestones = computeTouchpoints(donor as Donor);

  const handleApprove = useCallback(async (m: Milestone) => {
    if (pending.has(m.id)) return;
    setPending(prev => { const n = new Set(prev); n.add(m.id); return n; });
    try {
      if (onApprove) {
        // Parent owns the API call AND the markMilestoneDone write.
        // We only re-render when the parent reports success.
        const result = await onApprove(m.id, m);
        if (result !== false) setRev(r => r + 1);
      } else {
        // Standalone fallback (no parent handler): persist locally.
        markMilestoneDone(donor.id, m.id);
        setRev(r => r + 1);
      }
    } finally {
      setPending(prev => { const n = new Set(prev); n.delete(m.id); return n; });
    }
  }, [donor.id, onApprove, pending]);

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
                  <button
                    className="touchpoint-approve"
                    onClick={() => handleApprove(m)}
                    disabled={pending.has(m.id)}
                    aria-busy={pending.has(m.id)}
                    title="Approve & send"
                  >
                    <Send size={11} /> {pending.has(m.id) ? 'Sending…' : 'Approve & Send'}
                  </button>
                )}
                {(m.state === 'due' || m.state === 'overdue' || m.state === 'upcoming') && (
                  <button
                    className="touchpoint-skip"
                    onClick={() => handleSkip(m)}
                    disabled={pending.has(m.id)}
                    title="Skip this touchpoint"
                  >
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
