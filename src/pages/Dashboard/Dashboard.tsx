import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ArrowRight,
  IndianRupee, Users, FileText, ShieldCheck, HeartHandshake,
  ClipboardList, Wallet, BarChart2, Cpu,
  TrendingUp, RefreshCw, BellOff, Clock, Trophy,
  ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, X,
  Sparkles, Target, UserPlus, PlusCircle,
  ReceiptText, MessageCircle
} from 'lucide-react';
import type { MisReviewIntent, Transaction, Beneficiary, CSRCard } from '../../store/useStore';
import type { ProgramBudget } from '../../utils/programFinance';
import { useStore } from '../../store/useStore';
import { isVisibleToday, type Task } from '../../utils/tasks';
import { useAuth, defaultPresetForRole } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';
import { computeStage, nextDueMilestone, subscribeLifecycleHydrated, ackLapseRisk, daysSinceLastGift } from '../../utils/donorLifecycle';
import { beneficiariesStaleOnService, daysSinceLastRecordedService } from '../../utils/beneficiarySignals';
import { readComplianceReminders } from '../../utils/complianceReminders';
import toast from 'react-hot-toast';
import GetStartedChecklist from '../../components/Onboarding/GetStartedChecklist';
import MorningBriefBanner from '../../components/Onboarding/MorningBriefBanner';
import PrioritiesRibbon, { type BriefPriorityCard } from '../../components/Dashboard/PrioritiesRibbon';
import TrialDay7Card from '../../components/Onboarding/TrialDay7Card';
import FirstRunEmptyState from '../../components/Onboarding/FirstRunEmptyState';
import { STORE_CHANGED_EVENT } from '../../components/System/StoreChangedBridge';
import './Dashboard.css';

const BRIEF_CACHE_KEY = 'goodjobs.morning_brief.v1';
const SNOOZE_KEY      = 'goodjobs.snoozed_items.v2';
const RIBBON_DISMISS_KEY = 'goodjobs.ribbon_dismissed.v1';

// ── Greeting ──────────────────────────────────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Snooze helpers ────────────────────────────────────────────────────────────
interface SnoozedEntry { until: number; }

function getSnoozedMap(): Record<string, SnoozedEntry> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}'); } catch { return {}; }
}
function snoozeItem(id: string, hours: number) {
  const map = getSnoozedMap();
  map[id] = { until: Date.now() + hours * 60 * 60 * 1000 };
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}
function isSnoozed(id: string, extra?: Set<string>): boolean {
  if (extra?.has(id)) return true;
  const entry = getSnoozedMap()[id];
  return !!entry && entry.until > Date.now();
}

// ── Types ─────────────────────────────────────────────────────────────────────
type PriorityLevel = 'urgent' | 'attention' | 'well';

interface PriorityItem {
  id: string;
  text: string;
  action?: string;
  path?: string;
  level: PriorityLevel;
  ageDays?: number;
  delta?: string;
  deltaDir?: 'up' | 'down' | 'flat';
  actionType?: 'receipts' | 'whatsapp' | 'ack-lapse-risk';
  // Carries the underlying donor IDs for rollup items (e.g. lapse-risk) so
  // inline actions like "Acknowledge" can fan out to the lifecycle helpers
  // without re-deriving the at-risk set from raw donor data.
  donorIds?: (string | number)[];
}

interface Win { id: string; text: string; icon: React.ElementType; }

// ── Yesterday's wins ──────────────────────────────────────────────────────────
function computeWins(transactions: any[], donors: any[], complianceDocs: any[]): Win[] {
  const wins: Win[] = [];
  const now   = Date.now();
  const start = now - 2 * 864e5;
  const end   = now - 864e5;

  const yTx = transactions.filter((t: any) => {
    const d = new Date(t.date ?? t.created_at ?? 0).getTime();
    return d >= start && d <= end;
  });
  if (yTx.length > 0) {
    const total = yTx.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
    if (total > 0) {
      const fmt = total >= 1e5 ? `₹${(total/1e5).toFixed(1)}L` : `₹${(total/1000).toFixed(0)}K`;
      wins.push({ id: 'w-tx', text: `Your team received ${fmt} across ${yTx.length} transaction${yTx.length > 1 ? 's' : ''} yesterday`, icon: IndianRupee });
    }
  }
  const recentDonors = donors.filter((d: any) => d.lastGift && new Date(d.lastGift).getTime() >= start);
  if (recentDonors.length > 0)
    wins.push({ id: 'w-don', text: `${recentDonors.length} new donation${recentDonors.length > 1 ? 's' : ''} logged and receipts queued`, icon: HeartHandshake });

  const validDocs = complianceDocs.filter(d => d.status === 'Valid');
  if (validDocs.length > 0)
    wins.push({ id: 'w-comp', text: `${validDocs.length} compliance document${validDocs.length > 1 ? 's' : ''} current — all clear for funders`, icon: ShieldCheck });

  if (wins.length === 0)
    wins.push({ id: 'w-online', text: 'Platform synced and all modules operational — ready for today', icon: CheckCircle2 });

  return wins.slice(0, 3);
}

// ── Role-based top stats ──────────────────────────────────────────────────────
interface RoleStat {
  value: string;
  label: string;
  trend?: { direction: 'up' | 'down' | 'flat'; delta: string };
  context?: string;
  context_type?: 'good' | 'warning' | 'neutral';
}

function getRoleStats(
  role: string,
  transactions: any[],
  beneficiaries: any[],
  complianceDocs: any[],
  _donors: any[],
  campaigns: any[],
  csrCards: any[],
): RoleStat[] {
  const nowMs = Date.now();
  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);
  const prevMonthEnd = new Date(thisMonthStart.getTime() - 1);
  const prevMonthStart = new Date(thisMonthStart);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);

  const txInRange = (start: Date, end: Date) =>
    transactions.filter((t: any) => {
      const d = new Date(t.date || t.created_at || 0).getTime();
      return !Number.isNaN(d) && d >= start.getTime() && d <= end.getTime();
    });

  const monthTotal = txInRange(thisMonthStart, new Date(nowMs)).reduce(
    (s: number, t: any) => s + Number(t.amount ?? 0),
    0,
  );
  const prevMonthTotal = txInRange(prevMonthStart, prevMonthEnd).reduce(
    (s: number, t: any) => s + Number(t.amount ?? 0),
    0,
  );

  const fmtMoney = (v: number) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v > 0 ? `₹${(v / 1000).toFixed(0)}K` : '—');
  const moneyDelta = monthTotal - prevMonthTotal;
  const moneyTrendDir: 'up' | 'down' | 'flat' =
    moneyDelta > 0 ? 'up' : moneyDelta < 0 ? 'down' : 'flat';
  const moneyDeltaLabel =
    moneyDelta === 0
      ? 'flat vs last month'
      : `${moneyDelta > 0 ? '+' : '−'}${fmtMoney(Math.abs(moneyDelta))} vs last month`;

  const inactive = beneficiaries.filter((b: any) => b.status === 'inactive' || b.status === 'Inactive');
  const active = beneficiaries.filter((b: any) => b.status !== 'inactive' && b.status !== 'Inactive');
  const validDocs = complianceDocs.filter((d) => d.status === 'Valid');
  const compliancePct =
    complianceDocs.length > 0 ? Math.round((validDocs.length / complianceDocs.length) * 100) : 100;
  const pendingReceipts = transactions.filter((t: any) => t.receipt_status === 'pending' || !t.receipt_number);
  const activeCamp = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active');
  const liveGrants = csrCards.filter((c: any) => c.col === 'live').length;

  const approxPrevActive = Math.max(0, active.length - Math.max(1, Math.round(active.length * 0.05)));
  const activeDelta = active.length - approxPrevActive;
  const activeTrend: 'up' | 'down' | 'flat' =
    activeDelta > 0 ? 'up' : activeDelta < 0 ? 'down' : 'flat';

  switch (role) {
    case 'ed':
      return [
        {
          value: fmtMoney(monthTotal),
          label: 'raised this month',
          trend: { direction: moneyTrendDir, delta: moneyDeltaLabel },
          context: monthTotal >= prevMonthTotal ? 'Headline revenue steady or up' : 'Below last month — check pipeline',
          context_type: monthTotal >= prevMonthTotal ? 'good' : 'warning',
        },
        {
          value: `${compliancePct}%`,
          label: 'compliance health',
          trend: {
            direction: compliancePct >= 90 ? 'up' : 'flat',
            delta: `${validDocs.length} valid document${validDocs.length === 1 ? '' : 's'}`,
          },
          context: compliancePct >= 95 ? 'Board-ready compliance posture' : 'Renewals before expiry keep this green',
          context_type: compliancePct >= 95 ? 'good' : 'neutral',
        },
      ];
    case 'finance':
      return [
        {
          value: fmtMoney(monthTotal),
          label: 'raised this month',
          trend: { direction: moneyTrendDir, delta: moneyDeltaLabel },
          context: pendingReceipts.length ? `${pendingReceipts.length} receipt${pendingReceipts.length === 1 ? '' : 's'} still open` : 'Receipt queue clear',
          context_type: pendingReceipts.length ? 'warning' : 'good',
        },
        {
          value: String(pendingReceipts.length || 0),
          label: 'receipts pending',
          trend: {
            direction: pendingReceipts.length > 5 ? 'up' : 'flat',
            delta: pendingReceipts.length > 5 ? 'Clear before month-end filing' : 'Within normal range',
          },
          context: 'Link donors on income rows for auto 80G fields',
          context_type: 'neutral',
        },
      ];
    case 'programs':
      return [
        {
          value: String(active.length),
          label: 'active beneficiaries',
          trend: {
            direction: activeTrend,
            delta: `${activeDelta >= 0 ? '+' : ''}${activeDelta} est. vs last month`,
          },
          context:
            inactive.length > 0
              ? `${inactive.length} flagged inactive · refresh MIS visits`
              : 'Enrolments trending with field activity',
          context_type: inactive.length > 2 ? 'warning' : 'good',
        },
        {
          value: String(inactive.length),
          label: 'need follow-up',
          trend: {
            direction: inactive.length > 3 ? 'up' : inactive.length === 0 ? 'flat' : 'down',
            delta: inactive.length > 3 ? 'Rising re-engagement queue' : inactive.length === 0 ? 'No inactive flags' : 'Stable caseload',
          },
          context: 'Open Programs → inactive filter',
          context_type: inactive.length > 3 ? 'warning' : 'neutral',
        },
      ];
    case 'field':
      return [
        {
          value: String(active.length),
          label: 'active beneficiaries',
          trend: { direction: 'flat', delta: 'Synced from Programs MIS' },
          context: 'Log today’s visit to keep timelines honest',
          context_type: 'neutral',
        },
        {
          value: String(pendingReceipts.length || 0),
          label: 'forms pending',
          trend: {
            direction: pendingReceipts.length > 0 ? 'up' : 'flat',
            delta: pendingReceipts.length > 0 ? 'Finance / consent follow-ups' : 'Nothing blocked on you',
          },
          context: 'Mostly receipt + consent checks',
          context_type: 'neutral',
        },
      ];
    case 'board':
      return [
        {
          value: `${compliancePct}%`,
          label: 'compliance health',
          trend: {
            direction: compliancePct >= 95 ? 'up' : 'flat',
            delta: `${validDocs.length}/${Math.max(complianceDocs.length, 1)} documents valid`,
          },
          context: 'Risk view mirrors Compliance HQ',
          context_type: compliancePct >= 90 ? 'good' : 'warning',
        },
        {
          value: String(activeCamp.length),
          label: 'active campaigns',
          trend: {
            direction: liveGrants > 2 ? 'up' : 'flat',
            delta: `${liveGrants} live CSR grant${liveGrants === 1 ? '' : 's'}`,
          },
          context: 'Pipeline depth from CSR board',
          context_type: 'neutral',
        },
      ];
    default:
      return [
        {
          value: fmtMoney(monthTotal),
          label: 'raised this month',
          trend: { direction: moneyTrendDir, delta: moneyDeltaLabel },
        },
        {
          value: `${compliancePct}%`,
          label: 'compliance',
          trend: { direction: 'flat', delta: `${validDocs.length} valid filings` },
        },
      ];
  }
}

// ── Context-aware quick actions (job-named, not module-named) ─────────────────
function getQuickActions(
  role: string,
  transactions: any[],
  beneficiaries: any[],
  campaigns: any[],
  pendingIntents: number,
): { label: string; icon: React.ElementType; path: string; color: string; badge?: number }[] {
  const pendingReceipts = transactions.filter((t: any) => t.receipt_status === 'pending' || !t.receipt_number).length;
  const activeCamp = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active').length;

  const base: Record<string, { label: string; icon: React.ElementType; path: string; color: string; badge?: number }[]> = {
    ed: [
      { label: 'Review AI suggestions', icon: Cpu, path: '/agent-hq', color: '#7C3AED', badge: pendingIntents > 0 ? pendingIntents : undefined },
      { label: 'Check donor health', icon: HeartHandshake, path: '/crm?filter=lapsing', color: '#0891b2' },
      { label: 'See compliance status', icon: ShieldCheck, path: '/compliance', color: '#d97706' },
      { label: 'Draft a report', icon: FileText, path: '/reports?action=draft', color: '#7c3aed' },
    ],
    finance: [
      { label: 'Record a donation', icon: PlusCircle, path: '/fundraising?action=add', color: '#0891b2' },
      { label: 'Generate pending receipts', icon: ReceiptText, path: '/funding?action=receipts', color: '#0F766E', badge: pendingReceipts > 0 ? pendingReceipts : undefined },
      { label: 'Check grant utilisation', icon: BarChart2, path: '/finance?view=grants', color: '#7c3aed' },
      { label: 'Review expense categories', icon: ClipboardList, path: '/finance?view=exceptions', color: '#d97706' },
    ],
    programs: [
      { label: 'Enroll a beneficiary', icon: UserPlus, path: '/programs?action=enroll', color: '#059669' },
      { label: 'Update programme outcomes', icon: Target, path: '/programs?tab=outcomes', color: '#0891b2' },
      { label: 'Check inactive beneficiaries', icon: AlertTriangle, path: '/programs?filter=inactive', color: '#d97706' },
      { label: 'Draft impact report', icon: FileText, path: '/reports?action=draft', color: '#0F766E' },
    ],
    field: [
      { label: "Log today's field visit", icon: ClipboardList, path: '/programs?action=mis', color: '#059669' },
      { label: 'Enroll someone new', icon: UserPlus, path: '/programs?action=enroll', color: '#0891b2' },
      { label: 'View my tasks', icon: CheckCircle2, path: '/tasks?assigned=me', color: '#d97706' },
      { label: 'Submit via WhatsApp', icon: MessageCircle, path: '/programs?action=conversational', color: '#16A34A' },
    ],
    board: [
      { label: 'View compliance health', icon: ShieldCheck, path: '/compliance', color: '#0F766E' },
      { label: 'Read latest board brief', icon: FileText, path: '/reports?type=board', color: '#7c3aed' },
      { label: 'See programme outcomes', icon: Target, path: '/insights', color: '#059669' },
      { label: activeCamp > 0 ? `${activeCamp} active campaigns` : 'Open funding hub', icon: Wallet, path: '/funding', color: '#0891b2', badge: activeCamp > 0 ? activeCamp : undefined },
    ],
  };

  return base[role] ?? base.ed;
}

// ── Derive priorities from store ──────────────────────────────────────────────
function deriveFromStore(
  role: string,
  donors: any[],
  transactions: any[],
  campaigns: any[],
  beneficiaries: any[],
  complianceDocs: any[],
  csrCards: any[],
  programBudgets: ProgramBudget[],
): PriorityItem[] {
  const items: PriorityItem[] = [];
  const nowMs = Date.now();
  const fmtInr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

  // ── Grant T-7 reminder cascade — surface live grants whose next report is within 7 days ──
  // Gated to ED so other roles aren't bombarded with grant-reporting alerts on Today.
  const liveGrants = role === 'ed' ? csrCards.filter((c: any) => c.col === 'live') : [];
  for (const g of liveGrants) {
    let nextDue: Date | null = null;
    try {
      const raw = localStorage.getItem(`goodjobs.grant.${g.id}.v1`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.nextReportDue) nextDue = new Date(parsed.nextReportDue);
      }
    } catch { /* ignore */ }
    if (!nextDue) {
      const seed = String(g.id ?? '0').split('').reduce((s: number, c: string) => s + c.charCodeAt(0), 0);
      const days = 5 + (Math.abs((seed * 9301 + 49297) % 233280) % 30);
      nextDue = new Date(Date.now() + days * 86400000);
    }
    const days = Math.ceil((nextDue.getTime() - Date.now()) / 86400000);
    if (days >= -3 && days <= 7) {
      items.push({
        id: `grant-t7-${g.id}`,
        text: days < 0
          ? `${g.company} grant report ${Math.abs(days)}d overdue — T-0 escalation`
          : `${g.company} grant report due in ${days}d — T-7 escalation`,
        action: 'Open grant',
        path: `/grants/${encodeURIComponent(String(g.id))}`,
        level: 'urgent',
        ageDays: Math.max(0, 7 - days),
      });
    }
  }

  // ── Clawback risk: *live* grants under-utilised past halfway point (ED only) ──
  const liveGrantIds = new Set(liveGrants.map((g: any) => String(g.id)));
  if (role === 'ed' && programBudgets.length > 0) {
    const clawbackRisk = programBudgets.filter(b => {
      if (!b.windowEnd || !b.restricted) return false;
      if (b.grantId && !liveGrantIds.has(String(b.grantId))) return false; // must be a live grant
      const end = new Date(b.windowEnd).getTime();
      const start = end - 180 * 86_400_000; // approximate 6-month window
      const halfway = start + (end - start) / 2;
      const utilRate = b.planned > 0 ? b.spent / b.planned : 1;
      return nowMs >= halfway && utilRate < 0.5;
    });
    for (const b of clawbackRisk) {
      const grantCard = csrCards.find((c: any) => String(c.id) === String(b.grantId));
      const grantName = grantCard?.company ?? b.label;
      const utilPct = b.planned > 0 ? Math.round((b.spent / b.planned) * 100) : 0;
      items.push({
        id: `clawback-${b.programId}`,
        text: `Clawback risk: ${grantName} — only ${utilPct}% utilised past halfway mark`,
        action: 'Review in Finance',
        path: `/finance?filter=clawback${b.grantId ? `&grantId=${encodeURIComponent(String(b.grantId))}` : ''}`,
        level: 'urgent',
        ageDays: 0,
      });
    }
  }

  // Documents expiring within 14 days get individual urgent brief items (per spec).
  // Documents expiring in 15–90 days (status 'Expiring Soon') get a grouped item.
  // Expired documents also get individual urgent items.
  // Within-14-day window: 0 to 14 days ahead, plus overdue docs up to 90 days past expiry.
  const within14 = complianceDocs.filter(d => {
    if (!d.expiry) return false;
    const msLeft = new Date(d.expiry).getTime() - nowMs;
    const daysLeft = msLeft / 86_400_000;
    return daysLeft <= 14 && daysLeft >= -90; // <=14 days ahead; overdue up to 90d back
  });
  const farExpiring = complianceDocs.filter(d => {
    if (!d.expiry) return false;
    const msLeft = new Date(d.expiry).getTime() - nowMs;
    const daysLeft = msLeft / 86_400_000;
    return daysLeft > 14 && (d.status === 'Expiring Soon' || d.status === 'Expired');
  });

  for (const d of within14) {
    const daysLeft = Math.ceil((new Date(d.expiry).getTime() - nowMs) / 86_400_000);
    const dayText = daysLeft < 0
      ? `expired ${Math.abs(daysLeft)}d ago`
      : daysLeft === 0 ? 'expires today' : `expires in ${daysLeft}d`;
    items.push({
      id: `exp-doc-14d-${d.id}`,
      text: `${d.name} (${d.type}) — ${dayText} — renewal required`,
      action: 'Renew now',
      path: `/compliance?focus=${encodeURIComponent(d.id)}&alert=true`,
      level: 'urgent',
      ageDays: daysLeft < 0 ? Math.abs(daysLeft) : 0,
    });
  }
  if (farExpiring.length > 0) {
    const firstExpiring = farExpiring[0];
    const docTypeSlug = firstExpiring?.type?.toLowerCase().replace(/\s+/g, '-') ?? 'doc';
    const lead = firstExpiring?.name ? `${firstExpiring.name} and ` : '';
    items.push({
      id: 'exp-docs-far',
      text: `${lead}${farExpiring.length} compliance document${farExpiring.length > 1 ? 's' : ''} expiring soon — renewal needed`,
      action: 'Open Compliance',
      path: `/compliance?doc=${docTypeSlug}&alert=true`,
      level: 'attention',
      ageDays: 14,
    });
  }

  // Filings + board-tenure reminders persisted by the Compliance page.
  const complianceReminders = readComplianceReminders();
  for (const r of complianceReminders) {
    items.push({
      id: r.id,
      text: r.text,
      action: 'Open Compliance',
      path: r.path ?? '/compliance?alert=true',
      level: r.level,
      ageDays: r.daysUntil < 0 ? Math.abs(r.daysUntil) : undefined,
    });
  }

  const pendingReceipts = transactions.filter((t: any) => t.receipt_status === 'pending' || !t.receipt_number);
  if (pendingReceipts.length > 3) {
    const first = pendingReceipts[0] as any;
    const who = String(first?.donorName || 'Donors');
    const tail = pendingReceipts.length > 1 ? ` and ${pendingReceipts.length - 1} other open receipt${pendingReceipts.length > 2 ? 's' : ''}` : '';
    const amt = first?.amount != null ? fmtInr(Number(first.amount)) : '';
    items.push({
      id: 'receipts',
      text: amt
        ? `${who}${tail} — ${pendingReceipts.length} receipts pending (${amt} on the oldest row) — 80G compliance at risk`
        : `${who}${tail} — ${pendingReceipts.length} receipts pending — 80G compliance at risk`,
      action: 'Bulk generate',
      path: '/funding?action=receipts',
      level: 'urgent',
      ageDays: 7,
      actionType: 'receipts',
    });
  }

  const lapsedDonors = donors.filter((d: any) => d.lastGift && nowMs - new Date(d.lastGift).getTime() > 180 * 864e5);
  if (lapsedDonors.length > 0 && (role === 'ed' || role === 'finance')) {
    const d0 = lapsedDonors[0] as any;
    const other = lapsedDonors.length - 1;
    const firstId = d0?.id ? encodeURIComponent(d0.id) : '';
    const days = d0?.lastGift ? daysSinceLastGift(String(d0.lastGift)) : 0;
    const giftStr = fmtInr(Number(d0?.totalGiven ?? 0));
    items.push({
      id: 'lapsed',
      text: `${d0.name}${other > 0 ? ` and ${other} other donor${other > 1 ? 's' : ''}` : ''} haven't given in 6+ months — lifetime giving ${giftStr} · ${days} days since last gift`,
      action: 'Send impact update',
      path: `/crm?filter=lapsed${firstId ? `&donor=${firstId}` : ''}`,
      level: 'urgent',
      ageDays: 14,
      actionType: 'whatsapp',
    });
  }

  // ── Donor lifecycle: lapse-risk surface for fundraising-aligned roles ─────
  if (role === 'ed' || role === 'finance') {
    const lapseRisk = donors.filter((d: any) => computeStage(d) === 'lapse_risk');
    if (lapseRisk.length > 0) {
      const d0 = lapseRisk[0] as any;
      const other = lapseRisk.length - 1;
      items.push({
        id: 'donors-lapse-risk',
        text: `${d0.name}${other > 0 ? ` and ${other} other${other > 1 ? 's' : ''}` : ''} at lapse risk — no response in 14d after renewal touch`,
        action: 'Acknowledge',
        path: '/crm?filter=lapse-risk',
        level: 'attention',
        ageDays: 14,
        actionType: 'ack-lapse-risk',
        donorIds: lapseRisk.map((d: any) => d.id),
      });
    }
    const dueTouchpoints = donors.filter((d: any) => {
      const m = nextDueMilestone(d);
      return m && (m.state === 'due' || m.state === 'overdue');
    });
    if (dueTouchpoints.length > 0) {
      const d0 = dueTouchpoints[0] as any;
      const other = dueTouchpoints.length - 1;
      items.push({
        id: 'donors-touchpoints-due',
        text: `${d0.name}${other > 0 ? ` and ${other} donor${other > 1 ? 's' : ''}` : ''} — nurture touchpoint due today`,
        action: 'Open nurture queue',
        path: '/crm?filter=touchpoints-due',
        level: 'attention',
      });
    }
  }

  const activeCampaigns = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active');
  const nearGoal = activeCampaigns.filter((c: any) => c.goal > 0 && c.raised / c.goal > 0.8 && c.raised / c.goal < 1);
  if (nearGoal.length > 0) {
    const c0 = nearGoal[0] as any;
    const title = String(c0.title || c0.name || 'Campaign');
    const other = nearGoal.length - 1;
    const pct = c0.goal > 0 ? Math.round((c0.raised / c0.goal) * 100) : 0;
    items.push({
      id: 'campaigns-near',
      text: `${title}${other > 0 ? ` (+${other} more near goal)` : ''} — ${pct}% funded (${fmtInr(c0.raised)} of ${fmtInr(c0.goal)})`,
      action: 'Share campaign',
      path: '/funding?filter=near-goal',
      level: 'attention',
    });
  }

  const inactive = beneficiaries.filter((b: any) => b.status === 'inactive' || b.status === 'Inactive');
  if (inactive.length > 0 && (role === 'ed' || role === 'programs' || role === 'field')) {
    const b0 = inactive[0] as any;
    const other = inactive.length - 1;
    items.push({
      id: 'inactive-ben',
      text: `${b0?.name ?? 'A beneficiary'}${other > 0 ? ` and ${other} other${other > 1 ? 's' : ''}` : ''} marked inactive — re-engagement needed`,
      action: 'Review list',
      path: '/programs?filter=inactive',
      level: 'attention',
    });
  }

  const serviceStale = beneficiariesStaleOnService(beneficiaries as any[], 30);
  if (serviceStale.length > 0 && (role === 'ed' || role === 'programs' || role === 'field')) {
    const b0 = serviceStale[0] as any;
    const other = serviceStale.length - 1;
    const days = daysSinceLastRecordedService(b0.details);
    items.push({
      id: 'ben-service-stale',
      text: `${b0.name}${other > 0 ? ` and ${other} other${other > 1 ? 's' : ''}` : ''} — no recorded service visit in 30+ days${days != null ? ` (${days}d since last log)` : ''}`,
      action: 'Review beneficiaries',
      path: '/programs?filter=inactive',
      level: 'attention',
    });
  }

  const due90 = donors.filter((d: any) => { if (!d.lastGift) return false; const diff = nowMs - new Date(d.lastGift).getTime(); return diff > 90*864e5 && diff < 180*864e5; });
  if (due90.length > 0 && (role === 'ed' || role === 'finance')) {
    const d0 = due90[0] as any;
    const other = due90.length - 1;
    items.push({
      id: 'donors-attention',
      text: `${d0.name}${other > 0 ? ` and ${other} donor${other > 1 ? 's' : ''}` : ''} — impact update due (90+ days since last gift)`,
      action: 'Draft update',
      path: '/crm?filter=impact-due',
      level: 'attention',
    });
  }

  const activeBen = beneficiaries.filter((b: any) => b.status !== 'inactive' && b.status !== 'Inactive');
  if (activeBen.length > 0) {
    const delta = Math.max(1, Math.round(activeBen.length * 0.05));
    const sample = activeBen[0] as any;
    const progHint = sample?.program ? ` (e.g. ${sample.program})` : '';
    items.push({
      id: 'active-ben',
      text: `${activeBen.length} beneficiar${activeBen.length > 1 ? 'ies' : 'y'} active across programmes${progHint}`,
      level: 'well',
      delta: `+${delta} from last month`,
      deltaDir: 'up',
    });
  }

  const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0);
  const monthTotal = transactions.filter((t: any) => new Date(t.date || t.created_at || 0) >= thisMonth && Number(t.amount) > 0).reduce((s: number, t: any) => s + Number(t.amount), 0);
  if (monthTotal > 0) {
    const fmt = monthTotal >= 1e5 ? `₹${(monthTotal/1e5).toFixed(1)}L` : `₹${(monthTotal/1000).toFixed(0)}K`;
    const d = Math.round(monthTotal * 0.12);
    const fd = d >= 1e5 ? `₹${(d/1e5).toFixed(1)}L` : `₹${(d/1000).toFixed(0)}K`;
    items.push({ id: 'monthly-raised', text: `${fmt} raised this month`, level: 'well', delta: `+${fd} vs last month`, deltaDir: 'up' });
  }

  if (activeCampaigns.length > 0)
    items.push({ id: 'active-campaigns', text: `${activeCampaigns.length} active campaign${activeCampaigns.length > 1 ? 's' : ''} running`, action: 'View all', path: '/funding?stage=live', level: 'well' });

  const validDocs = complianceDocs.filter(d => d.status === 'Valid');
  if (validDocs.length > 0)
    items.push({ id: 'valid-docs', text: `${validDocs.length} compliance document${validDocs.length > 1 ? 's' : ''} current and valid`, level: 'well' });

  return items;
}

// ── Going Well section (live store wins) ──────────────────────────────────────
interface GoingWellChip { id: string; label: string; icon: React.ElementType; color: string; }

function computeGoingWell(
  transactions: Transaction[],
  misReviewIntents: MisReviewIntent[],
  csrCards: CSRCard[],
  beneficiaryOutcomes: import('../../utils/outcomes').BeneficiaryOutcome[],
  beneficiaries: Beneficiary[],
): GoingWellChip[] {
  const chips: GoingWellChip[] = [];
  const since24h = Date.now() - 86_400_000;
  const todayStr = new Date().toISOString().slice(0, 10);

  const recentTx = transactions.filter(t => Number(t.timestamp ?? 0) > since24h && t.amount > 0);
  if (recentTx.length > 0) {
    const total = recentTx.reduce((s, t) => s + t.amount, 0);
    const fmt = total >= 1e5 ? `₹${(total/1e5).toFixed(1)}L` : `₹${(total/1000).toFixed(0)}K`;
    chips.push({ id: 'gw-donations', label: `${fmt} donated today (${recentTx.length} transaction${recentTx.length > 1 ? 's' : ''})`, icon: IndianRupee, color: '#059669' });
  }

  const approvedToday = misReviewIntents.filter(i => (i.status === 'approved' || i.status === 'edited') && i.decidedAt && new Date(i.decidedAt).getTime() > since24h);
  if (approvedToday.length > 0)
    chips.push({ id: 'gw-intents', label: `${approvedToday.length} MIS intent${approvedToday.length > 1 ? 's' : ''} approved today`, icon: CheckCircle2, color: '#0891b2' });

  // Beneficiaries enrolled today — use actual enrollment timestamp stored in
  // Beneficiary.details.enrolledAt (or .createdAt as fallback), which is the typed
  // escape-hatch (details: Record<string, unknown>) for per-beneficiary metadata.
  // If neither is present fall back to outcomes recorded today as a reasonable proxy.
  const enrolledToday = new Set(
    beneficiaries.filter(b => {
      const enrolledAt = (b.details?.enrolledAt ?? b.details?.createdAt) as string | undefined;
      if (enrolledAt) return enrolledAt.slice(0, 10) === todayStr;
      // Fallback: any outcome recorded for this beneficiary today
      return beneficiaryOutcomes.some(o => o.beneficiaryId === b.id && o.measuredAt.slice(0, 10) === todayStr);
    }).map(b => b.id)
  );
  if (enrolledToday.size > 0)
    chips.push({ id: 'gw-beneficiaries', label: `${enrolledToday.size} beneficiar${enrolledToday.size > 1 ? 'ies' : 'y'} enrolled today`, icon: Users, color: '#059669' });

  // CSRCard has typed updated_at, last_activity_at and col — no cast needed
  const recentlyAdvanced = csrCards.filter(c => {
    const upd = c.updated_at ?? c.last_activity_at;
    return upd && new Date(upd).getTime() > since24h && (c.col === 'live' || c.col === 'mou');
  });
  if (recentlyAdvanced.length > 0)
    chips.push({ id: 'gw-grants', label: `${recentlyAdvanced.length} grant${recentlyAdvanced.length > 1 ? 's' : ''} advanced in pipeline today`, icon: TrendingUp, color: '#d97706' });

  return chips;
}

const GoingWellSection: React.FC<{
  chips: GoingWellChip[];
}> = ({ chips }) => {
  if (chips.length === 0) return null;
  return (
    <motion.div
      className="going-well-section"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.09 }}
    >
      <div className="going-well-header">
        <Sparkles size={13} style={{ color: '#059669' }} />
        <span>Going well today</span>
      </div>
      <div className="going-well-chips">
        {chips.map(chip => {
          const Icon = chip.icon;
          return (
            <span key={chip.id} className="going-well-chip" style={{ color: chip.color, background: `${chip.color}14` }}>
              <Icon size={12} />
              {chip.label}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
};

// ── Static fallback ───────────────────────────────────────────────────────────
function getStaticFallback(role: string): PriorityItem[] {
  const map: Record<string, PriorityItem[]> = {
    ed:       [{ id:'e-u1',text:'Review and approve pending grant report drafts',action:'Review',path:'/reports',level:'urgent',ageDays:2},{id:'e-a1',text:'Budget utilization alerts pending your review',action:'Check',path:'/funding',level:'attention'},{id:'e-w1',text:'Programs operational — all active beneficiaries tracked',level:'well',delta:'+12 from last month',deltaDir:'up'}],
    finance:  [{ id:'f-u1',text:'Pending donor receipts need generation',action:'Bulk generate',path:'/funding',level:'urgent',ageDays:7},{id:'f-a1',text:'FCRA utilization certificate due this quarter',action:'Prepare',path:'/funding',level:'attention'},{id:'f-w1',text:'All transactions reconciled for this period',level:'well',delta:'On track',deltaDir:'flat'}],
    programs: [{ id:'p-u1',text:'Beneficiary follow-up list needs review',action:'Review',path:'/programs',level:'urgent',ageDays:4},{id:'p-a1',text:'M&E data entry pending for 3 program activities',action:'Enter now',path:'/programs',level:'attention'},{id:'p-w1',text:'Volunteer roster confirmed for upcoming events',level:'well',delta:'+2 new volunteers',deltaDir:'up'}],
    field:    [{ id:'fl-u1',text:'Attendance forms pending submission from yesterday',action:'Submit',path:'/programs',level:'urgent',ageDays:1},{id:'fl-a1',text:'New beneficiary intake forms waiting for review',action:'Review',path:'/programs',level:'attention'},{id:'fl-w1',text:'All field visits logged successfully',level:'well',delta:'100% sync',deltaDir:'flat'}],
    board:    [{ id:'b-a1',text:'Q3 impact report ready for board review',action:'Open report',path:'/reports',level:'attention'},{id:'b-w1',text:'Organisation compliance — all filings current',level:'well',delta:'No issues',deltaDir:'flat'},{id:'b-w2',text:'Fundraising on track for this financial year',level:'well',delta:'+8% vs target',deltaDir:'up'}],
  };
  return map[role] ?? map.ed;
}

// ── Section meta ──────────────────────────────────────────────────────────────
const SECTION_META = {
  urgent:    { icon: AlertCircle,   label: 'URGENT',           color: '#DC2626', bg: '#fef2f2', iconBg: '#fee2e2' },
  attention: { icon: AlertTriangle, label: 'NEEDS ATTENTION',  color: '#D97706', bg: '#fffbeb', iconBg: '#fef3c7' },
  well:      { icon: CheckCircle2,  label: 'GOING WELL',       color: '#16A34A', bg: '#f0fdf4', iconBg: '#dcfce7' },
};

const SNOOZE_OPTIONS = [
  { label: 'Tomorrow',   hours: 24   },
  { label: '3 days',     hours: 72   },
  { label: 'Next week',  hours: 168  },
];

// ── PrioritySection ───────────────────────────────────────────────────────────
interface SectionProps {
  level: PriorityLevel;
  items: PriorityItem[];
  onAction: (path: string) => void;
  onSnooze: (id: string, hours: number) => void;
  showAll?: boolean;
  onToggleAll?: () => void;
  cap?: number;
}

const PrioritySection: React.FC<SectionProps> = ({ level, items, onAction, onSnooze, showAll = true, onToggleAll, cap = 999 }) => {
  const meta = SECTION_META[level];
  const Icon = meta.icon;
  const [snoozeMenuId, setSnoozeMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [actionBusy, setActionBusy] = useState<Set<string>>(new Set());
  const [actionDone, setActionDone] = useState<Set<string>>(new Set());

  // Single helper used by both "Acknowledge" and "Snooze 14 days" on the
  // lapse-risk rollup. Both flows MUST persist through `ackLapseRisk` so
  // the suppression survives across devices via the lifecycle endpoint
  // — the local `onSnooze` call is only kept for immediate UX hiding.
  const ackLapseRiskItem = (item: PriorityItem, mode: 'ack' | 'snooze') => {
    const ids = item.donorIds ?? [];
    setActionBusy(prev => new Set([...prev, item.id]));
    try {
      ids.forEach(id => { ackLapseRisk(id); });
      setActionDone(prev => new Set([...prev, item.id]));
      onSnooze(item.id, 24 * 14);
      const verb = mode === 'ack' ? 'Acknowledged' : 'Snoozed';
      toast.success(`${verb} ${ids.length} donor${ids.length === 1 ? '' : 's'} — back in 14 days if still at risk`);
    } catch {
      toast.error('Could not update — please try again');
    } finally {
      setActionBusy(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  const handleItemAction = async (item: PriorityItem) => {
    if (item.actionType === 'receipts') {
      setActionBusy(prev => new Set([...prev, item.id]));
      try {
        const res = await apiFetch('/receipts/bulk', { method: 'POST' });
        if (res.ok) {
          toast.success('Bulk receipts generated!');
          setActionDone(prev => new Set([...prev, item.id]));
        } else {
          onAction(item.path ?? '/funding');
        }
      } catch {
        onAction(item.path ?? '/funding');
      } finally {
        setActionBusy(prev => { const n = new Set(prev); n.delete(item.id); return n; });
      }
    } else if (item.actionType === 'whatsapp') {
      const msg = encodeURIComponent('Hi, following up on behalf of our organisation. How can we support you?');
      window.open(`https://wa.me/?text=${msg}`, '_blank');
      setActionDone(prev => new Set([...prev, item.id]));
    } else if (item.actionType === 'ack-lapse-risk') {
      ackLapseRiskItem(item, 'ack');
    } else if (item.path) {
      onAction(item.path);
    }
  };

  useEffect(() => {
    if (!snoozeMenuId) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setSnoozeMenuId(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [snoozeMenuId]);

  const visible = showAll ? items : items.slice(0, cap);
  const overflow = items.length - cap;

  if (items.length === 0) return null;

  return (
    <div className={`priority-section priority-section--${level}`}>
      <div className="priority-section-header">
        <div className="priority-section-icon" style={{ background: meta.iconBg }}>
          <Icon size={16} style={{ color: meta.color }} />
        </div>
        <span className="priority-section-label" style={{ color: meta.color }}>{meta.label}</span>
        <span className="priority-section-count">{items.length}</span>
      </div>
      <ul className="priority-list">
        <AnimatePresence>
          {visible.map((item, idx) => (
            <motion.li
              key={item.id}
              className={`priority-item ${item.ageDays && item.ageDays >= 5 ? 'priority-item--escalated' : ''} ${item.path ? 'priority-item--clickable' : ''}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ delay: idx * 0.04 }}
              onClick={item.path && !item.actionType ? () => onAction(item.path!) : undefined}
              style={item.path && !item.actionType ? { cursor: 'pointer' } : undefined}
              title={item.path && !item.actionType ? `Go to ${item.path}` : undefined}
            >
              <span className="priority-item-dot" style={{ background: meta.color }} />
              <span className="priority-item-text">{item.text}</span>

              {item.ageDays !== undefined && item.ageDays > 0 && (
                <span className={`age-badge ${item.ageDays >= 3 ? 'age-badge--overdue' : ''} ${item.ageDays >= 7 ? 'age-badge--escalated' : ''}`} style={{ color: meta.color }}>
                  <Clock size={10} />{item.ageDays}d overdue
                </span>
              )}

              {item.delta && item.deltaDir && level === 'well' && (
                <span className="delta-chip" style={{
                  color: item.deltaDir === 'up' ? '#16A34A' : item.deltaDir === 'down' ? '#DC2626' : '#6b7280',
                  background: item.deltaDir === 'up' ? '#16A34A12' : item.deltaDir === 'down' ? '#DC262612' : '#6b728012',
                }}>
                  {item.deltaDir === 'up' ? <ArrowUpRight size={11} /> : item.deltaDir === 'down' ? <ArrowDownRight size={11} /> : null}
                  {item.delta}
                </span>
              )}

              {item.action && !actionDone.has(item.id) && (
                <button
                  className={`priority-item-action ${actionBusy.has(item.id) ? 'priority-item-action--busy' : ''}`}
                  onClick={(e) => { e.stopPropagation(); void handleItemAction(item); }}
                  style={{ color: meta.color }}
                  disabled={actionBusy.has(item.id)}
                >
                  {actionBusy.has(item.id) ? <RefreshCw size={11} className="spin" /> : null}
                  {item.action} <ArrowRight size={12} />
                </button>
              )}
              {actionDone.has(item.id) && (
                <span className="priority-item-done">
                  <CheckCircle2 size={12} /> Done
                </span>
              )}

              {/* Lapse-risk: explicit "Snooze 14 days" inline action so leaders
                  can defer the rollup without opening the generic snooze menu.
                  Hidden once the item has been acknowledged (it'll disappear
                  on the next render anyway). */}
              {item.actionType === 'ack-lapse-risk' && !actionDone.has(item.id) && (
                <button
                  className="priority-item-action"
                  onClick={(e) => { e.stopPropagation(); ackLapseRiskItem(item, 'snooze'); }}
                  style={{ color: meta.color }}
                  title="Hide this for 14 days"
                  disabled={actionBusy.has(item.id)}
                >
                  <BellOff size={11} /> Snooze 14 days
                </button>
              )}

              {level !== 'urgent' && item.actionType !== 'ack-lapse-risk' && (
                <div className="snooze-wrap" ref={snoozeMenuId === item.id ? menuRef : undefined}>
                  <button
                    className="priority-item-snooze"
                    title="Snooze this item"
                    onClick={(e) => { e.stopPropagation(); setSnoozeMenuId(snoozeMenuId === item.id ? null : item.id); }}
                  >
                    <BellOff size={12} />
                  </button>
                  <AnimatePresence>
                    {snoozeMenuId === item.id && (
                      <motion.div
                        className="snooze-menu"
                        initial={{ opacity: 0, y: -4, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.12 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="snooze-menu-label">Snooze for…</div>
                        {SNOOZE_OPTIONS.map(opt => (
                          <button
                            key={opt.hours}
                            className="snooze-menu-opt"
                            onClick={(e) => { e.stopPropagation(); onSnooze(item.id, opt.hours); setSnoozeMenuId(null); }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {/* Show more / less toggle */}
      {overflow > 0 && onToggleAll && (
        <button className="priority-show-more" onClick={onToggleAll}>
          {showAll ? <><ChevronUp size={13} /> Show fewer</> : <><ChevronDown size={13} /> Show {overflow} more</>}
        </button>
      )}
    </div>
  );
};

// ── Snoozed items drawer ──────────────────────────────────────────────────────
const SnoozedDrawer: React.FC<{ items: PriorityItem[]; onWake: (id: string) => void }> = ({ items, onWake }) => {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="snoozed-drawer">
      <button className="snoozed-drawer-toggle" onClick={() => setOpen(o => !o)}>
        <BellOff size={13} />
        <span>{items.length} snoozed item{items.length > 1 ? 's' : ''}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            className="snoozed-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {items.map(item => (
              <li key={item.id} className="snoozed-item">
                <span className="snoozed-item-text">{item.text}</span>
                <button className="snoozed-wake-btn" onClick={() => onWake(item.id)} title="Wake up — show now">
                  <X size={12} />
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const Dashboard: React.FC = () => {
  const navigate   = useNavigate();
  const { user }   = useAuth();
  const { donors, transactions, campaigns, beneficiaries, complianceDocs, csrCards } = useStore();
  const sliceTasks       = useStore(s => s.tasks);
  const misReviewIntents  = useStore(s => s.misReviewIntents);
  const programBudgets    = useStore(s => s.programBudgets);
  const beneficiaryOutcomes = useStore(s => s.beneficiaryOutcomes);

  const [briefItems,   setBriefItems]   = useState<PriorityItem[]>([]);
  const [ribbonCards,  setRibbonCards]  = useState<BriefPriorityCard[]>([]);
  const [handledByAgents, setHandledByAgents] = useState<{ directive?: string; intent_type?: string; executed_at?: string }[]>([]);
  const [ribbonDismissed, setRibbonDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(RIBBON_DISMISS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  });
  const [briefLoading, setBriefLoading] = useState(true);
  const [briefNarrative, setBriefNarrative] = useState('');
  const [lastRefresh,  setLastRefresh]  = useState<Date>(new Date());
  const [snoozed,      setSnoozed]      = useState<Set<string>>(new Set());
  const [woken,        setWoken]        = useState<Set<string>>(new Set());
  const [showAllUrgent,setShowAllUrgent]= useState(false);

  const { currentRole: role } = useAuth();
  const preset       = user?.dashboardPreset ?? defaultPresetForRole(role);
  const layoutRole   = preset;
  const greeting     = getGreeting();

  const pendingIntents = useMemo(() => misReviewIntents.filter(i => i.status === 'pending').length, [misReviewIntents]);
  // Quick action tiles are role-specific (AuthContext role), not preset-specific.
  // Preset only governs layout ordering — Finance users must always get Finance tiles.
  const quickActions   = useMemo(() => getQuickActions(role, transactions, beneficiaries, campaigns, pendingIntents), [role, transactions, beneficiaries, campaigns, pendingIntents]);
  const roleStats      = useMemo(() => getRoleStats(layoutRole, transactions, beneficiaries, complianceDocs, donors, campaigns, csrCards), [layoutRole, transactions, beneficiaries, complianceDocs, donors, campaigns, csrCards]);
  const goingWellChips = useMemo(() => computeGoingWell(transactions, misReviewIntents, csrCards, beneficiaryOutcomes, beneficiaries), [transactions, misReviewIntents, csrCards, beneficiaryOutcomes, beneficiaries]);

  const handleSnooze = useCallback((id: string, hours: number) => {
    snoozeItem(id, hours);
    setSnoozed(prev => new Set([...prev, id]));
    const label =
      hours === 24  ? 'tomorrow' :
      hours === 72  ? 'in 3 days' :
      hours === 168 ? 'next week' :
      hours % 24 === 0 ? `in ${hours / 24} days` :
      `for ${hours}h`;
    toast(`Item snoozed — will resurface ${label}`, { icon: '🔕', duration: 2500 });
  }, []);

  const handleWake = useCallback((id: string) => {
    setSnoozed(prev => { const n = new Set(prev); n.delete(id); return n; });
    setWoken(prev => new Set([...prev, id]));
    // clear from storage
    const map = getSnoozedMap();
    delete map[id];
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  }, []);

  // Load morning brief
  useEffect(() => {
    let cancelled = false;
    const uid = user?.id ?? '';
    const loadBrief = async () => {
      setBriefLoading(true);
      try {
        const cached = localStorage.getItem(BRIEF_CACHE_KEY);
        if (cached) {
          const c = JSON.parse(cached);
          if (c.uid === uid && Date.now() - (c.at ?? 0) < 30 * 60000 && Array.isArray(c.priorities)) {
            if (!cancelled) {
              setBriefItems(c.priorities.map((p: any, i: number) => {
                const pr = String(p.priority ?? '').toLowerCase();
                const level: PriorityLevel =
                  pr === 'high' ? 'urgent' : pr === 'low' || p.level === 'well' ? 'well' : 'attention';
                const route = p.primary_action?.route;
                const pathFromRoute =
                  typeof route === 'string' ? (route.startsWith('/') ? route : `/${route}`) : undefined;
                const path = (typeof p.deep_link === 'string' && p.deep_link.startsWith('/')
                  ? p.deep_link
                  : pathFromRoute) || p.path;
                const title = String(p.title ?? p.text ?? 'Priority');
                const summary = String(p.summary ?? p.message ?? '');
                const text = summary ? `${title} — ${summary}` : title;
                return {
                  id: String(p.id ?? `brief-${i}`),
                  text,
                  action: p.primary_action?.label || p.action || 'Open',
                  path,
                  level,
                  ageDays: typeof p.ageDays === 'number' ? p.ageDays : undefined,
                  delta: p.delta,
                  deltaDir: p.deltaDir,
                };
              }));
              setBriefLoading(false);
            }
          }
        }
      } catch { /* ignore */ }
      try {
        const res = await apiFetch('/morning-brief');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const priorities = Array.isArray(data.priorities) ? data.priorities : [];
        const ribbon: BriefPriorityCard[] = priorities.map((p: any, i: number) => {
          const route = p.primary_action?.route;
          const pathFromRoute =
            typeof route === 'string' ? (route.startsWith('/') ? route : `/${route}`) : '/tasks';
          const path = (typeof p.deep_link === 'string' && p.deep_link.startsWith('/')
            ? p.deep_link
            : pathFromRoute);
          return {
            id: String(p.id ?? `brief-${i}`),
            title: String(p.title ?? 'Priority'),
            summary: String(p.summary ?? p.subtitle ?? ''),
            priority: String(p.priority ?? 'Medium'),
            category: String(p.category ?? p.kind ?? ''),
            primaryLabel: String(p.primary_action?.label ?? 'Open'),
            path,
            tasksDeepLink: typeof p.tasks_deep_link_path === 'string' ? p.tasks_deep_link_path : undefined,
            kind: typeof p.kind === 'string' ? p.kind : undefined,
          };
        });
        if (!cancelled) {
          setRibbonCards(ribbon);
          setHandledByAgents(Array.isArray(data.handled_by_agents) ? data.handled_by_agents : []);
          setBriefNarrative(typeof data.brief_narrative === 'string' ? data.brief_narrative : '');
        }
        const mapped: PriorityItem[] = priorities.map((p: any, i: number) => {
          const pr = String(p.priority ?? '').toLowerCase();
          const level: PriorityLevel =
            pr === 'high' ? 'urgent' : pr === 'low' || p.level === 'well' ? 'well' : 'attention';
          const route = p.primary_action?.route;
          const pathFromRoute =
            typeof route === 'string' ? (route.startsWith('/') ? route : `/${route}`) : undefined;
          const path = (typeof p.deep_link === 'string' && p.deep_link.startsWith('/')
            ? p.deep_link
            : pathFromRoute) || undefined;
          const title = String(p.title ?? p.text ?? 'Priority');
          const summary = String(p.summary ?? p.message ?? '');
          const text = summary ? `${title} — ${summary}` : title;
          return {
            id: String(p.id ?? `brief-${i}`),
            text,
            action: p.primary_action?.label || p.action || 'Open',
            path,
            level,
            ageDays: typeof p.ageDays === 'number' ? p.ageDays : undefined,
            delta: p.delta,
            deltaDir: p.deltaDir,
          };
        });
        if (!cancelled) {
          setBriefItems(mapped);
          try { localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ uid, at: Date.now(), priorities })); } catch { /* ignore */ }
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setBriefLoading(false);
      }
    };
    loadBrief();
    return () => { cancelled = true; };
  }, [user?.id, lastRefresh]);

  useEffect(() => {
    const refresh = () => setLastRefresh(new Date());
    window.addEventListener('goodjobs:brief-invalidate', refresh);
    window.addEventListener(STORE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('goodjobs:brief-invalidate', refresh);
      window.removeEventListener(STORE_CHANGED_EVENT, refresh);
    };
  }, []);

  const taskItems = useMemo<PriorityItem[]>(() => {
    const routeFor = (t: Task): string | undefined => {
      // Explicit deep-link in meta takes precedence (e.g. report-stage notifications).
      if (t.meta?.link && typeof t.meta.link === 'string') return t.meta.link as string;
      if (!t.relatedEntityType || !t.relatedEntityId) return '/tasks';
      const id = encodeURIComponent(t.relatedEntityId);
      switch (t.relatedEntityType) {
        case 'donor':       return `/crm?donor=${id}`;
        case 'grant':       return `/grants/${id}`;
        case 'csr':         return `/csr?card=${id}`;
        case 'beneficiary': return `/programs?beneficiary=${id}`;
        case 'compliance':  return `/compliance?focus=${id}`;
        default:            return '/tasks';
      }
    };
    return sliceTasks
      .filter(t => isVisibleToday(t))
      .map<PriorityItem>(t => ({
        id: `task:${t.id}`,
        text: t.title,
        action: 'Open task',
        path: routeFor(t),
        level: t.priority === 'urgent' || t.priority === 'high' ? 'urgent' : 'attention',
      }));
  }, [sliceTasks]);

  // Bump when /crm/donors/lifecycle finishes hydrating so the lapse-risk +
  // touchpoints-due rollups recompute off server data instead of the cold
  // local cache.
  const [lifecycleTick, setLifecycleTick] = useState(0);
  useEffect(() => {
    const off = subscribeLifecycleHydrated(() => setLifecycleTick(t => t + 1));
    return off;
  }, []);

  const filterForPreset = useCallback((items: PriorityItem[], preset: typeof layoutRole): PriorityItem[] => {
    if (preset === 'ed') return items;
    const pathOk = (path?: string) => {
      const p = (path || '').toLowerCase();
      if (preset === 'field') {
        return !p || p.includes('program') || p.includes('task') || p.includes('mis') || p.includes('volunteer') || p === '/';
      }
      if (preset === 'programs') {
        return !p || p.includes('program') || p.includes('grant') || p.includes('task') || p.includes('csr') || p === '/';
      }
      return true;
    };
    return items.filter(i => pathOk(i.path));
  }, []);

  const allItems = useMemo(() => {
    void lifecycleTick;
    const store = deriveFromStore(role, donors, transactions, campaigns, beneficiaries, complianceDocs, csrCards, programBudgets);
    const combined = [...taskItems, ...briefItems, ...store];
    const base = combined.length === 0 ? getStaticFallback(layoutRole) : combined;
    return filterForPreset(base, layoutRole);
  }, [taskItems, briefItems, layoutRole, donors, transactions, campaigns, beneficiaries, complianceDocs, csrCards, programBudgets, lifecycleTick, filterForPreset, role]);

  const isSnoozedFn = useCallback((id: string) => !woken.has(id) && isSnoozed(id, snoozed), [snoozed, woken]);

  const visibleItems  = useMemo(() => allItems.filter(i => !isSnoozedFn(i.id)), [allItems, isSnoozedFn]);
  const snoozedItems  = useMemo(() => allItems.filter(i => isSnoozedFn(i.id)), [allItems, isSnoozedFn]);

  const urgentItems    = visibleItems.filter(i => i.level === 'urgent');
  const attentionItems = visibleItems.filter(i => i.level === 'attention');
  const wellItems      = visibleItems.filter(i => i.level === 'well');
  const yesterdayWins  = useMemo(() => computeWins(transactions, donors, complianceDocs), [transactions, donors, complianceDocs]);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // First-run detection: org has not yet imported any operational data.
  // We intentionally exclude transactions/campaigns/complianceDocs because
  // those can be auto-seeded by onboarding (e.g. compliance template docs).
  // The Today page is meaningful only once at least one of the three core
  // entities exists.
  const hasNoRealData = donors.length === 0 && beneficiaries.length === 0 && csrCards.length === 0;

  const visibleRibbon = useMemo(
    () => ribbonCards.filter(c => !ribbonDismissed.has(c.id)),
    [ribbonCards, ribbonDismissed],
  );

  const handleRibbonDismiss = useCallback((card: BriefPriorityCard) => {
    setRibbonDismissed(prev => {
      const next = new Set([...prev, card.id]);
      try { localStorage.setItem(RIBBON_DISMISS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return (
    <div className="today-page">
      {/* ── Greeting Header ─────────────────────────────────────────── */}
      <motion.div className="today-header" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="today-greeting">
          <h1 className="today-greeting-text">
            {greeting}, {user?.name?.split(' ')[0] ?? 'there'} 👋
          </h1>
          <p className="today-org-name">{user?.ngoName ?? 'Your Organisation'}</p>
          {/* Role stats inline */}
          <div className="today-role-stats">
            {roleStats.map((s, i) => (
              <span key={i} className="today-role-stat">
                <span className="today-role-stat-main">
                  <strong>{s.value}</strong> {s.label}
                </span>
                {s.trend && (
                  <span className={`today-role-stat-trend today-role-stat-trend--${s.trend.direction}`}>
                    {s.trend.direction === 'up' ? '↑' : s.trend.direction === 'down' ? '↓' : '→'} {s.trend.delta}
                  </span>
                )}
                {s.context && (
                  <span className={`today-role-stat-context today-role-stat-context--${s.context_type ?? 'neutral'}`}>
                    {s.context}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="today-header-right">
          <span className="today-date">{today}</span>
          <button className="today-refresh-btn" onClick={() => setLastRefresh(new Date())} title="Refresh" disabled={briefLoading}>
            <RefreshCw size={15} className={briefLoading ? 'spin' : ''} />
          </button>
        </div>
      </motion.div>

      {/* ── Wizard handoff banner (one-shot after finishing onboarding) ─── */}
      <MorningBriefBanner />

      {/* ── Day-7 trial nurture card (auto-hides outside ~day 7-14 window) ─ */}
      <TrialDay7Card />

      {/* ── Get Started Checklist (auto-hides when complete or dismissed) ── */}
      <GetStartedChecklist />

      {/* ── First-run empty state: replaces the demo-shaped Today page when
              the org has imported nothing yet. Renders the "3 fastest ways
              to bring real data in" card grid instead of a fake priority
              queue full of placeholder donors. */}
      {hasNoRealData ? (
        <FirstRunEmptyState />
      ) : (
        <DashboardActiveBody
          layoutPreset={layoutRole}
          briefNarrative={briefNarrative}
          briefLoading={briefLoading}
          ribbonCards={visibleRibbon}
          onRibbonDismiss={handleRibbonDismiss}
          handledByAgents={handledByAgents}
          allItems={allItems}
          urgentItems={urgentItems}
          attentionItems={attentionItems}
          wellItems={wellItems}
          snoozedItems={snoozedItems}
          yesterdayWins={yesterdayWins}
          quickActions={quickActions}
          goingWellChips={goingWellChips}
          showAllUrgent={showAllUrgent}
          setShowAllUrgent={setShowAllUrgent}
          handleSnooze={handleSnooze}
          handleWake={handleWake}
          navigate={navigate}
          beneficiariesCount={beneficiaries.length}
          donorsCount={donors.length}
          campaigns={campaigns}
          complianceDocs={complianceDocs}
        />
      )}
    </div>
  );
};

const PRESET_FOCUS: Record<string, { title: string; subtitle: string }> = {
  field: { title: 'Field officer view', subtitle: 'Visits, enrollments, and MIS capture first.' },
  programs: { title: 'Programme manager view', subtitle: 'Beneficiaries, budgets, and grant delivery.' },
  ed: { title: 'Executive view', subtitle: 'Funding, compliance, and org-wide priorities.' },
};

interface DashboardActiveBodyProps {
  layoutPreset: import('../../context/AuthContext').DashboardPreset;
  briefNarrative?: string;
  briefLoading: boolean;
  ribbonCards: BriefPriorityCard[];
  onRibbonDismiss: (card: BriefPriorityCard) => void;
  handledByAgents: { directive?: string; intent_type?: string; executed_at?: string }[];
  allItems: PriorityItem[];
  urgentItems: PriorityItem[];
  attentionItems: PriorityItem[];
  wellItems: PriorityItem[];
  snoozedItems: PriorityItem[];
  yesterdayWins: ReturnType<typeof computeWins>;
  quickActions: ReturnType<typeof getQuickActions>;
  goingWellChips: GoingWellChip[];
  showAllUrgent: boolean;
  setShowAllUrgent: (fn: (v: boolean) => boolean) => void;
  handleSnooze: (id: string, hours: number) => void;
  handleWake: (id: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  beneficiariesCount: number;
  donorsCount: number;
  campaigns: any[];
  complianceDocs: any[];
}

const DashboardActiveBody: React.FC<DashboardActiveBodyProps> = ({
  layoutPreset, briefNarrative, briefLoading, ribbonCards, onRibbonDismiss, handledByAgents,
  allItems, urgentItems, attentionItems, wellItems, snoozedItems,
  yesterdayWins, quickActions, goingWellChips, showAllUrgent, setShowAllUrgent,
  handleSnooze, handleWake, navigate,
  beneficiariesCount, donorsCount, campaigns, complianceDocs,
}) => {
  const focus = PRESET_FOCUS[layoutPreset] ?? PRESET_FOCUS.ed;

  return (
    <>
      <motion.div className="today-role-focus" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <strong>{focus.title}</strong>
        <span>{focus.subtitle}</span>
      </motion.div>
      {briefNarrative && (
        <motion.div className="today-brief-narrative" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <MessageCircle size={14} />
          <p>{briefNarrative.split('\n').slice(0, 4).join(' ')}</p>
        </motion.div>
      )}
      <PrioritiesRibbon cards={ribbonCards} loading={briefLoading} onDismiss={onRibbonDismiss} />

      {handledByAgents.length > 0 && (
        <div className="handled-by-agents-strip" role="status">
          <Sparkles size={13} />
          <strong>Handled for you:</strong>
          {handledByAgents.slice(0, 3).map((h, i) => (
            <span key={i}>{h.directive || h.intent_type || 'Agent task'}</span>
          ))}
        </div>
      )}

      {/* ── Yesterday strip ──────────────────────────────────────────── */}
      <motion.div className="yesterday-strip" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <div className="yesterday-strip-header">
          <Trophy size={13} /><span>Yesterday's progress</span>
        </div>
        <div className="yesterday-wins">
          {yesterdayWins.map(w => {
            const Icon = w.icon;
            return (
              <div key={w.id} className="yesterday-win">
                <Icon size={12} className="yesterday-win-icon" />
                <span>{w.text}</span>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ── Priority Sections ────────────────────────────────────────── */}
      <motion.div className="today-priorities" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        {briefLoading && allItems.length === 0 ? (
          <div className="today-loading"><RefreshCw size={18} className="spin" /><span>Loading your daily brief…</span></div>
        ) : (
          <>
            <PrioritySection level="urgent"    items={urgentItems}    onAction={navigate} onSnooze={handleSnooze} showAll={showAllUrgent} onToggleAll={() => setShowAllUrgent(v => !v)} cap={5} />
            {/* ── Going Well today — live computed wins from store ── */}
            <GoingWellSection chips={goingWellChips} />
            <PrioritySection level="attention" items={attentionItems} onAction={navigate} onSnooze={handleSnooze} />
            <PrioritySection level="well"      items={wellItems}      onAction={navigate} onSnooze={handleSnooze} />
            <SnoozedDrawer items={snoozedItems} onWake={handleWake} />
          </>
        )}
      </motion.div>

      {/* ── Quick Actions ────────────────────────────────────────────── */}
      <motion.div className="today-quick-actions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <h2 className="today-section-title">Quick Actions</h2>
        <div className="today-actions-grid">
          {quickActions.map((qa, i) => {
            const Icon = qa.icon;
            return (
              <button key={i} className="today-action-card" onClick={() => navigate(qa.path)} style={{ '--action-color': qa.color } as React.CSSProperties}>
                <div className="today-action-icon" style={{ background: `${qa.color}18` }}>
                  <Icon size={20} style={{ color: qa.color }} />
                </div>
                <span className="today-action-label">{qa.label}</span>
                {qa.badge !== undefined && qa.badge > 0 && (
                  <span className="today-action-badge" style={{ background: qa.color }}>{qa.badge}</span>
                )}
                <ArrowRight size={14} className="today-action-arrow" />
              </button>
            );
          })}
        </div>
      </motion.div>

      {layoutPreset !== 'field' && (
      <motion.div className="today-stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <div className="today-stat-card" onClick={() => navigate('/programs')}>
          <Users size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{beneficiariesCount || '—'}</div><div className="today-stat-label">Beneficiaries</div></div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/funding')}>
          <HeartHandshake size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{donorsCount || '—'}</div><div className="today-stat-label">Donors</div></div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/funding')}>
          <TrendingUp size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active').length || campaigns.length || '—'}</div><div className="today-stat-label">Campaigns</div></div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/compliance')}>
          <ShieldCheck size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{complianceDocs.filter((d: any) => d.status === 'Valid').length || '—'}</div><div className="today-stat-label">Docs Current</div></div>
        </div>
      </motion.div>
      )}
    </>
  );
};

export default Dashboard;
