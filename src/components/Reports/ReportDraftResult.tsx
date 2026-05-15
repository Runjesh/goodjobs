import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { RefreshCw, ExternalLink } from 'lucide-react';
import type { DraftSectionSource } from '../../utils/reportReadiness';

export interface SectionRow {
  id: string;
  title: string;
  preview: string;
  source: DraftSectionSource;
}

interface Props {
  reportTitle: string;
  sections: SectionRow[];
  onRefreshSection: (sectionId: string) => void;
  refreshingId: string | null;
}

const ReportDraftResult: React.FC<Props> = ({
  reportTitle,
  sections,
  onRefreshSection,
  refreshingId,
}) => (
  <motion.div
    className="reports-draft-result"
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
  >
    <h3 className="reports-draft-result-title">AI draft — {reportTitle}</h3>
    <p className="reports-draft-result-sub">
      Each section is tied to live data. Refresh a section after you fix missing prerequisites.
    </p>
    <div className="reports-draft-sections">
      {sections.map(sec => (
        <article key={sec.id} className="reports-draft-section-card">
          <header>
            <h4>{sec.title}</h4>
            <span className="reports-source-chip">{sec.source.sourceLabel}</span>
          </header>
          <p className="reports-draft-preview">{sec.preview}</p>
          <motion.div className="reports-draft-section-actions">
            <button
              type="button"
              className="reports-btn-secondary"
              disabled={refreshingId === sec.id}
              onClick={() => onRefreshSection(sec.id)}
            >
              <RefreshCw size={13} className={refreshingId === sec.id ? 'spin' : ''} />
              {refreshingId === sec.id ? 'Refreshing…' : 'Refresh from latest data'}
            </button>
            {sec.source.sourcePath && (
              <Link className="reports-readiness-fix" to={sec.source.sourcePath}>
                Open source <ExternalLink size={11} />
              </Link>
            )}
          </motion.div>
        </article>
      ))}
    </div>
  </motion.div>
);

export default ReportDraftResult;
