import React from 'react';
import { Activity, TrendingUp, Users } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { aggregateByProgram } from '../../utils/outcomes';
import './OutcomesAggregateCard.css';

const OutcomesAggregateCard: React.FC = () => {
  const records = useStore(s => s.beneficiaryOutcomes);
  const aggregates = aggregateByProgram(records);

  return (
    <div className="outcomes-card">
      <div className="outcomes-card-header">
        <div className="outcomes-card-icon"><Activity size={16} /></div>
        <h3>Programme outcomes</h3>
        <span className="outcomes-card-badge">Output → outcome</span>
      </div>

      {aggregates.length === 0 ? (
        <div className="outcomes-card-empty">
          No outcomes recorded yet. Open <strong>Programs</strong> → click any beneficiary's <em>Record outcome</em> button to start the loop.
        </div>
      ) : (
        <>
          <div className="outcomes-card-summary">
            <div className="outcomes-card-summary-cell">
              <div className="outcomes-card-summary-label">Beneficiaries measured</div>
              <div className="outcomes-card-summary-value">
                <Users size={14} /> {new Set(records.map(r => r.beneficiaryId)).size}
              </div>
            </div>
            <div className="outcomes-card-summary-cell">
              <div className="outcomes-card-summary-label">Records</div>
              <div className="outcomes-card-summary-value">{records.length}</div>
            </div>
            <div className="outcomes-card-summary-cell">
              <div className="outcomes-card-summary-label">Programmes covered</div>
              <div className="outcomes-card-summary-value">{aggregates.length}</div>
            </div>
          </div>

          <table className="outcomes-card-table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>People</th>
                <th>Avg change</th>
                <th>Outcome ratio</th>
                <th>SROI score</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.map(a => {
                const positive = a.avgImprovementPct >= 0;
                return (
                  <tr key={a.programId}>
                    <td>{a.programId.replace(/-/g, ' ')}</td>
                    <td>{a.beneficiaryCount}</td>
                    <td style={{ color: positive ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                      <TrendingUp size={11} style={{ transform: positive ? 'none' : 'rotate(180deg)' }} />{' '}
                      {Math.abs(a.avgImprovementPct).toFixed(1)}%
                    </td>
                    <td>{(a.outcomeRatio * 100).toFixed(0)}%</td>
                    <td><strong>{a.sroiScore.toFixed(1)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

export default OutcomesAggregateCard;
