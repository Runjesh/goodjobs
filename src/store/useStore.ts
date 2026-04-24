import { create } from 'zustand';

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
}

export interface Campaign {
  id: string;
  title: string;
  raised: number;
  goal: number;
  donorsCount: number;
  status: 'active' | 'draft';
  image: string;
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
}

export interface CSRCard {
  id: number;
  company: string;
  amount: number;
  project: string;
  tags: string[];
  agent: string;
  col: string;
  date: string;
}

export interface Beneficiary {
  id: string;
  name: string;
  program: string;
  location: string;
  aadhaar: boolean;
  familySize: number;
}

export interface Volunteer {
  id: string;
  name: string;
  skills: string[];
  hours: number;
  verified: boolean;
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
}

interface AppState {
  donors: Donor[];
  campaigns: Campaign[];
  transactions: Transaction[];
  csrCards: CSRCard[];
  beneficiaries: Beneficiary[];
  volunteers: Volunteer[];
  complianceDocs: ComplianceDocument[];

  addCampaign: (campaign: Omit<Campaign, 'id' | 'raised' | 'donorsCount'>) => void;
  addDonor: (donor: Omit<Donor, 'id' | 'totalGiven' | 'lastGift' | 'initial'>) => void;
  addTransaction: (transaction: Omit<Transaction, 'id' | 'timestamp'>) => void;
  moveCSRCard: (cardId: number, newCol: string) => void;
  addCSRCard: (card: Omit<CSRCard, 'id'>) => void;
  addBeneficiary: (b: Omit<Beneficiary, 'id'>) => void;
  addVolunteer: (v: Omit<Volunteer, 'id' | 'hours'>) => void;
  addComplianceDoc: (doc: Omit<ComplianceDocument, 'id' | 'uploadedAt'>) => void;
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

const initialBeneficiaries: Beneficiary[] = [
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

const initialComplianceDocs: ComplianceDocument[] = [
  { id: 'doc-1', name: '12A Registration', type: 'Tax Exemption', status: 'Valid', expiry: '2028-03-31', uploadedAt: '2023-04-01' },
  { id: 'doc-2', name: '80G Certificate', type: 'Donor Deduction', status: 'Expiring Soon', expiry: '2026-09-30', uploadedAt: '2023-10-01' },
  { id: 'doc-3', name: 'FCRA Registration', type: 'Foreign Contribution', status: 'Valid', expiry: '2028-11-15', uploadedAt: '2023-11-20' },
  { id: 'doc-4', name: 'CSR-1 Filing', type: 'CSR Eligibility', status: 'Valid', expiry: '2027-03-31', uploadedAt: '2024-04-10' },
];

export const useStore = create<AppState>((set) => ({
  donors: initialDonors,
  campaigns: initialCampaigns,
  transactions: initialTransactions,
  csrCards: initialCSRCards,
  beneficiaries: initialBeneficiaries,
  volunteers: initialVolunteers,
  complianceDocs: initialComplianceDocs,

  addCampaign: (campaign) => set((state) => ({
    campaigns: [...state.campaigns, { ...campaign, id: `c${Date.now()}`, raised: 0, donorsCount: 0 }]
  })),

  addDonor: (donor) => set((state) => ({
    donors: [...state.donors, { ...donor, id: `${Date.now()}`, totalGiven: 0, lastGift: 'N/A', initial: donor.name.charAt(0).toUpperCase() }]
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

  moveCSRCard: (cardId, newCol) => set((state) => ({
    csrCards: state.csrCards.map(c => c.id === cardId ? { ...c, col: newCol } : c)
  })),

  addCSRCard: (card) => set((state) => ({
    csrCards: [...state.csrCards, { ...card, id: Date.now() }]
  })),

  addBeneficiary: (b) => set((state) => ({
    beneficiaries: [{ ...b, id: `BEN-${1000 + state.beneficiaries.length + 49}` }, ...state.beneficiaries]
  })),

  addVolunteer: (v) => set((state) => ({
    volunteers: [{ ...v, id: `V-${100 + state.volunteers.length + 5}`, hours: 0 }, ...state.volunteers]
  })),

  addComplianceDoc: (doc) => set((state) => ({
    complianceDocs: [{ ...doc, id: `doc-${Date.now()}`, uploadedAt: new Date().toISOString().split('T')[0] }, ...state.complianceDocs]
  })),
}));
