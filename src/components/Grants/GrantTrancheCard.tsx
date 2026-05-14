import React from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Clock, Lock, Wallet } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { canReleaseTranche, type GrantTranche } from '../../utils/grantLifecycle';
import { formatINR } from '../../utils/programFinance';
import './GrantTrancheCard.css';

interface Props {
  grantId: string;
}

const STATUS_META: Record<GrantTranche['status'], { label: string; tone: string; Icon: any }> = {
  released:              { label: 'Released',              tone: '#16A34A', Icon: CheckCircle2 },
  awaiting_utilization:  { label: 'Awaiting utilization',  tone: '#D97706', Icon: Clock },
  scheduled:             { label: 'Scheduled',             tone: '#2563EB', Icon: Clock },
  blocked:               { label: 'Blocked by funder',     tone: '#DC2626', Icon: Lock },
};

const GrantTrancheCard: React.FC<Props> = ({ grantId }) => {
  const tranches = useStore(s => s.grantTranches.filter(t => t.grantId === grantId).sort((a,b) => a.number - b.number));
  const release  = useStore(s => s.releaseGrantTranche);
  const upsert   = useStore(s => s.upsertGrantTranche);

  const handleRelease = (t: GrantTranche) => {
    const check = canReleaseTranche(t, tranches);
    if (!check.ok) {
      toast.error(check.reason ?? 'Cannot release tranche.');
      return;
    }
    release(t.id);
    toast.success(`Tranche ${t.number} marked as released.`);
  };

  const handleSubmitUC = (t: GrantTranche) => {
    upsert({ ...t, utilizationReportId: `UC-${t.id}-${Date.now()}` });
    toast.success(`Utilization report attached to Tranche ${t.number}. You can now release.`);
  };

  if (tranches.length === 0) {
    return (
      <div className="grant-tranche-card grant-tranche-card--empty">
        <Wallet size={14} />
        <span>No tranches scheduled yet for this grant.</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => {
            const num = 1;
            upsert({
              id: `tr-${grantId}-${num}-${Date.now()}`,
              grantId,
              number: num,
              amount: 1_000_000,
              expectedDate: new Date(Date.now() + 30*86_400_000).toISOString().slice(0,10),
              status: 'scheduled',
            });
          }}
        >Add tranche</button>
      </div>
    );
  }

  return (
    <div className="grant-tranche-card">
      <div className="grant-tranche-card-header">
        <Wallet size={14} />
        <h4>Tranche release schedule</h4>
        <span className="grant-tranche-card-hint">Each tranche is gated by the prior utilization report.</span>
      </div>
      <ul className="grant-tranche-list">
        {tranches.map(t => {
          const meta = STATUS_META[t.status];
          const Icon = meta.Icon;
          const canRelease = canReleaseTranche(t, tranches);
          return (
            <li key={t.id} className="grant-tranche-row">
              <div className="grant-tranche-row-num" style={{ background: meta.tone }}>{t.number}</div>
              <div className="grant-tranche-row-main">
                <div className="grant-tranche-row-line1">
                  <strong>{formatINR(t.amount)}</strong>
                  <span className="grant-tranche-row-date">expected {t.expectedDate}</span>
                </div>
                <div className="grant-tranche-row-line2" style={{ color: meta.tone }}>
                  <Icon size={12} /> {meta.label}
                  {t.utilizationReportId && <span className="grant-tranche-row-uc">• UC attached</span>}
                </div>
              </div>
              <div className="grant-tranche-row-actions">
                {t.status === 'awaiting_utilization' && !t.utilizationReportId && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => handleSubmitUC(t)}>Submit UC</button>
                )}
                {t.status !== 'released' && (
                  <button
                    type="button"
                    className={`btn btn-xs ${canRelease.ok ? 'btn-primary' : 'btn-ghost'}`}
                    disabled={!canRelease.ok}
                    title={canRelease.reason}
                    onClick={() => handleRelease(t)}
                  >Release</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default GrantTrancheCard;
