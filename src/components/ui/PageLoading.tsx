import React from 'react';

/** Lightweight shell while lazy routes chunk-load. */
const PageLoading: React.FC = () => (
  <div className="page-loading" style={{ padding: 'var(--space-6)', maxWidth: 720, margin: '0 auto' }}>
    <div className="skeleton" style={{ height: 14, width: '38%', maxWidth: 280, marginBottom: 'var(--space-5)' }} />
    <div className="skeleton" style={{ height: 220, width: '100%', borderRadius: 'var(--radius-xl)' }} />
  </div>
);

export default PageLoading;
