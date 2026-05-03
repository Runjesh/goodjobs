import React from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import { useStore } from '../../store/useStore';
import {
  type ProgramBudget, classifyBudget, budgetUtilization, formatINR, programIdFromName,
} from '../../utils/programFinance';
import './ProgramBudgetBar.css';

interface Props {
  /** Program name as it appears on a beneficiary record. */
  programName: string;
  /** When true, show the "Set budget" CTA inline. */
  allowEdit?: boolean;
}

const HEALTH_META = {
  on_track:      { label: 'On track',      color: '#16A34A' },
  underspending: { label: 'Underspending', color: '#D97706' },
  overspending:  { label: 'Over budget',   color: '#DC2626' },
  no_budget:     { label: 'No budget',     color: '#6B7280' },
} as const;

const ProgramBudgetBar: React.FC<Props> = ({ programName, allowEdit }) => {
  const programId = programIdFromName(programName);
  const budget = useStore(s => s.programBudgets.find(b => b.programId === programId));
  const upsert = useStore(s => s.upsertProgramBudget);

  const health = budget ? classifyBudget(budget) : 'no_budget';
  const meta = HEALTH_META[health];
  const pct = budget ? budgetUtilization(budget) : 0;

  const promptForBudget = () => {
    const planned = Number(window.prompt(`Set planned budget for "${programName}" (INR):`, String(budget?.planned ?? 500000)));
    if (!Number.isFinite(planned) || planned <= 0) return;
    const next: ProgramBudget = budget
      ? { ...budget, planned }
      : { programId, label: programName, planned, spent: 0 };
    upsert(next);
  };

  if (!budget) {
    if (!allowEdit) return null;
    return (
      <button type="button" className="program-budget-bar program-budget-bar--empty" onClick={promptForBudget}>
        <Wallet size={12} /> Set budget
      </button>
    );
  }

  return (
    <div
      className="program-budget-bar"
      role="group"
      aria-label={`Budget for ${programName}: ${meta.label}`}
      onDoubleClick={allowEdit ? promptForBudget : undefined}
      title={allowEdit ? 'Double-click to edit' : undefined}
    >
      <div className="program-budget-bar-row">
        <span className="program-budget-bar-label">
          <Wallet size={11} /> {formatINR(budget.spent)} <span className="muted">/ {formatINR(budget.planned)}</span>
        </span>
        <span className="program-budget-bar-status" style={{ color: meta.color }}>
          {health === 'underspending' && <AlertTriangle size={11} />}
          {meta.label}
        </span>
      </div>
      <div className="program-budget-bar-track">
        <div
          className="program-budget-bar-fill"
          style={{ width: `${Math.min(100, pct * 100)}%`, background: meta.color }}
        />
      </div>
      {health === 'underspending' && budget.restricted && (
        <div className="program-budget-bar-alert">
          Restricted-grant program is behind schedule — risk of tranche clawback by {budget.windowEnd}.
        </div>
      )}
    </div>
  );
};

export default ProgramBudgetBar;
