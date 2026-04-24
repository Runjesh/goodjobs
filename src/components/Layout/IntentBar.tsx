import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ArrowRight, X, Loader2, MessageSquare, Send } from 'lucide-react';
import ActionCard from '../Common/ActionCard';
import toast from 'react-hot-toast';

const IntentBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [resultCard, setResultCard] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleProcessIntent = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsProcessing(true);
    setShowResults(true);
    
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://localhost:8000/intent/process?directive=${encodeURIComponent(query)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        setResultCard(data);
      } else {
        toast.error("Agent encountered a routing error.");
      }
    } catch (err) {
      toast.error("Could not reach Agent Intelligence.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setShowResults(false);
    setResultCard(null);
  };

  return (
    <div className="intent-bar-wrapper" style={{ 
      maxWidth: '800px', 
      margin: '0 auto', 
      width: '100%', 
      position: 'relative',
      zIndex: 50
    }}>
      <form onSubmit={handleProcessIntent} style={{ position: 'relative' }}>
        <div style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: '0.5rem 0.5rem 0.5rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          boxShadow: 'var(--shadow-lg)',
          transition: 'border-color 0.2s, box-shadow 0.2s',
          ...(isProcessing ? { borderColor: 'var(--color-primary)' } : {})
        }}>
          <Sparkles size={18} className={isProcessing ? 'animate-pulse text-primary' : 'text-tertiary'} />
          <input
            ref={inputRef}
            type="text"
            className="intent-input"
            placeholder="Type an intention... e.g. 'Draft Tata Trusts report' or 'Add Meera Joshi ₹5k'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: '0.9375rem',
              color: 'var(--color-text-primary)',
              padding: '0.5rem 0'
            }}
          />
          {query && (
            <button type="button" onClick={handleClear} className="action-btn">
              <X size={16} />
            </button>
          )}
          <button 
            type="submit" 
            disabled={!query || isProcessing}
            className="btn btn-primary"
            style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-lg)' }}
          >
            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          </button>
        </div>
      </form>

      {showResults && (
        <div className="intent-results" style={{
          position: 'absolute',
          top: 'calc(100% + 1rem)',
          left: 0,
          right: 0,
          background: 'rgba(var(--color-bg-main-rgb), 0.95)',
          backdropFilter: 'blur(12px)',
          borderRadius: 'var(--radius-xl)',
          padding: '1.5rem',
          boxShadow: 'var(--shadow-2xl)',
          border: '1px solid var(--color-border)',
          animation: 'slideUp 0.3s ease-out'
        }}>
          {isProcessing ? (
            <div className="flex flex-col items-center py-8 text-tertiary">
              <Loader2 size={32} className="animate-spin mb-3 text-primary" />
              <p style={{ fontSize: '0.875rem' }}>Analyzing directive and extracting context...</p>
            </div>
          ) : resultCard ? (
            <div>
              <div className="flex justify-between items-center mb-4">
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>AGENT PROPOSAL</span>
                <button onClick={handleClear} style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }} className="flex items-center gap-1">
                  Dismiss <X size={12} />
                </button>
              </div>
              <ActionCard
                status="awaiting"
                title={resultCard.summary}
                category={resultCard.intent_type}
                summary={`Risk Level: ${resultCard.risk_level}. Ready to execute based on extracted context: ${JSON.stringify(resultCard.action_data)}`}
                onApprove={() => {
                  toast.success("Executing directive...");
                  handleClear();
                }}
                onEdit={() => toast("Opening structured editor...")}
                onReject={() => handleClear()}
              />
            </div>
          ) : (
            <div className="text-center py-8">
              <MessageSquare size={32} className="mx-auto mb-3 text-tertiary" />
              <p style={{ color: 'var(--color-text-secondary)' }}>I'm ready. Type a directive above.</p>
            </div>
          )}
        </div>
      )}

      <style>{`
        .intent-input::placeholder {
          color: var(--color-text-tertiary);
          opacity: 0.7;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default IntentBar;
