import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, UserPlus, IndianRupee, ShieldCheck, Mail, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './CommandPalette.css';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAction = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <div className={`command-palette-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}>
      <div className="command-palette-container" onClick={e => e.stopPropagation()}>
        <div className="palette-header">
          <Search size={20} color="var(--color-text-secondary)" />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Ask SevaSuite or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="palette-badge">
            <Sparkles size={12} color="#8b5cf6" /> AI Powered
          </div>
        </div>

        <div className="palette-body">
          {query.length > 2 ? (
            <div className="suggestion-group">
              <div className="suggestion-group-title">AI Actions</div>
              <div className="suggestion-item" onClick={() => handleAction('/fundraising')}>
                <div className="suggestion-icon"><IndianRupee size={16} /></div>
                <div className="suggestion-text">Log a donation for "{query}"</div>
                <ArrowRight size={14} className="suggestion-hint" />
              </div>
              <div className="suggestion-item" onClick={() => handleAction('/crm')}>
                <div className="suggestion-icon"><Search size={16} /></div>
                <div className="suggestion-text">Search donor CRM for "{query}"</div>
                <ArrowRight size={14} className="suggestion-hint" />
              </div>
            </div>
          ) : (
            <>
              <div className="suggestion-group">
                <div className="suggestion-group-title">Quick Actions</div>
                <div className="suggestion-item" onClick={() => handleAction('/fundraising')}>
                  <div className="suggestion-icon"><IndianRupee size={16} /></div>
                  <div className="suggestion-text">Log a New Donation</div>
                  <div className="suggestion-hint">Fundraising</div>
                </div>
                <div className="suggestion-item" onClick={() => handleAction('/crm')}>
                  <div className="suggestion-icon"><UserPlus size={16} /></div>
                  <div className="suggestion-text">Add a New Donor</div>
                  <div className="suggestion-hint">CRM</div>
                </div>
                <div className="suggestion-item" onClick={() => handleAction('/agent-hq')}>
                  <div className="suggestion-icon"><Mail size={16} /></div>
                  <div className="suggestion-text">Draft Campaign Email</div>
                  <div className="suggestion-hint">Agent HQ</div>
                </div>
              </div>

              <div className="suggestion-group">
                <div className="suggestion-group-title">Compliance & Finance</div>
                <div className="suggestion-item" onClick={() => handleAction('/finance')}>
                  <div className="suggestion-icon"><ShieldCheck size={16} /></div>
                  <div className="suggestion-text">Check FCRA Limit Status</div>
                  <div className="suggestion-hint">Finance</div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="palette-footer">
          <div><kbd>esc</kbd> to close</div>
          <div><kbd>↑</kbd> <kbd>↓</kbd> to navigate</div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
