import React from 'react';
import { ArrowRight } from 'lucide-react';
import './EmptyStateCTA.css';

interface Props {
  title: string;
  description?: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  icon?: React.ReactNode;
}

const EmptyStateCTA: React.FC<Props> = ({
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  icon,
}) => (
  <div className="empty-state-cta">
    {icon && <div className="empty-state-cta-icon">{icon}</div>}
    <p className="empty-state-cta-title">{title}</p>
    {description && <p className="empty-state-cta-desc">{description}</p>}
    <div className="empty-state-cta-actions">
      <button type="button" className="btn btn-primary" onClick={onAction}>
        {actionLabel} <ArrowRight size={14} />
      </button>
      {secondaryLabel && onSecondary && (
        <button type="button" className="btn btn-secondary" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      )}
    </div>
  </div>
);

export default EmptyStateCTA;
