import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, SkipForward, Check, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useStore } from '../../store/useStore';
import {
  WIZARD_STEP_ORDER, WIZARD_STEPS,
  loadWizardState, saveWizardState, finishWizard,
  type WizardData, type WizardState, type WizardStepId,
} from '../../utils/wizard';
import OrgProfileStep from './wizardSteps/OrgProfileStep';
import FirstProgramStep from './wizardSteps/FirstProgramStep';
import InviteTeamStep from './wizardSteps/InviteTeamStep';
import ImportBeneficiariesStep from './wizardSteps/ImportBeneficiariesStep';
import WhatsAppStep from './wizardSteps/WhatsAppStep';
import './SignupWizard.css';

export interface StepProps<K extends keyof WizardData> {
  value: WizardData[K];
  onChange: (next: WizardData[K]) => void;
  // Indicates form-completeness so the wizard can enable/disable Continue.
  setComplete: (complete: boolean) => void;
}

const SignupWizard: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const userId = user?.id ?? '';

  const [state, setState] = useState<WizardState>(() => loadWizardState(userId));
  const [stepComplete, setStepComplete] = useState(false);

  // If user lands here without needsWizard (e.g. typed /onboarding by hand), kick to Today.
  useEffect(() => {
    if (!user) return;
    if (!user.needsWizard && !state.finished) {
      navigate('/', { replace: true });
    }
  }, [user, state.finished, navigate]);

  // Persist progress on every state change (resumable on reload).
  useEffect(() => {
    if (userId) saveWizardState(userId, state);
  }, [state, userId]);

  const currentStep: WizardStepId = WIZARD_STEP_ORDER[
    Math.min(state.currentIndex, WIZARD_STEP_ORDER.length - 1)
  ];
  const meta = WIZARD_STEPS[currentStep];

  const totalSteps = WIZARD_STEP_ORDER.length;
  const completedCount = state.completedSteps.length + state.skippedSteps.length;
  const progressPct = Math.round(((state.currentIndex) / totalSteps) * 100);

  // Reset per-step completeness as we move forward/back.
  useEffect(() => {
    setStepComplete(false);
  }, [state.currentIndex]);

  const handleStepData = useCallback(<K extends keyof WizardData>(key: K, value: WizardData[K]) => {
    setState((prev) => ({ ...prev, data: { ...prev.data, [key]: value } }));
  }, []);

  // ── Explicit per-step commit on "Save & continue" ────────────────────────
  // Side-effects (campaign + beneficiary creation) live HERE, not in the step
  // components, so they run exactly once per step completion (not on every
  // keystroke). Skipped steps perform no writes — only completed ones do.
  const commitStep = useCallback((id: WizardStepId, data: WizardData) => {
    if (id === 'first-program') {
      const fp = data.firstProgram;
      if (!fp?.name?.trim() || !fp.causeArea) return;
      const title = fp.name.trim();
      // Idempotent: don't double-add if user clicks Continue twice.
      const existing = useStore.getState().campaigns;
      if (existing.some((c) => c.title === title && c.details?.source === 'signup-wizard')) return;
      useStore.getState().addCampaign({
        title,
        goal: 250000,
        status: 'draft',
        image: 'linear-gradient(135deg, #0F766E, #14b8a6)',
        cause: fp.causeArea,
        details: { source: 'signup-wizard', startDate: fp.startDate ?? null, geography: fp.geography ?? null },
      });
      return;
    }
    if (id === 'import-beneficiaries') {
      const ib = data.importBeneficiaries;
      if (!ib || ib.mode !== 'manual') return; // CSV is processed elsewhere.
      const rows = (ib.manualRows ?? []).filter((r) => r.name.trim());
      if (!rows.length) return;
      const existingNames = new Set(useStore.getState().beneficiaries.map((b) => b.name));
      rows.forEach((r) => {
        const name = r.name.trim();
        // Skip dupes so re-clicking Continue is idempotent.
        if (existingNames.has(name)) return;
        useStore.getState().addBeneficiary({
          name,
          program: r.program.trim() || 'General',
          location: '—',
          aadhaar: false,
          familySize: Math.max(1, Number(r.familySize) || 1),
        });
        existingNames.add(name);
      });
      return;
    }
  }, []);

  const advance = useCallback((status: 'completed' | 'skipped') => {
    setState((prev) => {
      const id = WIZARD_STEP_ORDER[prev.currentIndex];
      if (status === 'completed') commitStep(id, prev.data);
      const completedSteps = status === 'completed'
        ? Array.from(new Set([...prev.completedSteps, id]))
        : prev.completedSteps.filter((s) => s !== id);
      const skippedSteps = status === 'skipped'
        ? Array.from(new Set([...prev.skippedSteps, id]))
        : prev.skippedSteps.filter((s) => s !== id);
      const nextIndex = prev.currentIndex + 1;
      return { ...prev, completedSteps, skippedSteps, currentIndex: nextIndex };
    });
  }, [commitStep]);

  const goBack = useCallback(() => {
    setState((prev) => ({ ...prev, currentIndex: Math.max(0, prev.currentIndex - 1) }));
  }, []);

  const exitWizard = useCallback(() => {
    if (!userId) return;
    const finalState = finishWizard(userId, state);
    setState(finalState);
    updateUser({ needsWizard: false });
    toast.success("You're all set — welcome to GoodJobs!", { icon: '🎉', duration: 3500 });
    navigate('/', { replace: true });
  }, [userId, state, updateUser, navigate]);

  const isLastStep = state.currentIndex >= totalSteps - 1;
  const isFinishedScreen = state.currentIndex >= totalSteps;

  // Render the body for the active step, wired to data slot + completion callback.
  const renderStep = () => {
    if (isFinishedScreen) return null;
    const handlers = { setComplete: setStepComplete };
    switch (currentStep) {
      case 'org-profile':
        return (
          <OrgProfileStep
            value={state.data.orgProfile}
            onChange={(v) => handleStepData('orgProfile', v)}
            {...handlers}
          />
        );
      case 'first-program':
        return (
          <FirstProgramStep
            value={state.data.firstProgram}
            onChange={(v) => handleStepData('firstProgram', v)}
            {...handlers}
          />
        );
      case 'invite-team':
        return (
          <InviteTeamStep
            value={state.data.inviteTeam}
            onChange={(v) => handleStepData('inviteTeam', v)}
            {...handlers}
          />
        );
      case 'import-beneficiaries':
        return (
          <ImportBeneficiariesStep
            value={state.data.importBeneficiaries}
            onChange={(v) => handleStepData('importBeneficiaries', v)}
            {...handlers}
          />
        );
      case 'connect-whatsapp':
        return (
          <WhatsAppStep
            value={state.data.connectWhatsapp}
            onChange={(v) => handleStepData('connectWhatsapp', v)}
            {...handlers}
          />
        );
      default:
        return null;
    }
  };

  if (!user) return null;

  return (
    <div className="wizard-shell">
      {/* ── Top nav bar ──────────────────────────────────────────── */}
      <header className="wizard-topbar">
        <div className="wizard-brand">
          <div className="wizard-logo">GJ</div>
          <div>
            <div className="wizard-brand-name">GoodJobs</div>
            <div className="wizard-brand-tag">Setting up {user.ngoName}</div>
          </div>
        </div>
        <button className="wizard-exit" onClick={exitWizard} type="button">
          Skip setup for now <SkipForward size={14} />
        </button>
      </header>

      {/* ── Progress bar + step pips ─────────────────────────────── */}
      <div className="wizard-progress">
        <div className="wizard-progress-bar">
          <div className="wizard-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <ol className="wizard-progress-steps">
          {WIZARD_STEP_ORDER.map((id, i) => {
            const isDone = state.completedSteps.includes(id);
            const isSkipped = state.skippedSteps.includes(id);
            const isCurrent = i === state.currentIndex && !isFinishedScreen;
            return (
              <li
                key={id}
                className={`wizard-pip ${isDone ? 'done' : ''} ${isSkipped ? 'skipped' : ''} ${isCurrent ? 'current' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="wizard-pip-dot">
                  {isDone ? <Check size={11} /> : i + 1}
                </span>
                <span className="wizard-pip-label">{WIZARD_STEPS[id].title}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── Step body ─────────────────────────────────────────────── */}
      <main className="wizard-body">
        <AnimatePresence mode="wait">
          {!isFinishedScreen ? (
            <motion.section
              key={currentStep}
              className="wizard-step-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22 }}
            >
              <div className="wizard-step-header">
                <div className="wizard-step-eyebrow">
                  Step {state.currentIndex + 1} of {totalSteps} · {completedCount} handled
                </div>
                <h1 className="wizard-step-title">{meta.title}</h1>
              </div>
              <div className="wizard-step-body">
                {renderStep()}
              </div>
            </motion.section>
          ) : (
            <motion.section
              key="done"
              className="wizard-step-card wizard-done-card"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              <div className="wizard-done-burst">
                <Sparkles size={42} />
              </div>
              <h1>You're all set!</h1>
              <p>
                {state.completedSteps.length} of {totalSteps} steps completed
                {state.skippedSteps.length > 0 && ` · ${state.skippedSteps.length} saved for later`}.
              </p>
              <p className="wizard-done-sub">
                Take me to my Today screen — your Get Started checklist will guide
                you through anything you skipped.
              </p>
              <button className="wizard-btn wizard-btn-primary" onClick={exitWizard}>
                Open my dashboard <ArrowRight size={16} />
              </button>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* ── Footer actions ───────────────────────────────────────── */}
      {!isFinishedScreen && (
        <footer className="wizard-footer">
          <button
            type="button"
            className="wizard-btn wizard-btn-ghost"
            onClick={goBack}
            disabled={state.currentIndex === 0}
          >
            <ArrowLeft size={14} /> Back
          </button>

          <div className="wizard-footer-actions">
            <button
              type="button"
              className="wizard-btn wizard-btn-secondary"
              onClick={() => advance('skipped')}
            >
              Skip for now
            </button>
            <button
              type="button"
              className="wizard-btn wizard-btn-primary"
              onClick={() => advance('completed')}
              disabled={!stepComplete}
              title={!stepComplete ? 'Fill in the required fields to continue' : undefined}
            >
              {isLastStep ? 'Finish setup' : 'Save & continue'}
              <ArrowRight size={14} />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};

export default SignupWizard;
