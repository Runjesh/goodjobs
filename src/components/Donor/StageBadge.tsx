import React from 'react';
import { STAGE_META, type LifecycleStage } from '../../utils/donorLifecycle';
import './StageBadge.css';

interface Props {
  stage: LifecycleStage;
  size?: 'xs' | 'sm' | 'md';
  pulse?: boolean;
  showLabel?: boolean;
  className?: string;
}

const StageBadge: React.FC<Props> = ({ stage, size = 'sm', pulse, showLabel = true, className }) => {
  const meta = STAGE_META[stage] || STAGE_META.unknown;
  const shouldPulse = pulse ?? stage === 'lapse_risk';
  return (
    <span
      className={`stage-badge stage-badge--${size}${shouldPulse ? ' stage-badge--pulse' : ''}${className ? ' ' + className : ''}`}
      style={{ color: meta.color, background: meta.bg, borderColor: `${meta.color}40` }}
      title={meta.description}
    >
      <span className="stage-badge-dot" style={{ background: meta.color }} />
      {showLabel && <span className="stage-badge-label">{meta.label}</span>}
    </span>
  );
};

export default StageBadge;
