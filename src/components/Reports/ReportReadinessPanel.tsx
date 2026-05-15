import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import type { ReportReadinessResult } from '../../utils/reportReadiness';

interface Props {
  readiness: ReportReadinessResult;
  compact?: boolean;
}

const ReportReadinessPanel: React.FC<Props> = ({ readiness, compact }) => {
  const navigate = useNavigate();
  const tone = readiness.isReady ? 'ready' : readiness.missingCount <= 2 ? 'warn' : 'block';

  return (
    <motion.div
      className={`reports-readiness-panel reports-readiness-panel--${tone}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <motion.div className="reports-readiness-panel-header">
        {readiness.isReady ? (
          <CheckCircle2 size={18} color="var(--color-success)" />
        ) : (
          <AlertCircle size={18} color={tone === 'block' ? 'var(--color-danger)' : 'var(--color-warning)'} />
        )}
        <div>
          <strong>{readiness.readyLabel}</strong>
          <span className="reports-readiness-pct">{readiness.pct}% prerequisites met</span>
        </div>
      </motion.div>
      <ul className={`reports-readiness-list ${compact ? 'compact' : ''}`}>
        {readiness.items.map(item => (
          <li key={item.id} className={item.met ? 'met' : 'miss'}>
            <span className="reports-readiness-check">{item.met ? '✓' : '○'}</span>
            <span className="reports-readiness-label">{item.label}</span>
            {!item.met && (
              <button
                type="button"
                className="reports-readiness-fix"
                onClick={() => navigate(item.fixPath)}
              >
                {item.fixLabel} <ArrowRight size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </motion.div>
  );
};

export default ReportReadinessPanel;
