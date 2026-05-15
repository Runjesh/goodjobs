import { create } from 'zustand';
import type { Task } from '../utils/tasks';
import { buildRecurringNextInstance } from '../utils/tasks';
import { applyTaskCompletion } from '../utils/taskDispatcher';
import type { BeneficiaryOutcome } from '../utils/outcomes';
import type { ProgramBudget } from '../utils/programFinance';
import type { GrantTranche } from '../utils/grantLifecycle';
import type { ProgramGrantLink } from '../utils/programGrantLink';
import type { ComplianceGrantLink } from '../utils/complianceGrant';
import type { GrantBudgetHead, JournalExpense } from '../utils/grantBudgetHeads';
import type { VolunteerAssignment } from '../utils/volunteerProgram';
import type { ReportRecord } from '../data/reportsCatalogue';
import { notifyStoreChanged } from '../utils/storeNotify';

const TASKS_LS = 'goodjobs.tasks.v1';
const GRANT_REPORTS_LS = 'goodjobs.grant_reports.v1';

function loadGrantReportsFromLs(): ReportRecord[] {
  try {
    const raw = localStorage.getItem(GRANT_REPORTS_LS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as ReportRecord[]) : [];
  } catch {
    return [];
  }
}

function persistGrantReports(reports: ReportRecord[]) {
  try {
    localStorage.setItem(GRANT_REPORTS_LS, JSON.stringify(reports));
  } catch { /* ignore */ }
}

function loadTasksFromLs(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_LS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as Task[]) : [];
  } catch {
    return [];
  }
}

function persistTasks(tasks: Task[]) {
  try {
    localStorage.setItem(TASKS_LS, JSON.stringify(tasks));
  } catch {
    /* ignore */
  }
}

export type { Task };
export type { BeneficiaryOutcome };
export type { ProgramBudget };
export type { GrantTranche };
export type { ProgramGrantLink };
export type { ComplianceGrantLink };
export type { GrantBudgetHead };
export type { VolunteerAssignment };
export type JournalEntry = JournalExpense;

export interface MisReviewIntent {
  id: string;
  narrative: string;
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
  status: 'pending' | 'approved' | 'edited' | 'rejected' | 'dismissed';
  decidedAt?: string;
}

export interface OutreachEntry {
  id: string;
  donorId: string;
  timestamp: number;
  date: string;
  channel: 'email' | 'whatsapp' | string;
  template: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  outreachId?: string;
}

export interface EffortEntry {
  id: string;
  staffName: string;
  date: string;
  hours: number;
  type: string;
  programme: string;
  createdAt: string;
}

export interface PendingTeamMember {
  email: string;
  role: string;
  invitedAt: string;
}

export interface NgoDetails {
  name?: string;
  pan?: string;
  reg_no?: string;
  fcra_reg?: string;
  eighty_g_no?: string;
  state?: string;
  whatsapp?: string;
  /** Primary cause / thematic area for proposals and AI prompts. */
  causeArea?: string;
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
  /** Programme / campaign anchor for budget & impact rollups (optional for legacy rows). */
  programmeId?: string;
  date: string;
  timestamp: number;
  /** Linked CSR / finance grant id when tagged. */
  grantId?: string;
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
  /** ISO timestamp — last pipeline activity (aligned with backend updated_at in DB mode). */
  last_activity_at?: string;
  updated_at?: string;
  created_at?: string;
  /** Grant report due date (ISO yyyy-mm-dd). */
  report_due_date?: string;
  /** ISO timestamp — when the card entered the current pipeline column. */
  stage_entered_at?: string;
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
  /** Owner user id or email for workflow queues. */
  assigned_to?: string;
  /** e.g. 80G / CSR-1 registration number shown on receipts. */
  registration_number?: string;
}

interface AppState {
  donors: Donor[];
  campaigns: Campaign[];
  transactions: Transaction[];
  csrCards: CSRCard[];
  beneficiaries: Beneficiary[];
  volunteers: Volunteer[];
  complianceDocs: ComplianceDocument[];

  tasks: Task[];
  ngoDetails: NgoDetails;
  journalEntries: JournalEntry[];
  misReviewIntents: MisReviewIntent[];
  beneficiaryOutcomes: BeneficiaryOutcome[];
  customPrograms: string[];
  programBudgets: ProgramBudget[];
  grantTranches: GrantTranche[];
  grantBudgetHeads: GrantBudgetHead[];
  programGrantLinks: ProgramGrantLink[];
  complianceGrantLinks: ComplianceGrantLink[];
  grantReports: ReportRecord[];
  pendingTeamMembers: PendingTeamMember[];
  outreachLog: OutreachEntry[];
  programEffort: EffortEntry[];
  volunteerAssignments: VolunteerAssignment[];

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

  addTask: (task: Task) => void;
  upsertTaskByIntent: (task: Task) => void;
  completeTask: (taskId: string, at?: Date) => Task | false;
  snoozeTask: (taskId: string, untilIso: string) => void;
  dismissTask: (taskId: string) => void;

  setNgoDetails: (patch: Partial<NgoDetails>) => void;
  upsertJournalEntry: (entry: JournalEntry) => void;
  setJournalEntryGrantTag: (entryId: string, tag: { grantId: string; budgetHeadId: string } | null) => void;

  addMisReviewIntent: (intent: MisReviewIntent) => void;
  decideMisReviewIntent: (
    id: string,
    status: MisReviewIntent['status'],
    extractedPatch?: MisReviewIntent['extracted'],
  ) => void;

  upsertBeneficiaryOutcome: (o: BeneficiaryOutcome) => void;
  addCustomProgram: (name: string) => void;
  upsertProgramBudget: (b: ProgramBudget) => void;

  upsertGrantBudgetHead: (h: GrantBudgetHead) => void;
  removeGrantBudgetHead: (id: string) => void;
  upsertGrantTranche: (t: GrantTranche) => void;
  releaseGrantTranche: (id: string) => void;

  addProgramGrantLink: (link: ProgramGrantLink) => void;
  removeProgramGrantLink: (id: string) => void;
  addComplianceGrantLink: (link: ComplianceGrantLink) => void;
  upsertGrantReport: (report: ReportRecord) => void;
  setGrantReports: (reports: ReportRecord[]) => void;

  addPendingTeamMember: (m: PendingTeamMember) => void;
  updatePendingTeamMember: (email: string, role: string) => void;
  removePendingTeamMember: (email: string) => void;

  addEffortEntry: (e: EffortEntry) => void;
  upsertVolunteerAssignment: (a: VolunteerAssignment) => void;
  removeVolunteerAssignment: (id: string) => void;

  addOutreachEntry: (e: OutreachEntry) => void;
  updateOutreachEntry: (id: string, patch: Partial<OutreachEntry>) => void;
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
  { id: 5, company: 'Mahindra Finance', amount: 4500000, project: 'Farmer Support Init', tags: ['Agriculture'], agent: 'RS', col: 'live', date: 'Report due: Nov 30' },
  { id: 6, company: 'Infosys Foundation', amount: 6000000, project: 'STEM for Girls', tags: ['Education'], agent: 'AD', col: 'live', date: 'Report due: Dec 15' }
];

export const initialBeneficiaries: Beneficiary[] = [
  { id: 'BEN-1045', name: 'Lakshmi Devi', program: 'Women Livelihood Center', location: 'Nashik, MH', aadhaar: true, familySize: 4 },
  { id: 'BEN-1046', name: 'Rahul Kumar', program: 'Digital Literacy 2026', location: 'Patna, BR', aadhaar: true, familySize: 1 },
  { id: 'BEN-1047', name: 'Sunita Bai', program: 'Healthcare Camp', location: 'Pune, MH', aadhaar: false, familySize: 3 },
  { id: 'BEN-1048', name: 'Anita Desai', program: 'Women Livelihood Center', location: 'Nashik, MH', aadhaar: true, familySize: 5 },
];

const initialVolunteers: Volunteer[] = [
  { id: 'V-101', name: 'Rohan Sharma', skills: ['Teaching', 'English'], hours: 45, verified: true },
  { id: 'V-102', name: 'Priya Patel', skills: ['Medical Camp', 'Admin'], hours: 120, verified: true },
  { id: 'V-103', name: 'Karan Singh', skills: ['Logistics'], hours: 8, verified: false },
  { id: 'V-104', name: 'Neha Gupta', skills: ['Social Media', 'Photography'], hours: 32, verified: true },
];

export const useStore = create<AppState>((set, get) => ({
  donors: [],
  campaigns: [],
  transactions: [],
  csrCards: [],
  beneficiaries: [],
  volunteers: [],
  complianceDocs: [],

  tasks: typeof localStorage !== 'undefined' ? loadTasksFromLs() : [],
  ngoDetails: {},
  journalEntries: [],
  misReviewIntents: [],
  beneficiaryOutcomes: [],
  customPrograms: [],
  programBudgets: [],
  grantTranches: [],
  grantBudgetHeads: [],
  programGrantLinks: [],
  complianceGrantLinks: [],
  grantReports: typeof localStorage !== 'undefined' ? loadGrantReportsFromLs() : [],
  pendingTeamMembers: [],
  outreachLog: [],
  programEffort: [],
  volunteerAssignments: [],

  setDonors: (donors) => set(() => ({ donors })),
  setComplianceDocs: (complianceDocs) => {
    set(() => ({ complianceDocs }));
    notifyStoreChanged();
  },
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

  moveCSRCard: (cardId, newCol) => set((state) => {
    const now = new Date().toISOString();
    return {
      csrCards: state.csrCards.map(c =>
        String(c.id) === String(cardId)
          ? { ...c, col: newCol, stage_entered_at: now, last_activity_at: now }
          : c,
      ),
    };
  }),

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

  addComplianceDoc: (doc) => set((state) => {
    const id = doc.id ?? `doc-${Date.now()}`;
    const uploadedAt =
      'uploadedAt' in doc && typeof (doc as ComplianceDocument).uploadedAt === 'string'
        ? (doc as ComplianceDocument).uploadedAt
        : new Date().toISOString().split('T')[0];
    const row: ComplianceDocument = { ...(doc as ComplianceDocument), id, uploadedAt };
    return { complianceDocs: [row, ...state.complianceDocs.filter(d => d.id !== id)] };
  }),

  addTask: (task) => {
    set((state) => {
      const tasks = [task, ...state.tasks.filter(t => t.id !== task.id)];
      persistTasks(tasks);
      return { tasks };
    });
    notifyStoreChanged();
  },

  upsertTaskByIntent: (incoming) => {
    set((state) => {
    const key = incoming.sourceIntentId;
    let tasks: Task[];
    if (!key) {
      tasks = [incoming, ...state.tasks.filter(t => t.id !== incoming.id)];
    } else {
      const idx = state.tasks.findIndex(t => t.sourceIntentId === key);
      if (idx === -1) {
        tasks = [incoming, ...state.tasks];
      } else {
        const prior = state.tasks[idx];
        const merged: Task = {
          ...prior,
          title: incoming.title,
          description: incoming.description,
          relatedEntityType: prior.relatedEntityType ?? incoming.relatedEntityType,
          relatedEntityId: prior.relatedEntityId ?? incoming.relatedEntityId,
          onCompleteAction: prior.onCompleteAction ?? incoming.onCompleteAction,
          priority: incoming.priority,
          meta: { ...(prior.meta ?? {}), ...(incoming.meta ?? {}) },
          updatedAt: incoming.updatedAt,
        };
        const next = state.tasks.slice();
        next[idx] = merged;
        tasks = next;
      }
    }
    persistTasks(tasks);
    return { tasks };
    });
    notifyStoreChanged();
  },

  completeTask: (taskId, at = new Date()) => {
    const state = get();
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return false;
    const res = applyTaskCompletion(task, {
      complianceDocs: state.complianceDocs,
      setComplianceDocs: (docs) => set({ complianceDocs: docs as ComplianceDocument[] }),
      csrCards: state.csrCards,
      updateCSRCard: (id, data) => get().updateCSRCard(id, data as Partial<CSRCard>),
      beneficiaries: state.beneficiaries,
      updateBeneficiary: (id, data) => get().updateBeneficiary(id, data as Partial<Beneficiary>),
    }, at);
    if (!res.ok) return false;

    let completedSnapshot: Task | false = false;
    set((s) => {
      const t = s.tasks.find(x => x.id === taskId);
      if (!t) return {};
      const nowIso = at.toISOString();
      const done: Task = { ...t, status: 'done', completedAt: nowIso, updatedAt: nowIso };
      completedSnapshot = done;
      let nextTasks = s.tasks.map(x => (x.id === taskId ? done : x));
      const recur = buildRecurringNextInstance(done, at);
      if (recur) nextTasks = [recur, ...nextTasks];
      persistTasks(nextTasks);
      return { tasks: nextTasks };
    });
    notifyStoreChanged();
    return completedSnapshot;
  },

  snoozeTask: (taskId, untilIso) => set((state) => {
    const tasks = state.tasks.map(t =>
      t.id === taskId
        ? { ...t, status: 'snoozed' as const, snoozeUntil: untilIso, updatedAt: new Date().toISOString() }
        : t,
    );
    persistTasks(tasks);
    return { tasks };
  }),

  dismissTask: (taskId) => set((state) => {
    const tasks = state.tasks.map(t =>
      t.id === taskId
        ? { ...t, status: 'dismissed' as const, updatedAt: new Date().toISOString() }
        : t,
    );
    persistTasks(tasks);
    return { tasks };
  }),

  setNgoDetails: (patch) => set((state) => ({
    ngoDetails: { ...state.ngoDetails, ...patch },
  })),

  upsertJournalEntry: (entry) => set((state) => ({
    journalEntries: [entry, ...state.journalEntries.filter(j => j.id !== entry.id)],
  })),

  setJournalEntryGrantTag: (entryId, tag) => set((state) => ({
    journalEntries: state.journalEntries.map(j => {
      if (j.id !== entryId) return j;
      if (tag == null) {
        const { grantTag: _g, ...rest } = j;
        return { ...rest };
      }
      return { ...j, grantTag: tag, grantId: tag.grantId };
    }),
  })),

  addMisReviewIntent: (intent) => set((state) => ({
    misReviewIntents: [intent, ...state.misReviewIntents.filter(i => i.id !== intent.id)],
  })),

  decideMisReviewIntent: (id, status, extractedPatch) => set((state) => ({
    misReviewIntents: state.misReviewIntents.map(i => {
      if (i.id !== id) return i;
      const decidedAt = status === 'pending' ? i.decidedAt : new Date().toISOString();
      const extracted = extractedPatch
        ? { ...i.extracted, ...extractedPatch }
        : i.extracted;
      return { ...i, status, decidedAt, extracted };
    }),
  })),

  upsertBeneficiaryOutcome: (o) => set((state) => ({
    beneficiaryOutcomes: [o, ...state.beneficiaryOutcomes.filter(x => x.id !== o.id)],
  })),

  addCustomProgram: (name) => set((state) => {
    const t = name.trim();
    if (!t || state.customPrograms.includes(t)) return state;
    return { customPrograms: [...state.customPrograms, t] };
  }),

  upsertProgramBudget: (b) => set((state) => ({
    programBudgets: [b, ...state.programBudgets.filter(x => x.programId !== b.programId)],
  })),

  upsertGrantBudgetHead: (h) => set((state) => ({
    grantBudgetHeads: [h, ...state.grantBudgetHeads.filter(x => x.id !== h.id)],
  })),

  removeGrantBudgetHead: (id) => set((state) => ({
    grantBudgetHeads: state.grantBudgetHeads.filter(h => h.id !== id),
  })),

  upsertGrantTranche: (t) => set((state) => ({
    grantTranches: [t, ...state.grantTranches.filter(x => x.id !== t.id)],
  })),

  releaseGrantTranche: (id) => set((state) => {
    const now = new Date().toISOString();
    return {
      grantTranches: state.grantTranches.map(tr =>
        tr.id === id
          ? { ...tr, status: 'released' as const, releasedAt: now }
          : tr,
      ),
    };
  }),

  addProgramGrantLink: (link) => set((state) => ({
    programGrantLinks: [link, ...state.programGrantLinks.filter(l => l.id !== link.id)],
  })),

  removeProgramGrantLink: (id) => set((state) => ({
    programGrantLinks: state.programGrantLinks.filter(l => l.id !== id),
  })),

  addComplianceGrantLink: (link) => set((state) => ({
    complianceGrantLinks: [link, ...state.complianceGrantLinks.filter(l => l.id !== link.id)],
  })),

  upsertGrantReport: (report) => set((state) => {
    const grantReports = [report, ...state.grantReports.filter(r => r.id !== report.id)];
    persistGrantReports(grantReports);
    return { grantReports };
  }),

  setGrantReports: (reports) => set(() => {
    persistGrantReports(reports);
    return { grantReports: reports };
  }),

  addPendingTeamMember: (m) => set((state) => {
    const email = m.email.trim().toLowerCase();
    if (!email) return state;
    if (state.pendingTeamMembers.some(x => x.email.toLowerCase() === email)) return state;
    return { pendingTeamMembers: [...state.pendingTeamMembers, { ...m, email: m.email.trim() }] };
  }),

  updatePendingTeamMember: (email, role) => set((state) => ({
    pendingTeamMembers: state.pendingTeamMembers.map(m =>
      m.email === email ? { ...m, role } : m,
    ),
  })),

  removePendingTeamMember: (email) => set((state) => ({
    pendingTeamMembers: state.pendingTeamMembers.filter(m => m.email !== email),
  })),

  addEffortEntry: (e) => set((state) => ({
    programEffort: [e, ...state.programEffort],
  })),

  upsertVolunteerAssignment: (a) => set((state) => ({
    volunteerAssignments: [a, ...state.volunteerAssignments.filter(x => x.id !== a.id)],
  })),

  removeVolunteerAssignment: (id) => set((state) => ({
    volunteerAssignments: state.volunteerAssignments.filter(a => a.id !== id),
  })),

  addOutreachEntry: (e) => set((state) => ({
    outreachLog: [e, ...state.outreachLog],
  })),

  updateOutreachEntry: (id, patch) => set((state) => ({
    outreachLog: state.outreachLog.map(o => (o.id === id ? { ...o, ...patch } : o)),
  })),
}));
