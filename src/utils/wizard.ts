// Signup-wizard state: persisted per user in localStorage so reload resumes mid-step.
// Each step also reports whether the user completed it or skipped it; the existing
// Get Started checklist on Today reads `skippedSteps` to surface unfinished work.

export type WizardStepId =
  | 'org-profile'
  | 'first-program'
  | 'invite-team'
  | 'import-beneficiaries'
  | 'connect-whatsapp';

export const WIZARD_STEP_ORDER: WizardStepId[] = [
  'org-profile',
  'first-program',
  'invite-team',
  'import-beneficiaries',
  'connect-whatsapp',
];

export interface WizardStepMeta {
  id: WizardStepId;
  title: string;
  short: string;
  /** Where the user can come back to finish later (used by Get Started checklist). */
  resumePath: string;
  ctaLabel: string;
}

export const WIZARD_STEPS: Record<WizardStepId, WizardStepMeta> = {
  'org-profile': {
    id: 'org-profile',
    title: 'Org profile',
    short: 'Add your registration & 80G details',
    resumePath: '/settings',
    ctaLabel: 'Open Settings',
  },
  'first-program': {
    id: 'first-program',
    title: 'First program',
    short: 'Name the program you want to track first',
    resumePath: '/programs',
    ctaLabel: 'Open Programs',
  },
  'invite-team': {
    id: 'invite-team',
    title: 'Invite team',
    short: 'Add up to 5 teammates with roles',
    resumePath: '/settings',
    ctaLabel: 'Invite team',
  },
  'import-beneficiaries': {
    id: 'import-beneficiaries',
    title: 'Import beneficiaries',
    short: 'Upload a CSV or add a few manually',
    resumePath: '/programs',
    ctaLabel: 'Open Programs',
  },
  'connect-whatsapp': {
    id: 'connect-whatsapp',
    title: 'Connect WhatsApp',
    short: 'Wire up your number for field data entry',
    resumePath: '/settings',
    ctaLabel: 'Open Settings',
  },
};

export interface WizardData {
  orgProfile?: {
    logoDataUrl?: string;
    registrationNumber?: string;
    section80GNumber?: string;
    fcraStatus?: 'none' | 'pending' | 'active';
  };
  firstProgram?: {
    name?: string;
    causeArea?: string;
    geography?: string;
    startDate?: string;
  };
  inviteTeam?: { invites: { email: string; role: string }[] };
  importBeneficiaries?: { mode?: 'csv' | 'manual'; count?: number; csvName?: string };
  connectWhatsapp?: { phone?: string; verified?: boolean };
}

export interface WizardState {
  /** Step currently shown (0-based index into WIZARD_STEP_ORDER). */
  currentIndex: number;
  /** Steps the user finished (CTA "Save & Continue"). */
  completedSteps: WizardStepId[];
  /** Steps the user explicitly skipped. */
  skippedSteps: WizardStepId[];
  /** Persisted form data per step. */
  data: WizardData;
  /** True once the wizard reached the final "all done" handoff (or every step was visited). */
  finished: boolean;
}

const STATE_KEY = 'gj_wizard_state_v1';
const HANDOFF_KEY = 'gj_wizard_handoff_v1';

interface PerUser<T> { [userId: string]: T }

function readMap<T>(key: string): PerUser<T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as PerUser<T> : {};
  } catch {
    return {};
  }
}

function writeMap<T>(key: string, map: PerUser<T>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

export function emptyWizardState(): WizardState {
  return {
    currentIndex: 0,
    completedSteps: [],
    skippedSteps: [],
    data: {},
    finished: false,
  };
}

export function loadWizardState(userId: string): WizardState {
  if (!userId) return emptyWizardState();
  const map = readMap<WizardState>(STATE_KEY);
  const found = map[userId];
  if (!found) return emptyWizardState();
  return {
    currentIndex: typeof found.currentIndex === 'number' ? found.currentIndex : 0,
    completedSteps: Array.isArray(found.completedSteps) ? found.completedSteps : [],
    skippedSteps: Array.isArray(found.skippedSteps) ? found.skippedSteps : [],
    data: found.data && typeof found.data === 'object' ? found.data : {},
    finished: !!found.finished,
  };
}

export function saveWizardState(userId: string, state: WizardState) {
  if (!userId) return;
  const map = readMap<WizardState>(STATE_KEY);
  map[userId] = state;
  writeMap(STATE_KEY, map);
}

export function clearWizardState(userId: string) {
  if (!userId) return;
  const map = readMap<WizardState>(STATE_KEY);
  delete map[userId];
  writeMap(STATE_KEY, map);
}

/** Returns step ids that the user has neither completed nor explicitly handled. */
export function pendingSteps(state: WizardState | null | undefined): WizardStepId[] {
  if (!state) return [];
  const handled = new Set<WizardStepId>([...state.completedSteps, ...state.skippedSteps]);
  return WIZARD_STEP_ORDER.filter((s) => !handled.has(s));
}

/** Steps that should appear in Get Started checklist (skipped or untouched after wizard finished). */
export function checklistFollowupSteps(state: WizardState | null | undefined): WizardStepMeta[] {
  if (!state) return [];
  const need = new Set<WizardStepId>(state.skippedSteps);
  if (state.finished) {
    pendingSteps(state).forEach((s) => need.add(s));
  }
  return WIZARD_STEP_ORDER.filter((s) => need.has(s)).map((s) => WIZARD_STEPS[s]);
}

/** Mark wizard as finished (full skip or normal completion) and queue the one-shot handoff banner. */
export function finishWizard(userId: string, state: WizardState): WizardState {
  const next: WizardState = { ...state, finished: true, currentIndex: WIZARD_STEP_ORDER.length };
  saveWizardState(userId, next);
  setHandoffPending(userId, true);
  return next;
}

/** ── Handoff banner: shown once on Today right after wizard exit ────────── */

export function setHandoffPending(userId: string, pending: boolean) {
  if (!userId) return;
  const map = readMap<boolean>(HANDOFF_KEY);
  if (pending) map[userId] = true; else delete map[userId];
  writeMap(HANDOFF_KEY, map);
}

export function isHandoffPending(userId: string): boolean {
  if (!userId) return false;
  return !!readMap<boolean>(HANDOFF_KEY)[userId];
}
