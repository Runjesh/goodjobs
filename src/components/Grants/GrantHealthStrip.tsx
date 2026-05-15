import React from 'react';
import { Wallet, CalendarClock, ShieldAlert, Users, Target } from 'lucide-react';
import type { GrantHealthMetrics } from '../../utils/grantHealthMetrics';

interface Props {
  metrics: GrantHealthMetrics;
  onRecordSpend: () => void;
  onUpdateProgress: () => void;
  onDraftReport: () => void;
}

function toneForDays(days: number | null): 'ok' | 'warn' | 'miss' {
  if (days === null) return 'warn';
  if (days < 0) return 'miss';
  if (days <= 14) return 'warn';
  return 'ok';
}

function toneForPct(pct: number, over = 100): 'ok' | 'warn' | 'miss' {
  if (pct > over) return 'miss';
  if (pct > 85) return 'warn';
  return 'ok';
}

const GrantHealthStrip: React.FC<Props> = ({
  metrics: m,
  onRecordSpend,
  onUpdateProgress,
  onDraftReport,
}) => {
  const budgetTone = toneForPct(m.budgetUtilisedPct);
  const reportTone = toneForDays(m.daysToNextReport);
  const complianceTone = m.complianceMissing > 0 ? 'miss' : 'ok';
  const outcomeTone = m.outcomeReadinessPct >= 50 ? 'ok' : m.outcomeReadinessPct >= 25 ? 'warn' : 'miss';

  return (
    <section className="grant-health-strip" aria-label="Grant health">
      <div className="grant-health-grid">
        <HealthCell
          icon={<Wallet size={15} />}
          label="Budget utilised"
          value={`${m.budgetUtilisedPct}%`}
          sub={m.budgetLabel}
          tone={budgetTone}
        />
        <HealthCell
          icon={<CalendarClock size={15} />}
          label="Days to next report"
          value={m.daysToNextReport === null ? '—' : String(m.daysToNextReport)}
          sub={m.nextReportDue ? `Due ${m.nextReportDue}` : 'Set reporting cadence'}
          tone={reportTone}
        />
        <HealthCell
          icon={<ShieldAlert size={15} />}
          label="Compliance"
          value={m.complianceMissing === 0 ? 'Clear' : `${m.complianceMissing} missing`}
          sub={m.complianceLabel}
          tone={complianceTone}
        />
        <HealthCell
          icon={<Users size={15} />}
          label="Beneficiaries reached"
          value={String(m.beneficiariesReached)}
          sub="Linked programmes"
          tone={m.beneficiariesReached > 0 ? 'ok' : 'warn'}
        />
        <HealthCell
          icon={<Target size={15} />}
          label="Outcome readiness"
          value={`${m.outcomeReadinessPct}%`}
          sub={m.outcomeLabel}
          tone={outcomeTone}
        />
      </div>
      <div className="grant-health-actions">
        <button type="button" className="btn btn-primary" onClick={onRecordSpend}>
          <Wallet size={14} /> Record spend
        </button>
        <button type="button" className="btn btn-secondary" onClick={onUpdateProgress}>
          <Target size={14} /> Update progress
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDraftReport}>
          <CalendarClock size={14} /> Draft report
        </button>
      </div>
    </section>
  );
};

function HealthCell({
  icon, label, value, sub, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn' | 'miss';
}) {
  return (
    <div className={`grant-health-cell grant-health-cell--${tone}`}>
      <div className="grant-health-cell-icon">{icon}</div>
      <div>
        <div className="grant-health-cell-label">{label}</div>
        <div className="grant-health-cell-value">{value}</div>
        <div className="grant-health-cell-sub">{sub}</div>
      </div>
    </div>
  );
}

export default GrantHealthStrip;
