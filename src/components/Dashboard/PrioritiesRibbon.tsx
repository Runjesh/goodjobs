import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, X, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import type { Task } from '../../utils/tasks';

export interface BriefPriorityCard {
  id: string;
  title: string;
  summary: string;
  priority: 'High' | 'Medium' | 'Low' | string;
  category?: string;
  primaryLabel: string;
  path: string;
  tasksDeepLink?: string;
  kind?: string;
}

interface PrioritiesRibbonProps {
  cards: BriefPriorityCard[];
  loading?: boolean;
  onDismiss: (card: BriefPriorityCard) => void;
}

const PRIORITY_STYLES: Record<string, { border: string; bg: string; accent: string }> = {
  High:   { border: '#fecaca', bg: '#fef2f2', accent: '#DC2626' },
  Medium: { border: '#fde68a', bg: '#fffbeb', accent: '#D97706' },
  Low:    { border: '#bbf7d0', bg: '#f0fdf4', accent: '#16A34A' },
};

const PrioritiesRibbon: React.FC<PrioritiesRibbonProps> = ({ cards, loading, onDismiss }) => {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const upsertTaskByIntent = useStore(s => s.upsertTaskByIntent);

  const scroll = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' });
  };

  const handleDismiss = (card: BriefPriorityCard) => {
    const now = new Date().toISOString();
    const task: Task = {
      id: `brief-dismiss:${card.id}`,
      title: card.title,
      description: card.summary,
      priority: card.priority === 'High' ? 'high' : 'normal',
      status: 'open',
      sourceType: 'inbox',
      sourceIntentId: `morning-brief:${card.id}`,
      dueAt: now,
      createdAt: now,
      updatedAt: now,
      meta: {
        link: card.tasksDeepLink || card.path,
        briefKind: card.kind,
        dismissedFromRibbon: true,
      },
    };
    upsertTaskByIntent(task);
    onDismiss(card);
    toast('Moved to Tasks inbox', { icon: '📥', duration: 2200 });
  };

  if (loading && cards.length === 0) {
    return (
      <motion.div className="priorities-ribbon priorities-ribbon--loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span className="priorities-ribbon-label">Your priorities</span>
        <div className="priorities-ribbon-skeleton" />
      </motion.div>
    );
  }

  if (cards.length === 0) return null;

  return (
    <motion.section
      className="priorities-ribbon"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-label="Today's priorities"
    >
      <div className="priorities-ribbon-head">
        <span className="priorities-ribbon-label">Your priorities</span>
        <span className="priorities-ribbon-hint">Swipe · dismiss sends to inbox</span>
        <div className="priorities-ribbon-nav">
          <button type="button" className="priorities-ribbon-nav-btn" onClick={() => scroll(-1)} aria-label="Scroll left">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="priorities-ribbon-nav-btn" onClick={() => scroll(1)} aria-label="Scroll right">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="priorities-ribbon-track" ref={scrollRef}>
        <AnimatePresence mode="popLayout">
          {cards.map((card, i) => {
            const pr = String(card.priority || 'Medium');
            const style = PRIORITY_STYLES[pr] ?? PRIORITY_STYLES.Medium;
            return (
              <motion.article
                key={card.id}
                className="priority-card"
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92, width: 0, marginRight: 0, padding: 0 }}
                transition={{ delay: i * 0.03 }}
                style={{ borderColor: style.border, background: style.bg }}
              >
                {card.category && (
                  <span className="priority-card-category" style={{ color: style.accent }}>{card.category}</span>
                )}
                <h3 className="priority-card-title">{card.title}</h3>
                <p className="priority-card-summary">{card.summary}</p>
                <div className="priority-card-actions">
                  <button
                    type="button"
                    className="priority-card-cta"
                    style={{ color: style.accent }}
                    onClick={() => navigate(card.path)}
                  >
                    {card.primaryLabel} <ArrowRight size={13} />
                  </button>
                  <button
                    type="button"
                    className="priority-card-dismiss"
                    onClick={() => handleDismiss(card)}
                    aria-label="Dismiss to inbox"
                    title="Dismiss — keeps in Tasks inbox"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.section>
  );
};

export default PrioritiesRibbon;
