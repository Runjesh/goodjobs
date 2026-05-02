import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sun, Cpu, Wallet, ClipboardList, ShieldCheck,
  ArrowRight, ArrowLeft, X, CheckCircle2, Sparkles,
} from 'lucide-react';
import { useAuth, type UserRole } from '../../context/AuthContext';
import { ModalOverlay } from '../ui/ModalOverlay';
import './Onboarding.css';

const STORAGE_KEY = 'gj_welcomed_v1';

function hasSeenWelcome(userId: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return !!seen[userId];
  } catch {
    return false;
  }
}

function markWelcomeSeen(userId: string) {
  try {
    const seen = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    seen[userId] = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

interface Slide {
  icon: React.ElementType;
  color: string;
  title: string;
  body: string;
  bullets: string[];
}

const SLIDES_BY_ROLE: Record<UserRole, Slide[]> = {
  ed: [
    {
      icon: Sun,
      color: '#0F766E',
      title: 'Welcome to your nonprofit\'s control room',
      body: 'GoodJobs brings everything your NGO does — Programs, Funding, Compliance, Reports — into one calm dashboard.',
      bullets: [
        'See what needs your attention each morning',
        'Approve agent actions in one click',
        'Get sector-benchmarked insights for your board',
      ],
    },
    {
      icon: Cpu,
      color: '#6366f1',
      title: 'Your AI Copilot does the busywork',
      body: 'Instead of you doing repetitive tasks, GoodJobs Copilot drafts, files, and follows up — you just approve.',
      bullets: [
        'Auto-draft funder reports from live program data',
        'Generate 80G receipts the moment a donation lands',
        'Send WhatsApp follow-ups to lapsed donors',
      ],
    },
    {
      icon: ShieldCheck,
      color: '#16A34A',
      title: 'Setup takes about 5 minutes',
      body: 'You\'ll see a "Get Started" checklist on your Today screen. Complete the steps in any order — your data stays safe inside India (DPDP-compliant).',
      bullets: [
        'Add a few beneficiaries and donors (or import a CSV)',
        'Upload your 12A, 80G, FCRA documents',
        'Invite your team — every role sees the right things',
      ],
    },
  ],
  finance: [
    {
      icon: Sun,
      color: '#0F766E',
      title: 'Welcome, Finance Officer',
      body: 'Everything you need for fund accounting, FCRA monitoring, and 80G receipts in one place.',
      bullets: [
        'Real-time FCRA admin overhead gauge',
        '80G receipts auto-generated for every donation',
        'Tally Prime export when you need it',
      ],
    },
    {
      icon: Wallet,
      color: '#0F766E',
      title: 'Stay audit-ready every day',
      body: 'GoodJobs tracks compliance deadlines and reconciles donations to bank statements automatically.',
      bullets: [
        'Bank reconciliation via Account Aggregator',
        'FCRA quarterly returns drafted from live data',
        'Receipt issued in Hindi/English with one click',
      ],
    },
    {
      icon: ShieldCheck,
      color: '#16A34A',
      title: 'Quick setup',
      body: 'The checklist on your Today screen will guide you through connecting your accounts and uploading docs.',
      bullets: [
        'Upload 12A, 80G, FCRA registration',
        'Link your bank account (read-only)',
        'Import past donations as CSV',
      ],
    },
  ],
  programs: [
    {
      icon: Sun,
      color: '#0F766E',
      title: 'Welcome, Program Manager',
      body: 'Manage beneficiaries, log services, and generate impact reports — without spreadsheets.',
      bullets: [
        'Beneficiary list with attention-first sorting',
        'Field staff log via WhatsApp — auto-structured',
        'Theory of Change → outputs → outcomes mapped',
      ],
    },
    {
      icon: ClipboardList,
      color: '#0F766E',
      title: 'WhatsApp-first data entry',
      body: 'Your field staff send a message in plain English/Hindi. The MIS Agent extracts beneficiary, service type, date, and outcome.',
      bullets: [
        'No app to install for field workers',
        'Ambiguous entries flagged for your review',
        'Bulk import existing records via CSV',
      ],
    },
    {
      icon: ShieldCheck,
      color: '#16A34A',
      title: 'Get started in minutes',
      body: 'Start with a few beneficiaries to see how the system feels. The checklist on Today will guide you.',
      bullets: [
        'Add or import your beneficiary list',
        'Define your Theory of Change',
        'Build your service-logging form',
      ],
    },
  ],
  field: [
    {
      icon: Sun,
      color: '#0F766E',
      title: 'Welcome to the field portal',
      body: 'Log attendance and service notes from your phone. Works offline — syncs when you have signal.',
      bullets: [
        'Quick check-in for beneficiaries',
        'Voice-to-text for English/Hindi notes',
        'Photos auto-attached to records',
      ],
    },
    {
      icon: ClipboardList,
      color: '#0F766E',
      title: 'WhatsApp also works',
      body: 'You can send a normal WhatsApp message describing what happened. The system understands plain language.',
      bullets: [
        '"Met Lakshmi today, gave nutrition kit, family of 4"',
        'No forms to fill in unless you want to',
        'Ambiguous bits get a quick yes/no clarification',
      ],
    },
    {
      icon: ShieldCheck,
      color: '#16A34A',
      title: 'Your data is safe',
      body: 'Beneficiary names and IDs are masked. Aadhaar is never stored fully. Your supervisor sees only what you submit.',
      bullets: [
        'Works on any phone — no special app',
        'Data stays in India (DPDP-compliant)',
        'You can edit a record up to 24 hours after',
      ],
    },
  ],
  board: [
    {
      icon: Sun,
      color: '#0F766E',
      title: 'Welcome, Board Member',
      body: 'A read-only view of your NGO\'s health — programs, funding, compliance — refreshed live.',
      bullets: [
        'Quarterly impact at a glance',
        'Sector-benchmarked KPIs',
        'Funder-ready report exports',
      ],
    },
    {
      icon: Cpu,
      color: '#6366f1',
      title: 'Insights, not raw data',
      body: 'GoodJobs interprets the numbers in plain language so you can focus on direction, not data hygiene.',
      bullets: [
        '"What the data means" panel on every chart',
        'Trends vs. last quarter and sector average',
        'One-click export to PDF for board packs',
      ],
    },
    {
      icon: ShieldCheck,
      color: '#16A34A',
      title: 'Nothing to set up',
      body: 'Your Executive Director has already configured access. Head to Insights or Reports to get started.',
      bullets: [
        'Insights → KPIs and trends',
        'Reports → drafts ready for your review',
        'Today → what the team is working on',
      ],
    },
  ],
};

interface Props {
  onClose?: () => void;
}

const WelcomeModal: React.FC<Props> = ({ onClose }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (!hasSeenWelcome(user.id)) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [user]);

  if (!user || !open) return null;

  const slides = SLIDES_BY_ROLE[user.role] || SLIDES_BY_ROLE.ed;
  const slide = slides[slideIdx];
  const isLast = slideIdx === slides.length - 1;
  const Icon = slide.icon;

  const handleClose = () => {
    if (user) markWelcomeSeen(user.id);
    setOpen(false);
    onClose?.();
  };

  const handleNext = () => {
    if (isLast) {
      handleClose();
    } else {
      setSlideIdx((i) => i + 1);
    }
  };

  return (
    <ModalOverlay onBackdropClick={handleClose} elevated>
      <motion.div
        className="onboarding-modal"
        role="dialog"
        aria-labelledby="welcome-title"
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="onboarding-close"
          onClick={handleClose}
          aria-label="Skip welcome and close"
        >
          <X size={18} />
        </button>

        <div className="onboarding-illustration" style={{ background: `${slide.color}14` }}>
          <div className="onboarding-icon-wrap" style={{ background: slide.color }}>
            <Icon size={36} color="#fff" />
          </div>
          <Sparkles className="onboarding-sparkle onboarding-sparkle-1" size={16} color={slide.color} />
          <Sparkles className="onboarding-sparkle onboarding-sparkle-2" size={12} color={slide.color} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={slideIdx}
            className="onboarding-body"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <h2 id="welcome-title" className="onboarding-title">{slide.title}</h2>
            <p className="onboarding-text">{slide.body}</p>
            <ul className="onboarding-bullets">
              {slide.bullets.map((b, i) => (
                <li key={i}>
                  <CheckCircle2 size={15} color={slide.color} /> <span>{b}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>

        <div className="onboarding-footer">
          <div className="onboarding-dots" role="tablist" aria-label="Welcome slides">
            {slides.map((_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === slideIdx}
                aria-label={`Go to slide ${i + 1}`}
                className={`onboarding-dot ${i === slideIdx ? 'is-active' : ''}`}
                onClick={() => setSlideIdx(i)}
              />
            ))}
          </div>
          <div className="onboarding-actions">
            {slideIdx > 0 && (
              <button className="onboarding-btn-secondary" onClick={() => setSlideIdx((i) => i - 1)}>
                <ArrowLeft size={14} /> Back
              </button>
            )}
            <button className="onboarding-btn-primary" onClick={handleNext}>
              {isLast ? 'Let\'s get started' : 'Next'} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </motion.div>
    </ModalOverlay>
  );
};

export default WelcomeModal;
