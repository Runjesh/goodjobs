import { create } from 'zustand';
import type { ProgramBudget } from '../utils/programFinance';

export interface EffortEntry {
  id: string;
  staffName: string;
  date: string;
  hours: number;
  type: 'office' | 'field_visit';
  programme: string;
  createdAt: string;
}
import type { BeneficiaryOutcome } from '../utils/outcomes';
import type { GrantTranche } from '../utils/grantLifecycle';
import type { VolunteerAssignment } from '../utils/volunteerProgram';
import type { ComplianceGrantLink } from '../utils/complianceGrant';
import type { ProgramGrantLink } from '../utils/programGrantLink';
import type { GrantBudgetHead, GrantTag, JournalExpense } from '../utils/grantBudgetHeads';
export type { JournalExpense } from '../utils/grantBudgetHeads';
import type { Task } from '../utils/tasks';
import { buildRecurringNextInstance } from '../utils/tasks';
import { dispatchOnComplete } from '../utils/taskDispatcher';
import { programIdFromName } from '../utils/programFinance';

/**
 * NGO identity details — single source of truth for org-level fields used
 * across Finance (Tally export ngo_name, 80G, FCRA) and Compliance.
 * Persisted to localStorage; loaded at boot and overwritten on Settings save.
 */
export interface NgoDetails {
  name: string;
  reg_no: string;
  fcra_reg: string;
  pan: string;
  /** 80G certificate number — printed on donor deduction receipts. */
  eighty_g_no: string;
  /** ISO state name, e.g. "Maharashtra". */
  state: string;
  /** Primary cause area selected at signup — used to pre-filter grant matching. */
  causeArea?: string;
  /** WhatsApp number wired during onboarding — mirrors user.whatsapp.phone. */
  whatsapp?: string;
}

/**
 * Cross-module connective state (Session 1 of the audit).
 *
 *  - programBudgets         : Programs ↔ Finance loop
 *  - beneficiaryOutcomes    : Beneficiary ↔ Outcomes loop
 *  - grantTranches          : Grant lifecycle (release-gated by utilization)
 *  - misReviewIntents       : MIS submissions awaiting supervisor approval
 *
 * Everything is persisted to localStorage so a refresh keeps the demo state
 * coherent without a backend round-trip.
 */

export interface MisReviewIntent {
  id: string;
  /** Raw narrative the field officer typed. */
  narrative: string;
  /** Programmatically extracted fields the supervisor will approve / edit. */
  extracted: {
    beneficiary?: string;
    location?: string;
    metric?: string;
    value?: string;
    program?: string;
  };
  reporterId: string;
  reportDate: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'edited' | 'dismissed';
  /** Set on approve/edit/dismiss. */
  decidedAt?: string;
}

export interface Donor {
  id: string;
  name: string;
  type: string;
  totalGiven: number;
  lastGift: string;
  initial: string;
  pan: string;
  location: string;
  tags: string[];
  email?: string;
  phone?: string;
  /** CRM profile: employer, notes, preferred_channel, consent flags, etc. */
  meta?: Record<string, unknown>;
}

export interface Campaign {
  id: string;
  title: string;
  raised: number;
  goal: number;
  donorsCount: number;
  status: 'active' | 'draft';
  image: string;
  cause?: string;
  /** Narrative, partner, public link — JSON from API. */
  details?: Record<string, unknown>;
}

export interface Transaction {
  id: string;
  donorId: string;
  donorName: string;
  amount: number;
  method: string;
  campaignId: string;
  campaignTitle: string;
  date: string;
  timestamp: number;
  /**
   * Cross-module join: which grant this income receipt is associated with.
   * Mirrors the `grant_id` column added to the backend `transactions` table.
   */
  grantId?: string;
  /**
   * Cross-module join: which programme this income receipt supports.
   * Mirrors the `programme_id` column added to the backend `transactions` table.
   */
  programmeId?: string;
}

export interface CSRCard {
  id: number | string;
  company: string;
  amount: number;
  project: string;
  tags: string[];
  agent: string;
  col: string;
  date: string;
  /** Schedule VII contacts, reporting cadence, outcomes, etc. */
  details?: Record<string, unknown>;
  /** Deal health heuristic (0–100). */
  win_probability?: number;
  /** ISO date (YYYY-MM-DD) of the next required grant report — used to seed
   *  compliance records on MoU → Live transition. */
  report_due_date?: string;
  /** ISO timestamp — last pipeline activity (aligned with backend updated_at in DB mode). */
  last_activity_at?: string;
  updated_at?: string;
  created_at?: string;
}

export interface Beneficiary {
  id: string;
  name: string;
  program: string;
  location: string;
  aadhaar: boolean;
  familySize: number;
  /** Demographics, referral, ID refs, vulnerability flags, consent — JSON from API. */
  details?: Record<string, unknown>;
}

export interface Volunteer {
  id: string;
  name: string;
  skills: string[];
  hours: number;
  verified: boolean;
  /** Phone, city, availability, emergency contact, languages, notes. */
  profile?: Record<string, unknown>;
}

export interface ShiftSignup {
  shiftId: number;
  volunteerName: string;
}

export interface ComplianceDocument {
  id: string;
  name: string;
  type: string;
  status: 'Valid' | 'Expiring Soon' | 'Expired';
  expiry: string;
  uploadedAt: string;
  /** Authority, registration ref, review notes — JSON from API. */
  details?: Record<string, unknown>;
}

/** A single outreach touchpoint logged when the CRM sends via WhatsApp or email.
 *  Stored in the Zustand store (shared, survives component remounts within the
 *  session) and used to drive the per-donor delivery-status indicator. */
export interface OutreachEntry {
  id: string;
  donorId: string;
  /** ISO timestamp — used for last-contact computation. */
  timestamp: number;
  /** Human-readable date string for display. */
  date: string;
  channel: 'whatsapp' | 'email';
  template: string;
  status: 'sent' | 'delivered';
}

interface AppState {
  donors: Donor[];
  campaigns: Campaign[];
  transactions: Transaction[];
  csrCards: CSRCard[];
  beneficiaries: Beneficiary[];
  volunteers: Volunteer[];
  complianceDocs: ComplianceDocument[];

  // ── Cross-module connective state (Session 1) ──────────────────────────
  programBudgets:        ProgramBudget[];
  beneficiaryOutcomes:   BeneficiaryOutcome[];
  grantTranches:         GrantTranche[];
  misReviewIntents:      MisReviewIntent[];

  // ── Cross-module connective state (Session 2) ──────────────────────────
  // volunteerAssignments: who is delivering which programme + hours
  // complianceGrantLinks: which compliance doc(s) gate which grant
  volunteerAssignments:  VolunteerAssignment[];
  complianceGrantLinks:  ComplianceGrantLink[];
  /** Many-to-many programme ↔ grant edges (Session 3). */
  programGrantLinks:     ProgramGrantLink[];

  // ── Cross-module connective state (Session 4) ──────────────────────────
  // grantBudgetHeads : per-grant editable budget heads
  // journalEntries   : booked finance journal entries (expenses/income/transfers).
  //                    Source-of-truth for grant utilisation math; receipt
  //                    transactions (donor inflows) are NOT counted here.
  grantBudgetHeads:      GrantBudgetHead[];
  journalEntries:        JournalExpense[];

  // ── Cross-module connective state (Session 5 — Data Foundation) ────────
  // ngoDetails: single source of truth for org-level identity fields.
  //             Read by Finance (Tally XML, UC, ngo_name) and Compliance.
  //             Written by Settings > NGO Details tab.
  ngoDetails:            NgoDetails;
  setNgoDetails:         (d: Partial<NgoDetails>) => void;

  /** Cross-module Tasks slice — see src/utils/tasks.ts. */
  tasks:                 Task[];
  addTask:               (t: Task) => void;
  upsertTaskByIntent:    (t: Task) => void;
  updateTask:            (id: string, patch: Partial<Task>) => void;
  completeTask:          (id: string, now?: Date) => Task | null;
  snoozeTask:            (id: string, untilIso: string) => void;
  dismissTask:           (id: string) => void;

  // Custom programme names defined by the org (in addition to those
  // derived from existing beneficiaries). Persisted to localStorage so
  // a freshly-created programme survives a refresh even before any
  // beneficiary has been enrolled into it.
  customPrograms:        string[];
  addCustomProgram:      (name: string) => void;
  removeCustomProgram:   (name: string) => void;

  /** Team members invited during onboarding wizard — available in task-assignment dropdowns. */
  pendingTeamMembers:    { email: string; role: string; invitedAt: string }[];
  addPendingTeamMember:  (m: { email: string; role: string; invitedAt: string }) => void;
  clearPendingTeamMembers: () => void;

  setProgramBudgets:      (b: ProgramBudget[]) => void;
  upsertProgramBudget:    (b: ProgramBudget) => void;
  recordProgramSpend:     (programId: string, amount: number) => void;
  upsertBeneficiaryOutcome: (o: BeneficiaryOutcome) => void;
  setGrantTranches:       (t: GrantTranche[]) => void;
  upsertGrantTranche:     (t: GrantTranche) => void;
  releaseGrantTranche:    (id: string) => void;
  addMisReviewIntent:     (i: MisReviewIntent) => void;
  decideMisReviewIntent:  (id: string, decision: 'approved' | 'edited' | 'dismissed', patch?: Partial<MisReviewIntent['extracted']>) => void;
  upsertVolunteerAssignment: (a: VolunteerAssignment) => void;
  removeVolunteerAssignment: (id: string) => void;
  addComplianceGrantLink:    (l: ComplianceGrantLink) => void;
  removeComplianceGrantLink: (id: string) => void;
  addProgramGrantLink:       (l: ProgramGrantLink) => void;
  removeProgramGrantLink:    (id: string) => void;
  upsertGrantBudgetHead:     (h: GrantBudgetHead) => void;
  removeGrantBudgetHead:     (id: string) => void;
  /** Append/replace a booked journal entry. Caller assigns id. */
  upsertJournalEntry:        (e: JournalExpense) => void;
  /** Tag (or untag with `null`) a journal expense to a grant + budget head. */
  setJournalEntryGrantTag:   (id: string, tag: GrantTag | null) => void;

  setDonors: (donors: Donor[]) => void;
  setComplianceDocs: (docs: ComplianceDocument[]) => void;
  setTransactions: (txs: Transaction[]) => void;
  setCampaigns: (campaigns: Campaign[]) => void;
  setCsrCards: (cards: CSRCard[]) => void;
  setVolunteers: (volunteers: Volunteer[]) => void;
  setBeneficiaries: (beneficiaries: Beneficiary[]) => void;

  addCampaign: (campaign: Omit<Campaign, 'id' | 'raised' | 'donorsCount'>) => void;
  addCampaignWithId: (campaign: Campaign) => void;
  updateCampaign: (id: string, data: Partial<Campaign>) => void;
  deleteCampaign: (id: string) => void;
  addDonor: (donor: Omit<Donor, 'id' | 'totalGiven' | 'lastGift' | 'initial'>) => void;
  addDonorWithId: (donor: Donor) => void;
  updateDonor: (id: string, data: Partial<Donor>) => void;
  deleteDonor: (id: string) => void;
  addTransaction: (transaction: Omit<Transaction, 'id' | 'timestamp'>) => void;
  addTransactionWithId: (transaction: Transaction) => void;
  moveCSRCard: (cardId: number | string, newCol: string) => void;
  addCSRCard: (card: Omit<CSRCard, 'id'>) => void;
  addCSRCardWithId: (card: CSRCard) => void;
  updateCSRCard: (id: number | string, data: Partial<CSRCard>) => void;
  deleteCSRCard: (id: number | string) => void;
  addBeneficiary: (b: Omit<Beneficiary, 'id'>) => void;
  updateBeneficiary: (id: string, data: Partial<Beneficiary>) => void;
  deleteBeneficiary: (id: string) => void;
  addVolunteer: (v: Omit<Volunteer, 'id' | 'hours'>) => void;
  updateVolunteer: (id: string, data: Partial<Volunteer>) => void;
  deleteVolunteer: (id: string) => void;
  addComplianceDoc: (doc: Omit<ComplianceDocument, 'uploadedAt'> & { id?: string }) => void;

  /** CRM outreach touchpoint log — shared across all views within the session. */
  outreachLog:          OutreachEntry[];
  addOutreachEntry:     (entry: OutreachEntry) => void;
  updateOutreachEntry:  (id: string, patch: Partial<OutreachEntry>) => void;

  /** Staff effort log — written by the Log Effort form on Programs. */
  programEffort:        EffortEntry[];
  addEffortEntry:       (e: EffortEntry) => void;
}

const initialDonors: Donor[] = [
  { id: '1', name: 'Anjali Desai', type: 'Major Donor', totalGiven: 450000, lastGift: '2026-03-15', initial: 'A', pan: 'ABCP****4D', location: 'Mumbai, Maharashtra', tags: ['Education Cause'] },
  { id: '2', name: 'Rohan Gupta', type: 'Recurring', totalGiven: 24000, lastGift: '2026-04-01', initial: 'R', pan: 'BVCX****9H', location: 'Delhi, NCR', tags: ['Monthly Giver'] },
  { id: '3', name: 'Infosys Foundation', type: 'CSR Partner', totalGiven: 5000000, lastGift: '2025-11-20', initial: 'I', pan: 'INFS****1C', location: 'Bangalore, Karnataka', tags: ['CSR'] },
  { id: '4', name: 'Priya Sharma', type: 'Lapsing', totalGiven: 15000, lastGift: '2025-08-10', initial: 'P', pan: 'PRYS****3J', location: 'Pune, Maharashtra', tags: ['Health'] },
  { id: '5', name: 'Vikram Singh', type: 'Event Attendee', totalGiven: 5000, lastGift: '2026-02-28', initial: 'V', pan: 'VKRS****2K', location: 'Jaipur, Rajasthan', tags: ['Events'] }
];

const initialCampaigns: Campaign[] = [
  { id: 'c1', title: 'Digital Literacy for Rural Girls', raised: 1250000, goal: 2000000, donorsCount: 342, status: 'active', image: 'linear-gradient(135deg, #a855f7, #ec4899)' },
  { id: 'c2', title: 'Emergency Medical Relief Fund', raised: 850000, goal: 1000000, donorsCount: 89, status: 'active', image: 'linear-gradient(135deg, #3b82f6, #06b6d4)' },
  { id: 'c3', title: 'Annual Gala 2026 Table Booking', raised: 0, goal: 500000, donorsCount: 0, status: 'draft', image: 'linear-gradient(135deg, #10b981, #3b82f6)' }
];

const initialTransactions: Transaction[] = [
  { id: 'TRX-1092', donorId: '1', donorName: 'Anjali Desai', amount: 5000, method: 'UPI AutoPay', campaignId: 'c1', campaignTitle: 'Digital Literacy for Rural Girls', date: '2 Mins ago', timestamp: Date.now() - 120000 },
  { id: 'TRX-1091', donorId: '4', donorName: 'Priya Sharma', amount: 15000, method: 'Credit Card', campaignId: 'c2', campaignTitle: 'Emergency Medical Relief Fund', date: '15 Mins ago', timestamp: Date.now() - 900000 },
  { id: 'TRX-1090', donorId: '2', donorName: 'Rohan Gupta', amount: 2500, method: 'UPI QR', campaignId: 'c1', campaignTitle: 'Digital Literacy for Rural Girls', date: '1 Hour ago', timestamp: Date.now() - 3600000 },
  { id: 'TRX-1089', donorId: '3', donorName: 'Infosys Foundation', amount: 50000, method: 'NEFT', campaignId: 'c2', campaignTitle: 'Emergency Medical Relief Fund', date: '3 Hours ago', timestamp: Date.now() - 10800000 }
];

const initialCSRCards: CSRCard[] = [
  { id: 1, company: 'Reliance Industries', amount: 5000000, project: 'Rural Healthcare Phase 2', tags: ['Health', 'Gujarat'], agent: 'AD', col: 'prospecting', date: 'Last contact: 2d ago' },
  { id: 2, company: 'Tata Consultancy Services', amount: 2500000, project: 'Digital Literacy 2026', tags: ['Education', 'Tech'], agent: 'RS', col: 'pitch', date: 'Sent on: Oct 12' },
  { id: 3, company: 'HDFC Bank CSR', amount: 8000000, project: 'Women Livelihood Center', tags: ['Livelihood'], agent: 'AD', col: 'diligence', date: 'Audit pending' },
  { id: 4, company: 'Wipro Care', amount: 1200000, project: 'School Infrastructure', tags: ['Education', 'WASH'], agent: 'PM', col: 'mou', date: 'Signed: Oct 15' },
  { id: 5, company: 'Mahindra Finance', amount: 4500000, project: 'Farmer Support Init', tags: ['Agriculture'], agent: 'RS', col: 'live', date: 'Report due: Nov 30', report_due_date: '2026-11-30' },
  { id: 6, company: 'Infosys Foundation', amount: 6000000, project: 'STEM for Girls', tags: ['Education'], agent: 'AD', col: 'live', date: 'Report due: Dec 15', report_due_date: '2026-12-15' }
];

// Seed beneficiaries are only included in dev builds. Production starts empty
// so a freshly-onboarded NGO doesn't see fictional people in their programs
// table; Programs.tsx falls back to this list only when the store is empty,
// which (in prod) means the empty-state UI takes over instead.
const SEED_DEMO_DATA = (() => {
  try { return !!import.meta.env.DEV; } catch { return false; }
})();

export const initialBeneficiaries: Beneficiary[] = SEED_DEMO_DATA ? [
  { id: 'BEN-1045', name: 'Lakshmi Devi', program: 'Women Livelihood Center', location: 'Nashik, MH', aadhaar: true, familySize: 4 },
  { id: 'BEN-1046', name: 'Rahul Kumar', program: 'Digital Literacy 2026', location: 'Patna, BR', aadhaar: true, familySize: 1 },
  { id: 'BEN-1047', name: 'Sunita Bai', program: 'Healthcare Camp', location: 'Pune, MH', aadhaar: false, familySize: 3 },
  { id: 'BEN-1048', name: 'Anita Desai', program: 'Women Livelihood Center', location: 'Nashik, MH', aadhaar: true, familySize: 5 },
] : [];

const initialVolunteers: Volunteer[] = [
  { id: 'V-101', name: 'Rohan Sharma', skills: ['Teaching', 'English'], hours: 45, verified: true },
  { id: 'V-102', name: 'Priya Patel', skills: ['Medical Camp', 'Admin'], hours: 120, verified: true },
  { id: 'V-103', name: 'Karan Singh', skills: ['Logistics'], hours: 8, verified: false },
  { id: 'V-104', name: 'Neha Gupta', skills: ['Social Media', 'Photography'], hours: 32, verified: true },
];

const initialComplianceDocs: ComplianceDocument[] = [
  { id: 'doc-1', name: '12A Registration', type: 'Tax Exemption', status: 'Valid', expiry: '2028-03-31', uploadedAt: '2023-04-01' },
  { id: 'doc-2', name: '80G Certificate', type: 'Donor Deduction', status: 'Expiring Soon', expiry: '2026-09-30', uploadedAt: '2023-10-01' },
  { id: 'doc-3', name: 'FCRA Registration', type: 'Foreign Contribution', status: 'Valid', expiry: '2028-11-15', uploadedAt: '2023-11-20' },
  { id: 'doc-4', name: 'CSR-1 Filing', type: 'CSR Eligibility', status: 'Valid', expiry: '2027-03-31', uploadedAt: '2024-04-10' },
];

// ── Local-storage persistence for cross-module state ───────────────────────
const LS_BUDGETS   = 'goodjobs.programBudgets.v1';
const LS_OUTCOMES  = 'goodjobs.beneficiaryOutcomes.v1';
const LS_TRANCHES  = 'goodjobs.grantTranches.v1';
const LS_MIS       = 'goodjobs.misReviewIntents.v1';
const LS_VOL_ASSIGN = 'goodjobs.volunteerAssignments.v1';
const LS_COMP_LINKS = 'goodjobs.complianceGrantLinks.v1';
const LS_PROG_GRANT_LINKS = 'goodjobs.programGrantLinks.v1';
const LS_CUSTOM_PROGRAMS = 'goodjobs.customPrograms.v1';
const LS_BUDGET_HEADS    = 'goodjobs.grantBudgetHeads.v1';
const LS_JOURNAL_ENTRIES = 'goodjobs.journalEntries.v1';
const LS_TASKS = 'goodjobs.tasks.v1';
const LS_NGO_DETAILS = 'goodjobs.ngoDetails.v1';

const DEFAULT_NGO_DETAILS: NgoDetails = {
  name: 'India NGO Trust',
  reg_no: 'MH/2015/0012345',
  fcra_reg: '231650212',
  pan: 'AABCI1234C',
  eighty_g_no: '80G/AABCI1234C/2023-24',
  state: 'Maharashtra',
};

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? (parsed as unknown as T) : fallback;
    }
    if (fallback && typeof fallback === 'object') {
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as T) : fallback;
    }
    return parsed as T;
  } catch { return fallback; }
}

function saveLS(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

const SEED_DEMO_CONNECTIONS = SEED_DEMO_DATA;
const seedBudgets: ProgramBudget[] = SEED_DEMO_CONNECTIONS ? [
  { programId: 'women-livelihood-center', label: 'Women Livelihood Center', planned: 1_500_000, spent: 420_000, grantId: '3', windowEnd: new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10), restricted: true },
  { programId: 'digital-literacy-2026',   label: 'Digital Literacy 2026',   planned:   800_000, spent: 610_000, grantId: '2', windowEnd: new Date(Date.now() + 50 * 86_400_000).toISOString().slice(0, 10), restricted: true },
  { programId: 'healthcare-camp',         label: 'Healthcare Camp',         planned:   300_000, spent:  80_000 },
  // Farmer Support Initiative (Mahindra Finance — grant id 5, live).
  // Only 18 % spent past the grant halfway point → triggers clawback-risk brief
  // for the ED in the Today dashboard's morning brief.
  { programId: 'farmer-support-init',     label: 'Farmer Support Init',     planned: 4_500_000, spent: 810_000, grantId: '5', windowEnd: new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10), restricted: true },
] : [];

const seedVolAssignments: VolunteerAssignment[] = SEED_DEMO_CONNECTIONS ? [
  {
    id: 'va-101-wlc',
    volunteerId: 'V-101',
    programId: programIdFromName('Women Livelihood Center'),
    programLabel: 'Women Livelihood Center',
    hours: 18,
    lastVisit: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10),
    role: 'Tailoring trainer',
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  },
  {
    id: 'va-102-hc',
    volunteerId: 'V-102',
    programId: programIdFromName('Healthcare Camp'),
    programLabel: 'Healthcare Camp',
    hours: 36,
    lastVisit: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
    role: 'Camp coordinator',
    createdAt: new Date(Date.now() - 45 * 86_400_000).toISOString(),
  },
  {
    id: 'va-104-dl',
    volunteerId: 'V-104',
    programId: programIdFromName('Digital Literacy 2026'),
    programLabel: 'Digital Literacy 2026',
    hours: 12,
    lastVisit: new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10),
    role: 'Photography & social',
    createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
  },
] : [];

const seedComplianceLinks: ComplianceGrantLink[] = SEED_DEMO_CONNECTIONS ? [
  // HDFC Bank Women Livelihood grant requires 12A + 80G
  { id: 'cl-3-80g',  grantId: '3', complianceDocId: 'doc-2', reason: 'Donor 80G receipt requirement' },
  { id: 'cl-3-12a',  grantId: '3', complianceDocId: 'doc-1', reason: '12A registration on file' },
  // TCS Digital Literacy requires 80G
  { id: 'cl-2-80g',  grantId: '2', complianceDocId: 'doc-2', reason: 'Donor 80G receipt requirement' },
  // Infosys Foundation grant requires CSR-1
  { id: 'cl-6-csr1', grantId: '6', complianceDocId: 'doc-4', reason: 'CSR-1 mandatory for funder' },
] : [];

const seedProgramGrantLinks: ProgramGrantLink[] = SEED_DEMO_CONNECTIONS ? [
  // HDFC Bank CSR (id 3) primarily funds Women Livelihood Center
  { id: 'pgl-3-wlc', programId: programIdFromName('Women Livelihood Center'), grantId: '3', role: 'primary',   allocationPct: 80, createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString() },
  // TCS (id 2) primarily funds Digital Literacy 2026
  { id: 'pgl-2-dl',  programId: programIdFromName('Digital Literacy 2026'),   grantId: '2', role: 'primary',   allocationPct: 90, createdAt: new Date(Date.now() - 45 * 86_400_000).toISOString() },
  // HDFC also co-funds Digital Literacy 2026 to demonstrate co-funding
  { id: 'pgl-3-dl',  programId: programIdFromName('Digital Literacy 2026'),   grantId: '3', role: 'co-funder', allocationPct: 10, createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString() },
  // Mahindra Finance (id 5, live) funds Farmer Support Initiative
  { id: 'pgl-5-fsi', programId: programIdFromName('Farmer Support Init'),     grantId: '5', role: 'primary',   allocationPct: 100, createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString() },
] : [];

// Demo budget heads — give a couple of grants a real 4-head budget so the
// new "Budget heads" panel on GrantDetail isn't empty in dev.
const seedGrantBudgetHeads: GrantBudgetHead[] = SEED_DEMO_CONNECTIONS ? [
  // HDFC Bank Women Livelihood (grant id 3 — total ₹80L)
  { id: 'gbh-3-prog',  grantId: '3', label: 'Programme delivery',     allocatedAmount: 4_800_000, sortOrder: 1 },
  { id: 'gbh-3-me',    grantId: '3', label: 'M&E + reporting',         allocatedAmount:   800_000, sortOrder: 2 },
  { id: 'gbh-3-cap',   grantId: '3', label: 'Capacity building',       allocatedAmount: 1_200_000, sortOrder: 3 },
  { id: 'gbh-3-admin', grantId: '3', label: 'Admin (cap 15%)',         allocatedAmount: 1_200_000, sortOrder: 4 },
  // TCS Digital Literacy 2026 (grant id 2 — total ₹25L)
  { id: 'gbh-2-prog',  grantId: '2', label: 'Programme delivery',     allocatedAmount: 1_500_000, sortOrder: 1 },
  { id: 'gbh-2-me',    grantId: '2', label: 'M&E + reporting',         allocatedAmount:   250_000, sortOrder: 2 },
  { id: 'gbh-2-cap',   grantId: '2', label: 'Devices & connectivity',  allocatedAmount:   500_000, sortOrder: 3 },
  { id: 'gbh-2-admin', grantId: '2', label: 'Admin (cap 10%)',         allocatedAmount:   250_000, sortOrder: 4 },
] : [];

// A handful of seeded JOURNAL EXPENSES so utilisation shows non-zero spend
// before the user posts anything. These are real outflows (salaries,
// devices, etc.) — donor receipts are NOT counted toward grant utilisation.
const seedJournalEntries: JournalExpense[] = SEED_DEMO_CONNECTIONS ? [
  { id: 'JE-3001', date: '2026-04-02', amount: 320_000, description: 'Field staff salaries (Mar)',     fund: 'Restricted', entryType: 'Expense', grantTag: { grantId: '3', budgetHeadId: 'gbh-3-prog' } },
  { id: 'JE-3002', date: '2026-04-05', amount:  45_000, description: 'M&E baseline survey enumerators', fund: 'Restricted', entryType: 'Expense', grantTag: { grantId: '3', budgetHeadId: 'gbh-3-me'   } },
  { id: 'JE-2001', date: '2026-04-10', amount: 180_000, description: 'Trainer honoraria — Digital Lit', fund: 'Restricted', entryType: 'Expense', grantTag: { grantId: '2', budgetHeadId: 'gbh-2-prog' } },
  { id: 'JE-2002', date: '2026-04-12', amount:  62_500, description: 'Tablet purchase (25 units)',      fund: 'Restricted', entryType: 'Expense', grantTag: { grantId: '2', budgetHeadId: 'gbh-2-cap'  } },
  // Untagged ≥ ₹1k expenses so the Finance tagging warning has work to surface.
  { id: 'JE-9001', date: '2026-04-14', amount:  18_000, description: 'Office internet recharge',        fund: 'General',    entryType: 'Expense' },
  { id: 'JE-9002', date: '2026-04-15', amount:  12_500, description: 'Consultant — UC drafting',         fund: 'General',    entryType: 'Expense' },
] : [];

const seedTranches: GrantTranche[] = SEED_DEMO_CONNECTIONS ? [
  { id: 'tr-3-1', grantId: '3', number: 1, amount: 4_000_000, expectedDate: new Date(Date.now() - 60*86_400_000).toISOString().slice(0,10), status: 'released', releasedAt: new Date(Date.now() - 60*86_400_000).toISOString() },
  { id: 'tr-3-2', grantId: '3', number: 2, amount: 4_000_000, expectedDate: new Date(Date.now() + 10*86_400_000).toISOString().slice(0,10), status: 'awaiting_utilization' },
  { id: 'tr-2-1', grantId: '2', number: 1, amount: 2_500_000, expectedDate: new Date(Date.now() - 30*86_400_000).toISOString().slice(0,10), status: 'released', releasedAt: new Date(Date.now() - 30*86_400_000).toISOString() },
] : [];

export const useStore = create<AppState>((set, get) => ({
  // Start empty; hydrate from backend on app load.
  donors: [],
  campaigns: [],
  transactions: [],
  csrCards: [],
  beneficiaries: [],
  volunteers: [],
  complianceDocs: [],

  // Cross-module state — hydrated from localStorage so demo edits persist.
  programBudgets:      loadLS<ProgramBudget[]>(LS_BUDGETS, seedBudgets),
  beneficiaryOutcomes: loadLS<BeneficiaryOutcome[]>(LS_OUTCOMES, []),
  grantTranches:       loadLS<GrantTranche[]>(LS_TRANCHES, seedTranches),
  misReviewIntents:    loadLS<MisReviewIntent[]>(LS_MIS, []),
  volunteerAssignments: loadLS<VolunteerAssignment[]>(LS_VOL_ASSIGN, seedVolAssignments),
  complianceGrantLinks: loadLS<ComplianceGrantLink[]>(LS_COMP_LINKS, seedComplianceLinks),
  programGrantLinks:    loadLS<ProgramGrantLink[]>(LS_PROG_GRANT_LINKS, seedProgramGrantLinks),
  customPrograms:       loadLS<string[]>(LS_CUSTOM_PROGRAMS, []),
  pendingTeamMembers:   loadLS<{ email: string; role: string; invitedAt: string }[]>('goodjobs.pendingTeamMembers.v1', []),
  grantBudgetHeads:     loadLS<GrantBudgetHead[]>(LS_BUDGET_HEADS, seedGrantBudgetHeads),
  journalEntries:       loadLS<JournalExpense[]>(LS_JOURNAL_ENTRIES, seedJournalEntries),
  tasks:                loadLS<Task[]>(LS_TASKS, []),
  ngoDetails:           loadLS<NgoDetails>(LS_NGO_DETAILS, DEFAULT_NGO_DETAILS),

  addTask: (t) => set((state) => {
    const next = [t, ...state.tasks];
    saveLS(LS_TASKS, next);
    return { tasks: next };
  }),
  upsertTaskByIntent: (t) => set((state) => {
    if (!t.sourceIntentId) {
      const next = [t, ...state.tasks];
      saveLS(LS_TASKS, next);
      return { tasks: next };
    }
    const idx = state.tasks.findIndex(x => x.sourceIntentId === t.sourceIntentId);
    let next: Task[];
    if (idx === -1) {
      next = [t, ...state.tasks];
    } else {
      // Preserve user-driven state (status / snooze); refresh display
      // fields from the upsert payload. Mirror upsertInboxTask: only
      // backfill onCompleteAction when prior didn't have one.
      const prior = state.tasks[idx];
      const merged: Task = {
        ...prior,
        title: t.title,
        description: t.description,
        relatedEntityType: prior.relatedEntityType ?? t.relatedEntityType,
        relatedEntityId:   prior.relatedEntityId   ?? t.relatedEntityId,
        // Mirror the bridge helper: refresh onCompleteAction only when prior
        // didn't have one. Existing wiring is never silently overwritten.
        onCompleteAction: prior.onCompleteAction ?? t.onCompleteAction,
        priority: t.priority,
        meta: { ...(prior.meta ?? {}), ...(t.meta ?? {}) },
        updatedAt: new Date().toISOString(),
      };
      next = state.tasks.slice();
      next[idx] = merged;
    }
    saveLS(LS_TASKS, next);
    return { tasks: next };
  }),
  updateTask: (id, patch) => set((state) => {
    const next = state.tasks.map(t =>
      t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
    );
    saveLS(LS_TASKS, next);
    return { tasks: next };
  }),
  completeTask: (id, now = new Date()) => {
    const state = get();
    const target = state.tasks.find(t => t.id === id);
    if (!target) return null;
    // AppState is structurally a superset of TaskDispatcherStore; we cast
    // through unknown because CSRCard / ComplianceDocument are nominal types
    // that don't carry the dispatcher's index-signature shape.
    const dispatchResult = dispatchOnComplete(
      target.onCompleteAction,
      state as unknown as Parameters<typeof dispatchOnComplete>[1],
      now,
    );
    if (!dispatchResult.ok) {
      // Side-effect failed — keep the task open so the user can retry rather
      // than silently marking it done. Caller (Tasks.tsx) reads the null
      // return to skip its success toast.
      return null;
    }

    const completed: Task = {
      ...target,
      status: 'done',
      completedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const recurNext = buildRecurringNextInstance(target, now);
    let next = state.tasks.map(t => (t.id === id ? completed : t));
    if (recurNext) next = [recurNext, ...next];
    saveLS(LS_TASKS, next);
    set({ tasks: next });
    return completed;
  },
  snoozeTask: (id, untilIso) => set((state) => {
    const next = state.tasks.map(t =>
      t.id === id
        ? { ...t, status: 'snoozed' as const, snoozeUntil: untilIso, updatedAt: new Date().toISOString() }
        : t
    );
    saveLS(LS_TASKS, next);
    return { tasks: next };
  }),
  dismissTask: (id) => set((state) => {
    const next = state.tasks.map(t =>
      t.id === id ? { ...t, status: 'dismissed' as const, updatedAt: new Date().toISOString() } : t
    );
    saveLS(LS_TASKS, next);
    return { tasks: next };
  }),

  addCustomProgram: (name) => set((state) => {
    const trimmed = name.trim();
    if (!trimmed) return {};
    if (state.customPrograms.some(p => p.toLowerCase() === trimmed.toLowerCase())) return {};
    const next = [...state.customPrograms, trimmed];
    saveLS(LS_CUSTOM_PROGRAMS, next);
    return { customPrograms: next };
  }),
  removeCustomProgram: (name) => set((state) => {
    const next = state.customPrograms.filter(p => p !== name);
    saveLS(LS_CUSTOM_PROGRAMS, next);
    return { customPrograms: next };
  }),

  addPendingTeamMember: (m) => set((state) => {
    if (state.pendingTeamMembers.some(x => x.email.toLowerCase() === m.email.toLowerCase())) return {};
    const next = [...state.pendingTeamMembers, m];
    saveLS('goodjobs.pendingTeamMembers.v1', next);
    return { pendingTeamMembers: next };
  }),
  clearPendingTeamMembers: () => {
    saveLS('goodjobs.pendingTeamMembers.v1', []);
    set({ pendingTeamMembers: [] });
  },

  setProgramBudgets: (programBudgets) => { saveLS(LS_BUDGETS, programBudgets); set({ programBudgets }); },
  upsertProgramBudget: (b) => set((state) => {
    const next = state.programBudgets.some(x => x.programId === b.programId)
      ? state.programBudgets.map(x => x.programId === b.programId ? { ...x, ...b } : x)
      : [...state.programBudgets, b];
    saveLS(LS_BUDGETS, next);
    return { programBudgets: next };
  }),
  recordProgramSpend: (programId, amount) => set((state) => {
    const next = state.programBudgets.map(b =>
      b.programId === programId ? { ...b, spent: b.spent + amount } : b
    );
    saveLS(LS_BUDGETS, next);
    return { programBudgets: next };
  }),
  upsertBeneficiaryOutcome: (o) => set((state) => {
    const next = state.beneficiaryOutcomes.some(x => x.id === o.id)
      ? state.beneficiaryOutcomes.map(x => x.id === o.id ? o : x)
      : [o, ...state.beneficiaryOutcomes];
    saveLS(LS_OUTCOMES, next);
    return { beneficiaryOutcomes: next };
  }),
  setGrantTranches: (grantTranches) => { saveLS(LS_TRANCHES, grantTranches); set({ grantTranches }); },
  upsertGrantTranche: (t) => set((state) => {
    const next = state.grantTranches.some(x => x.id === t.id)
      ? state.grantTranches.map(x => x.id === t.id ? { ...x, ...t } : x)
      : [...state.grantTranches, t];
    saveLS(LS_TRANCHES, next);
    return { grantTranches: next };
  }),
  releaseGrantTranche: (id) => set((state) => {
    const next = state.grantTranches.map(t =>
      t.id === id ? { ...t, status: 'released' as const, releasedAt: new Date().toISOString() } : t
    );
    saveLS(LS_TRANCHES, next);
    return { grantTranches: next };
  }),
  addMisReviewIntent: (i) => set((state) => {
    const next = [i, ...state.misReviewIntents];
    saveLS(LS_MIS, next);
    return { misReviewIntents: next };
  }),
  decideMisReviewIntent: (id, decision, patch) => set((state) => {
    const next = state.misReviewIntents.map(i =>
      i.id === id
        ? { ...i, status: decision, decidedAt: new Date().toISOString(),
            extracted: patch ? { ...i.extracted, ...patch } : i.extracted }
        : i
    );
    saveLS(LS_MIS, next);
    return { misReviewIntents: next };
  }),
  upsertVolunteerAssignment: (a) => set((state) => {
    const next = state.volunteerAssignments.some(x => x.id === a.id)
      ? state.volunteerAssignments.map(x => x.id === a.id ? { ...x, ...a } : x)
      : [a, ...state.volunteerAssignments];
    saveLS(LS_VOL_ASSIGN, next);
    return { volunteerAssignments: next };
  }),
  removeVolunteerAssignment: (id) => set((state) => {
    const next = state.volunteerAssignments.filter(a => a.id !== id);
    saveLS(LS_VOL_ASSIGN, next);
    return { volunteerAssignments: next };
  }),
  addComplianceGrantLink: (l) => set((state) => {
    if (state.complianceGrantLinks.some(x => x.grantId === l.grantId && x.complianceDocId === l.complianceDocId)) {
      return {};
    }
    const next = [l, ...state.complianceGrantLinks];
    saveLS(LS_COMP_LINKS, next);
    return { complianceGrantLinks: next };
  }),
  removeComplianceGrantLink: (id) => set((state) => {
    const next = state.complianceGrantLinks.filter(l => l.id !== id);
    saveLS(LS_COMP_LINKS, next);
    return { complianceGrantLinks: next };
  }),
  addProgramGrantLink: (l) => set((state) => {
    if (state.programGrantLinks.some(x =>
      x.programId === l.programId && String(x.grantId) === String(l.grantId)
    )) {
      return {};
    }
    const next = [{ ...l, createdAt: l.createdAt ?? new Date().toISOString() }, ...state.programGrantLinks];
    saveLS(LS_PROG_GRANT_LINKS, next);
    return { programGrantLinks: next };
  }),
  removeProgramGrantLink: (id) => set((state) => {
    const next = state.programGrantLinks.filter(l => l.id !== id);
    saveLS(LS_PROG_GRANT_LINKS, next);
    return { programGrantLinks: next };
  }),
  upsertGrantBudgetHead: (h) => set((state) => {
    const next = state.grantBudgetHeads.some(x => x.id === h.id)
      ? state.grantBudgetHeads.map(x => x.id === h.id ? { ...x, ...h } : x)
      : [...state.grantBudgetHeads, h];
    saveLS(LS_BUDGET_HEADS, next);
    return { grantBudgetHeads: next };
  }),
  removeGrantBudgetHead: (id) => set((state) => {
    const next = state.grantBudgetHeads.filter(h => h.id !== id);
    saveLS(LS_BUDGET_HEADS, next);
    // Note: tags pointing at this head become "orphan spend" surfaced by
    // selectGrantUtilisation — we don't auto-clear them so the spend is
    // visible until the user re-tags the affected transactions.
    return { grantBudgetHeads: next };
  }),
  upsertJournalEntry: (e) => set((state) => {
    const next = state.journalEntries.some(x => x.id === e.id)
      ? state.journalEntries.map(x => x.id === e.id ? { ...x, ...e } : x)
      : [e, ...state.journalEntries];
    saveLS(LS_JOURNAL_ENTRIES, next);
    return { journalEntries: next };
  }),
  setJournalEntryGrantTag: (id, tag) => set((state) => {
    const next = state.journalEntries.map(e =>
      e.id === id ? { ...e, grantTag: tag ?? undefined } : e
    );
    saveLS(LS_JOURNAL_ENTRIES, next);
    return { journalEntries: next };
  }),

  setNgoDetails: (d) => set((state) => {
    const next = { ...state.ngoDetails, ...d };
    saveLS(LS_NGO_DETAILS, next);
    return { ngoDetails: next };
  }),

  setDonors: (donors) => set(() => ({ donors })),
  setComplianceDocs: (complianceDocs) => set(() => ({ complianceDocs })),
  setTransactions: (transactions) => set(() => ({ transactions })),
  setCampaigns: (campaigns) => set(() => ({ campaigns })),
  setCsrCards: (csrCards) => set(() => ({ csrCards })),
  setVolunteers: (volunteers) => set(() => ({ volunteers })),
  setBeneficiaries: (beneficiaries) => set(() => ({ beneficiaries })),

  addCampaign: (campaign) => set((state) => ({
    campaigns: [...state.campaigns, { ...campaign, id: `c${Date.now()}`, raised: 0, donorsCount: 0 }]
  })),

  addCampaignWithId: (campaign) => set((state) => ({
    campaigns: [campaign, ...state.campaigns.filter(c => c.id !== campaign.id)]
  })),

  updateCampaign: (id, data) => set((state) => ({
    campaigns: state.campaigns.map(c => c.id === id ? { ...c, ...data } : c)
  })),

  deleteCampaign: (id) => set((state) => ({
    campaigns: state.campaigns.filter(c => c.id !== id)
  })),

  addDonor: (donor) => set((state) => ({
    donors: [...state.donors, { ...donor, id: `${Date.now()}`, totalGiven: 0, lastGift: 'N/A', initial: donor.name.charAt(0).toUpperCase() }]
  })),

  addDonorWithId: (donor) => set((state) => ({
    donors: [donor, ...state.donors.filter(d => d.id !== donor.id)]
  })),

  updateDonor: (id, data) => set((state) => ({
    donors: state.donors.map(d => d.id === id ? { ...d, ...data } : d)
  })),

  deleteDonor: (id) => set((state) => ({
    donors: state.donors.filter(d => d.id !== id)
  })),

  addTransaction: (transaction) => set((state) => {
    const newTxId = `TRX-${1000 + state.transactions.length + 100}`;
    const newTx: Transaction = { ...transaction, id: newTxId, timestamp: Date.now() };
    const updatedCampaigns = state.campaigns.map(c => {
      if (c.id === transaction.campaignId) {
        const isExisting = state.transactions.some(t => t.campaignId === c.id && t.donorId === transaction.donorId);
        return { ...c, raised: c.raised + transaction.amount, donorsCount: isExisting ? c.donorsCount : c.donorsCount + 1 };
      }
      return c;
    });
    const updatedDonors = state.donors.map(d => {
      if (d.id === transaction.donorId) return { ...d, totalGiven: d.totalGiven + transaction.amount, lastGift: new Date().toISOString().split('T')[0] };
      return d;
    });
    return { transactions: [newTx, ...state.transactions], campaigns: updatedCampaigns, donors: updatedDonors };
  }),

  addTransactionWithId: (transaction) => set((state) => {
    const newTx: Transaction = { ...transaction, timestamp: transaction.timestamp || Date.now() };
    const updatedCampaigns = state.campaigns.map(c => {
      if (c.id === newTx.campaignId) {
        const isExisting = state.transactions.some(t => t.campaignId === c.id && t.donorId === newTx.donorId);
        return { ...c, raised: c.raised + newTx.amount, donorsCount: isExisting ? c.donorsCount : c.donorsCount + 1 };
      }
      return c;
    });
    const updatedDonors = state.donors.map(d => {
      if (d.id === newTx.donorId) return { ...d, totalGiven: d.totalGiven + newTx.amount, lastGift: new Date().toISOString().split('T')[0] };
      return d;
    });
    return { transactions: [newTx, ...state.transactions.filter(t => t.id !== newTx.id)], campaigns: updatedCampaigns, donors: updatedDonors };
  }),

  moveCSRCard: (cardId, newCol) => set((state) => ({
    csrCards: state.csrCards.map(c => (String(c.id) === String(cardId) ? { ...c, col: newCol } : c)),
  })),

  addCSRCard: (card) => set((state) => ({
    csrCards: [...state.csrCards, { ...card, id: Date.now() }]
  })),

  addCSRCardWithId: (card) => set((state) => ({
    csrCards: [card, ...state.csrCards.filter(c => String(c.id) !== String(card.id))]
  })),

  updateCSRCard: (id, data) => set((state) => ({
    csrCards: state.csrCards.map(c => String(c.id) === String(id) ? { ...c, ...data } : c)
  })),

  deleteCSRCard: (id) => set((state) => ({
    csrCards: state.csrCards.filter(c => String(c.id) !== String(id))
  })),

  addBeneficiary: (b) => set((state) => ({
    beneficiaries: [{ ...b, id: `BEN-${1000 + state.beneficiaries.length + 49}` }, ...state.beneficiaries]
  })),

  updateBeneficiary: (id, data) => set((state) => ({
    beneficiaries: state.beneficiaries.map(b => b.id === id ? { ...b, ...data } : b)
  })),

  deleteBeneficiary: (id) => set((state) => ({
    beneficiaries: state.beneficiaries.filter(b => b.id !== id)
  })),

  addVolunteer: (v) => set((state) => ({
    volunteers: [{ ...v, id: `V-${100 + state.volunteers.length + 5}`, hours: 0 }, ...state.volunteers]
  })),

  updateVolunteer: (id, data) => set((state) => ({
    volunteers: state.volunteers.map(v => v.id === id ? { ...v, ...data } : v)
  })),

  deleteVolunteer: (id) => set((state) => ({
    volunteers: state.volunteers.filter(v => v.id !== id)
  })),

  addComplianceDoc: (doc) => set((state) => ({
    complianceDocs: [{ ...doc, id: doc.id ?? `doc-${Date.now()}`, uploadedAt: new Date().toISOString().split('T')[0] }, ...state.complianceDocs]
  })),

  outreachLog: [],
  addOutreachEntry: (entry) => set((state) => ({ outreachLog: [entry, ...state.outreachLog] })),
  updateOutreachEntry: (id, patch) => set((state) => ({
    outreachLog: state.outreachLog.map(e => e.id === id ? { ...e, ...patch } : e),
  })),

  programEffort: loadLS<EffortEntry[]>('goodjobs.programEffort.v1', []),
  addEffortEntry: (e) => set((state) => {
    const next = [e, ...state.programEffort];
    saveLS('goodjobs.programEffort.v1', next);
    return { programEffort: next };
  }),
}));
