import { apiFetch } from '../api/client';
import { isMockEnabled } from '../api/mockBackend';
import type { Donor, Transaction } from '../store/useStore';
import type { OutreachEntry } from '../store/useStore';
import type { Task } from './tasks';
import { generate80GReceiptPdf, nextReceiptNumber } from './donationReceiptPdf';

const DAY_MS = 86_400_000;

export type DonationWorkflowSource = 'fundraising' | 'finance' | 'public';

export interface DonationWorkflowInput {
  source: DonationWorkflowSource;
  donorId?: string;
  donorName: string;
  donorEmail?: string;
  donorPhone?: string;
  donorPan?: string;
  amount: number;
  method: string;
  campaignId?: string;
  campaignTitle?: string;
  programmeId?: string;
  description?: string;
  isAnonymous?: boolean;
  /** Public page — passed to POST /public/donations when source is public. */
  campaignSlug?: string | null;
  cause?: string;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  companyName?: string | null;
  message?: string | null;
  consentImpact?: boolean;
  /** Skip POST /finance/transactions when the API already created one. */
  existingTransactionId?: string;
  existingReceiptNumber?: string;
}

export interface DonationCompletionSnapshot {
  transactionId: string;
  donorId: string;
  donorName: string;
  amount: number;
  method: string;
  campaignTitle: string;
  source: DonationWorkflowSource;
  donorMatched: boolean;
  donorCreated: boolean;
  is80GEligible: boolean;
  receiptGenerated: boolean;
  receiptNumber?: string;
  panOnFile: boolean;
  thanked: boolean;
  donorEmail?: string;
  donorPhone?: string;
  description: string;
}

export interface DonationWorkflowDeps {
  donors: Donor[];
  campaigns: { id: string; title: string }[];
  ngoName: string;
  addDonorWithId: (d: Donor) => void;
  updateDonor: (id: string, data: Partial<Donor>) => void;
  addTransactionWithId: (t: Transaction) => void;
  upsertTask: (t: Task) => void;
  addOutreachEntry?: (e: OutreachEntry) => void;
}

export function isDonation80GEligible(
  input: Pick<DonationWorkflowInput, 'isAnonymous' | 'amount'>,
): boolean {
  if (input.isAnonymous) return false;
  return Number(input.amount) > 0;
}

export function createOrMatchDonorLocal(
  input: Pick<DonationWorkflowInput, 'donorId' | 'donorName' | 'donorEmail' | 'donorPan' | 'donorPhone'>,
  donors: Donor[],
): { donor: Donor; created: boolean; matched: boolean } {
  if (input.donorId) {
    const existing = donors.find(d => d.id === input.donorId);
    if (existing) return { donor: existing, created: false, matched: true };
    const displayName = input.donorName.trim() || 'Donor';
    return {
      donor: {
        id: input.donorId,
        name: displayName,
        type: 'Public',
        totalGiven: 0,
        lastGift: new Date().toISOString().slice(0, 10),
        initial: (displayName[0] || 'D').toUpperCase(),
        pan: input.donorPan || '',
        location: '',
        tags: ['Public'],
        email: input.donorEmail,
        phone: input.donorPhone,
      },
      created: false,
      matched: true,
    };
  }
  const email = input.donorEmail?.trim().toLowerCase();
  if (email) {
    const byEmail = donors.find(d => (d.email || '').toLowerCase() === email);
    if (byEmail) return { donor: byEmail, created: false, matched: true };
  }
  const nameKey = input.donorName.trim().toLowerCase();
  if (nameKey && nameKey !== 'anonymous') {
    const byName = donors.find(d => d.name.trim().toLowerCase() === nameKey);
    if (byName) return { donor: byName, created: false, matched: true };
  }

  const displayName = input.donorName.trim() || 'Donor';
  const donor: Donor = {
    id: `donor-${Date.now()}`,
    name: displayName,
    type: 'Individual',
    totalGiven: 0,
    lastGift: new Date().toISOString().slice(0, 10),
    initial: (displayName[0] || 'D').toUpperCase(),
    pan: input.donorPan || '',
    location: '',
    tags: ['New donor'],
    email: input.donorEmail,
    phone: input.donorPhone,
  };
  return { donor, created: true, matched: false };
}

export async function persistDonorIfNeeded(
  donor: Donor,
  created: boolean,
  addDonorWithId: (d: Donor) => void,
): Promise<Donor> {
  if (!created) return donor;
  try {
    const res = await apiFetch('/crm/donors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: donor.name,
        type: donor.type,
        pan: donor.pan || null,
        location: donor.location || null,
        tags: donor.tags,
        email: donor.email ?? null,
        phone: donor.phone ?? null,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const row = data?.donor;
      if (row?.id) {
        const persisted: Donor = {
          ...donor,
          id: String(row.id),
          name: row.name ?? donor.name,
          pan: row.pan ?? donor.pan,
          email: row.email ?? donor.email,
          phone: row.phone ?? donor.phone,
        };
        addDonorWithId(persisted);
        return persisted;
      }
    }
  } catch { /* local fallback */ }
  addDonorWithId(donor);
  return donor;
}

export async function createFinanceTransaction(args: {
  donorId: string;
  donorName: string;
  amount: number;
  method: string;
  campaignId: string;
  campaignTitle: string;
  programmeId?: string;
}): Promise<Transaction | null> {
  try {
    const res = await apiFetch('/finance/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        donorId: args.donorId,
        donorName: args.donorName,
        amount: args.amount,
        method: args.method,
        campaignId: args.campaignId,
        campaignTitle: args.campaignTitle,
        programmeId: args.programmeId || args.campaignId,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.transaction) return data.transaction as Transaction;
  } catch { /* */ }
  return null;
}

/** Warm the server-side 80G PDF when PAN is on file (background after donation POST). */
export async function prefetchDonor80gReceipt(donorId: string, txId: string): Promise<boolean> {
  try {
    const res = await apiFetch(
      `/crm/donors/${encodeURIComponent(donorId)}/80g/${encodeURIComponent(txId)}.pdf`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function issueReceiptNumber(donorId: string, ngoName: string): Promise<string | undefined> {
  if (isMockEnabled()) return nextReceiptNumber(ngoName);
  try {
    const res = await apiFetch('/finance/issue-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donor_id: donorId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.receipt_number === 'string') return data.receipt_number;
    }
  } catch { /* */ }
  return nextReceiptNumber(ngoName);
}

export function buildPostDonationTasks(snap: DonationCompletionSnapshot): Task[] {
  const now = new Date().toISOString();
  const due7 = new Date(Date.now() + 7 * DAY_MS).toISOString();
  const tasks: Task[] = [];

  tasks.push({
    id: `donation-steward:${snap.transactionId}`,
    title: `Thank ${snap.donorName} for ₹${snap.amount.toLocaleString('en-IN')}`,
    description: 'Stewardship follow-up — send a personal note within a week.',
    priority: 'normal',
    status: 'open',
    sourceType: 'agent',
    sourceAgent: 'Donation workflow',
    sourceIntentId: `donation-steward:${snap.transactionId}`,
    relatedEntityType: 'donor',
    relatedEntityId: snap.donorId,
    dueAt: due7,
    recurrence: 'none',
    createdAt: now,
    updatedAt: now,
    meta: {
      link: `/crm?donor=${encodeURIComponent(snap.donorId)}`,
      transactionId: snap.transactionId,
      source: 'donation_workflow',
    },
    onCompleteAction: { type: 'donor_touchpoint', donorId: snap.donorId, milestoneId: 'thankyou' },
  });

  if (snap.is80GEligible && !snap.panOnFile) {
    tasks.push({
      id: `donation-pan:${snap.transactionId}`,
      title: `Collect PAN for ${snap.donorName} (80G)`,
      description: 'PAN required on the receipt for tax deduction.',
      priority: 'high',
      status: 'open',
      sourceType: 'agent',
      sourceAgent: 'Donation workflow',
      sourceIntentId: `donation-pan:${snap.transactionId}`,
      relatedEntityType: 'donor',
      relatedEntityId: snap.donorId,
      dueAt: due7,
      recurrence: 'none',
      createdAt: now,
      updatedAt: now,
      meta: { link: `/crm?donor=${encodeURIComponent(snap.donorId)}` },
    });
  }

  if (snap.is80GEligible && !snap.receiptGenerated) {
    tasks.push({
      id: `donation-receipt:${snap.transactionId}`,
      title: `Issue 80G receipt for ${snap.donorName}`,
      priority: 'high',
      status: 'open',
      sourceType: 'agent',
      sourceAgent: 'Donation workflow',
      sourceIntentId: `donation-receipt:${snap.transactionId}`,
      relatedEntityType: 'donor',
      relatedEntityId: snap.donorId,
      dueAt: now,
      recurrence: 'none',
      createdAt: now,
      updatedAt: now,
      meta: { link: `/finance` },
    });
  }

  return tasks;
}

function localTransactionFallback(
  input: DonationWorkflowInput,
  donor: Donor,
  campaigns: { id: string; title: string }[],
): Transaction {
  const campaign = campaigns.find(c => c.id === input.campaignId);
  const title = input.campaignTitle || campaign?.title || 'General Fund';
  return {
    id: input.existingTransactionId || `TX-${Date.now()}`,
    donorId: donor.id,
    donorName: donor.name,
    amount: input.amount,
    method: input.method,
    campaignId: input.campaignId || campaign?.id || '',
    campaignTitle: title,
    programmeId: input.programmeId || input.campaignId,
    date: new Date().toISOString().slice(0, 10),
    timestamp: Date.now(),
  };
}

export async function recordPublicDonation(
  input: DonationWorkflowInput & {
    campaignSlug?: string | null;
    cause?: string;
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    companyName?: string | null;
    message?: string | null;
    consentImpact?: boolean;
  },
): Promise<{ transactionId: string; donorId: string; ngoName?: string } | null> {
  try {
    const res = await apiFetch('/public/donations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign_slug: input.campaignSlug ?? null,
        cause: input.cause ?? input.campaignTitle,
        donor_name: input.isAnonymous ? 'Anonymous' : input.donorName,
        donor_email: input.isAnonymous ? '' : input.donorEmail || '',
        pan: input.donorPan || null,
        amount: input.amount,
        method: input.method,
        phone: input.donorPhone || null,
        address_line1: input.addressLine1 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        pincode: input.pincode ?? null,
        company_name: input.companyName ?? null,
        message: input.message ?? null,
        consent_impact_updates: input.consentImpact ?? true,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tx = data?.transaction;
    if (!tx?.id) return null;
    return {
      transactionId: String(tx.id),
      donorId: String(tx.donorId),
      ngoName: data?.ngo_name,
    };
  } catch {
    return null;
  }
}

export async function onDonationSaved(
  input: DonationWorkflowInput,
  deps: DonationWorkflowDeps,
): Promise<DonationCompletionSnapshot> {
  let workflowInput = { ...input };
  if (input.source === 'public' && !input.existingTransactionId) {
    const pub = await recordPublicDonation(input as DonationWorkflowInput & { campaignSlug?: string | null });
    if (pub) {
      workflowInput = {
        ...workflowInput,
        existingTransactionId: pub.transactionId,
        donorId: pub.donorId,
      };
    }
  }

  const { donor: matchedDonor, created, matched } = createOrMatchDonorLocal(workflowInput, deps.donors);
  let donor = await persistDonorIfNeeded(matchedDonor, created, deps.addDonorWithId);
  if (!deps.donors.some(d => d.id === donor.id)) {
    deps.addDonorWithId(donor);
  }

  if (workflowInput.donorPan && !donor.pan) {
    donor = { ...donor, pan: workflowInput.donorPan };
    deps.updateDonor(donor.id, { pan: workflowInput.donorPan });
  }

  const campaignTitle =
    workflowInput.campaignTitle ||
    deps.campaigns.find(c => c.id === workflowInput.campaignId)?.title ||
    'General Fund';

  let transactionId = workflowInput.existingTransactionId || '';
  if (transactionId && workflowInput.source === 'public') {
    const local = localTransactionFallback(workflowInput, donor, deps.campaigns);
    local.id = transactionId;
    deps.addTransactionWithId(local);
  }
  if (!transactionId) {
    const tx = await createFinanceTransaction({
      donorId: donor.id,
      donorName: donor.name,
      amount: workflowInput.amount,
      method: workflowInput.method,
      campaignId: workflowInput.campaignId || deps.campaigns[0]?.id || 'general',
      campaignTitle,
      programmeId: workflowInput.programmeId,
    });
    if (tx) {
      deps.addTransactionWithId(tx);
      transactionId = tx.id;
    } else {
      const local = localTransactionFallback(workflowInput, donor, deps.campaigns);
      deps.addTransactionWithId(local);
      transactionId = local.id;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  if (workflowInput.source !== 'public') {
    deps.updateDonor(donor.id, {
      totalGiven: (donor.totalGiven || 0) + workflowInput.amount,
      lastGift: today,
    });
  } else {
    deps.updateDonor(donor.id, { lastGift: today });
  }

  const receiptNumber = workflowInput.existingReceiptNumber;
  const is80GEligible = isDonation80GEligible(workflowInput);
  const panOnFile = !!(donor.pan && donor.pan.replace(/\*/g, '').length >= 4);

  const snap: DonationCompletionSnapshot = {
    transactionId,
    donorId: donor.id,
    donorName: donor.name,
    amount: workflowInput.amount,
    method: workflowInput.method,
    campaignTitle,
    source: workflowInput.source,
    donorMatched: matched || !!input.donorId,
    donorCreated: created,
    is80GEligible,
    receiptGenerated: !!(receiptNumber && is80GEligible),
    receiptNumber,
    panOnFile,
    thanked: false,
    donorEmail: donor.email || workflowInput.donorEmail,
    donorPhone: donor.phone || workflowInput.donorPhone,
    description: workflowInput.description || campaignTitle,
  };

  for (const t of buildPostDonationTasks(snap)) {
    deps.upsertTask(t);
  }

  if (panOnFile && is80GEligible && transactionId) {
    const warmed = await prefetchDonor80gReceipt(donor.id, transactionId);
    if (warmed) {
      snap.receiptGenerated = true;
      if (!snap.receiptNumber) {
        snap.receiptNumber = await issueReceiptNumber(donor.id, deps.ngoName);
      }
    }
  }

  try {
    await apiFetch('/webhook/donation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'donation_received',
        donor_id: donor.id,
        donor_name: donor.name,
        donation_amount: workflowInput.amount,
        preferred_language: 'English',
      }),
    });
  } catch { /* optional agent */ }

  return snap;
}

export async function generateDonationReceiptPdf(args: {
  snapshot: DonationCompletionSnapshot;
  donorPan: string;
  ngoName: string;
  ngoPan: string;
  eightyGRegNo: string;
}): Promise<string> {
  const receiptNo =
    args.snapshot.receiptNumber ||
    (await issueReceiptNumber(args.snapshot.donorId, args.ngoName));
  if (!receiptNo) throw new Error('Could not allocate receipt number');

  const doc = generate80GReceiptPdf({
    receiptNo,
    donorName: args.snapshot.donorName,
    donorPan: args.donorPan || '',
    amount: args.snapshot.amount,
    date: new Date().toLocaleDateString('en-IN'),
    description: args.snapshot.description,
    ngoName: args.ngoName,
    ngoPan: args.ngoPan,
    eighty_g_no: args.eightyGRegNo,
  });
  doc.save(`${receiptNo.replace(/\//g, '_')}.pdf`);
  return receiptNo;
}

export async function sendDonationReceiptChannel(
  snapshot: DonationCompletionSnapshot,
  channel: 'whatsapp' | 'email',
  receiptNumber?: string,
): Promise<boolean> {
  const receiptLine = receiptNumber
    ? `Your 80G receipt (${receiptNumber}) for ₹${snapshot.amount.toLocaleString('en-IN')} is ready.`
    : `Thank you for your gift of ₹${snapshot.amount.toLocaleString('en-IN')}.`;
  const message = `Dear ${snapshot.donorName.split(' ')[0]}, ${receiptLine} — ${snapshot.campaignTitle}. With gratitude.`;
  try {
    const path = channel === 'email' ? '/crm/outreach/email' : '/crm/outreach';
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'draft',
        channel,
        donor_ids: [snapshot.donorId],
        template_id: 'thank',
        message,
        subject: channel === 'email' ? `Thank you — 80G receipt ${receiptNumber || ''}`.trim() : undefined,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function markDonationThanked(
  snapshot: DonationCompletionSnapshot,
  addOutreachEntry?: (e: OutreachEntry) => void,
): void {
  if (addOutreachEntry) {
    addOutreachEntry({
      id: `out-thank-${snapshot.transactionId}`,
      donorId: snapshot.donorId,
      timestamp: Date.now(),
      date: new Date().toISOString().slice(0, 10),
      channel: 'whatsapp',
      template: 'thank',
      status: 'sent',
    });
  }
}

export function donationCompletionHeadline(snap: DonationCompletionSnapshot): string {
  if (snap.receiptGenerated && snap.thanked) {
    return 'Receipt sent and donor thanked. Stewardship is on track.';
  }
  if (snap.receiptGenerated) {
    return 'Receipt generated. Donor stewardship started.';
  }
  if (snap.is80GEligible) {
    return 'Donation recorded. Generate 80G receipt to finish compliance.';
  }
  return 'Donation recorded. Donor stewardship started.';
}
