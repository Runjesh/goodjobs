import React, { useEffect, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import { wasMockEverUsed } from '../../api/mockBackend';
import './DemoModePill.css';

const DISMISS_KEY = 'goodjobs.demo_pill_dismissed';

const DemoModePill: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const tick = () => {
      let dismissed = false;
      try { dismissed = !!localStorage.getItem(DISMISS_KEY); } catch { /* ignore */ }
      setVisible(wasMockEverUsed() && !dismissed);
    };
    tick();
    // Re-check every few seconds so the pill appears the moment any apiFetch
    // falls back to the mock backend, without forcing every page to
    // synchronously notify us.
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, []);

  if (!visible) return null;

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  };

  return (
    <div
      className={`demo-mode-pill ${expanded ? 'is-expanded' : ''}`}
      onClick={() => setExpanded(v => !v)}
      role="status"
      title="Demo mode — actions save locally to your browser"
    >
      <FlaskConical size={12} />
      <span className="demo-mode-pill-label">Demo mode</span>
      {expanded && (
        <>
          <span className="demo-mode-pill-detail">
            Backend not connected — your actions are saved locally to this
            browser. Connect a server to sync across devices.
          </span>
          <button
            className="demo-mode-pill-dismiss"
            onClick={dismiss}
            aria-label="Dismiss demo-mode notice"
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
};

export default DemoModePill;
