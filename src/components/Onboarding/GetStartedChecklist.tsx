import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Circle, ChevronRight, X, Sparkles,
  Users, HeartHandshake, ShieldCheck, Megaphone, UserPlus,
  Building2, MessageCircle, FileText,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import {
  loadWizardState, checklistFollowupSteps, type WizardStepId,
} from '../../utils/wizard';
import './Onboarding.css';

// Map wizard-step ids to checklist row appearance.
const WIZARD_STEP_VISUALS: Record<WizardStepId, { icon: React.ElementType; color: string; label: string; cta: string }> = {
  'org-profile':           { icon: Building2,     color: '#0F766E', label: 'Finish your org profile',    cta: 'Open Settings' },
  'first-program':         { icon: FileText,      color: '#0F766E', label: 'Add your first program',     cta: 'Open Programs' },
  'invite-team':           { icon: UserPlus,      color: '#d97706', label: 'Invite your team',           cta: 'Open Settings' },
  'import-beneficiaries':  { icon: Users,         color: '#0F766E', label: 'Import beneficiaries',       cta: 'Open Programs' },
  'connect-whatsapp':      { icon: MessageCircle, color: '#16A34A', label: 'Connect WhatsApp',           cta: 'Open Settings' },
};

const DISMISS_KEY = 'gj_setup_dismissed_v1';
const STEP_DONE_KEY = 'gj_setup_steps_done_v1';

function isDismissed(userId: string): boolean {
  try {
    const m = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
    return !!m[userId];
  } catch {
    return false;
  }
}

function markDismissed(userId: string) {
  try {
    const m = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
    m[userId] = Date.now();
    localStorage.setItem(DISMISS_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

function getStepDoneMap(userId: string): Record<string, boolean> {
  try {
    const m = JSON.parse(localStorage.getItem(STEP_DONE_KEY) || '{}');
    return m[userId] || {};
  } catch {
    return {};
  }
}

function markStepDone(userId: string, stepId: string) {
  try {
    const m = JSON.parse(localStorage.getItem(STEP_DONE_KEY) || '{}');
    m[userId] = { ...(m[userId] || {}), [stepId]: true };
    localStorage.setItem(STEP_DONE_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

interface Step {
  id: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  color: string;
  done: boolean;
  path: string;
  cta: string;
}

const GetStartedChecklist: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { beneficiaries, donors, campaigns, complianceDocs } = useStore();

  const [hidden, setHidden] = useState<boolean>(() =>
    user ? isDismissed(user.id) : false
  );

  const [manualDone, setManualDone] = useState<Record<string, boolean>>(() =>
    user ? getStepDoneMap(user.id) : {}
  );

  const handleCtaClick = (stepId: string, path: string) => {
    if (user) {
      markStepDone(user.id, stepId);
      setManualDone((prev) => ({ ...prev, [stepId]: true }));
    }
    navigate(path);
  };

  // Surface wizard steps the user explicitly skipped (or that remained when
  // they finished early via "Skip setup"). Treated as additional checklist rows
  // so nothing the wizard asked for falls through the cracks.
  const wizardFollowups = useMemo(() => {
    if (!user) return [];
    return checklistFollowupSteps(loadWizardState(user.id));
  }, [user]);

  const steps: Step[] = useMemo(() => {
    const baseSteps: Step[] = [
      {
        id: 'beneficiary',
        label: 'Add your first beneficiary',
        hint: 'Enter one person or import a CSV — about 1 minute',
        icon: Users,
        color: '#0F766E',
        done: beneficiaries.length > 0,
        path: '/programs',
        cta: 'Open Programs',
      },
      {
        id: 'donor',
        label: 'Add your first donor',
        hint: 'Track giving history and send 80G receipts',
        icon: HeartHandshake,
        color: '#0F766E',
        done: donors.length > 0,
        path: '/funding',
        cta: 'Open Funding',
      },
      {
        id: 'campaign',
        label: 'Create your first campaign',
        hint: 'Get a public donation link to share',
        icon: Megaphone,
        color: '#6366f1',
        done: campaigns.length > 0,
        path: '/funding',
        cta: 'Create Campaign',
      },
      {
        id: 'compliance',
        label: 'Upload your compliance documents',
        hint: '12A, 80G, FCRA — keeps you audit-ready',
        icon: ShieldCheck,
        color: '#16A34A',
        done: complianceDocs.length > 0,
        path: '/compliance',
        cta: 'Open Compliance',
      },
      {
        id: 'team',
        label: 'Invite a team member',
        hint: 'Each role sees only what they need',
        icon: UserPlus,
        color: '#d97706',
        done: !!manualDone.team,
        path: '/settings',
        cta: 'Open Settings',
      },
    ];

    // Wizard steps surface as their own rows (deduped against base ids if a
    // matching base step already covers the same ground, e.g. team/import).
    const baseCovers: Partial<Record<WizardStepId, string>> = {
      'invite-team': 'team',
      'import-beneficiaries': 'beneficiary',
    };

    const wizardRows: Step[] = wizardFollowups
      .filter((meta) => {
        const baseId = baseCovers[meta.id];
        if (!baseId) return true;
        const baseStep = baseSteps.find((s) => s.id === baseId);
        // If the user actually did the equivalent base action, hide the wizard row.
        return !baseStep?.done;
      })
      .map((meta) => {
        const v = WIZARD_STEP_VISUALS[meta.id];
        const stepId = `wizard:${meta.id}`;
        return {
          id: stepId,
          label: v.label,
          hint: meta.short,
          icon: v.icon,
          color: v.color,
          done: !!manualDone[stepId],
          path: meta.resumePath,
          cta: v.cta,
        };
      });

    return [...baseSteps, ...wizardRows];
  }, [beneficiaries.length, donors.length, campaigns.length, complianceDocs.length, manualDone, wizardFollowups]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);
  const allDone = completed === total;

  // Auto-hide if all steps done OR user dismissed
  if (hidden || allDone) return null;

  const handleDismiss = () => {
    if (user) markDismissed(user.id);
    setHidden(true);
  };

  const nextStep = steps.find((s) => !s.done);

  return (
    <motion.aside
      className="setup-checklist"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      aria-labelledby="setup-checklist-title"
    >
      <header className="setup-checklist-header">
        <div className="setup-checklist-title-row">
          <Sparkles size={16} color="#0F766E" />
          <h2 id="setup-checklist-title" className="setup-checklist-title">
            Get GoodJobs set up
          </h2>
          <span className="setup-checklist-progress-pill">
            {completed} of {total} done
          </span>
        </div>
        <button
          className="setup-checklist-dismiss"
          onClick={handleDismiss}
          aria-label="Hide setup checklist"
          title="Hide for now"
        >
          <X size={16} />
        </button>
      </header>

      <div className="setup-checklist-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="setup-checklist-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <ul className="setup-checklist-list">
        <AnimatePresence>
          {steps.map((step) => {
            const Icon = step.icon;
            const isNext = !step.done && step === nextStep;
            return (
              <motion.li
                key={step.id}
                className={`setup-checklist-item ${step.done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18 }}
              >
                <div className="setup-checklist-item-icon" style={{ color: step.done ? '#16A34A' : step.color }}>
                  {step.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                </div>
                <div className="setup-checklist-item-body">
                  <div className="setup-checklist-item-label">
                    <Icon size={13} style={{ color: step.color, opacity: step.done ? 0.5 : 1 }} />
                    <span>{step.label}</span>
                  </div>
                  {!step.done && <p className="setup-checklist-item-hint">{step.hint}</p>}
                </div>
                {!step.done && (
                  <button
                    className="setup-checklist-item-cta"
                    onClick={() => handleCtaClick(step.id, step.path)}
                  >
                    {step.cta} <ChevronRight size={14} />
                  </button>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </motion.aside>
  );
};

export default GetStartedChecklist;
