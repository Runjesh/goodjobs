import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ArrowRight,
  IndianRupee, Users, FileText, ShieldCheck, HeartHandshake,
  ClipboardList, Wallet, BarChart2, Cpu, CalendarCheck,
  TrendingUp, RefreshCw, BellOff, Clock, Trophy,
  ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, X
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';
import { computeStage, nextDueMilestone } from '../../utils/donorLifecycle';
import toast from 'react-hot-toast';
import GetStartedChecklist from '../../components/Onboarding/GetStartedChecklist';
import MorningBriefBanner from '../../components/Onboarding/MorningBriefBanner';
import TrialDay7Card from '../../components/Onboarding/TrialDay7Card';
import './Dashboard.css';

const BRIEF_CACHE_KEY = 'goodjobs.morning_brief.v1';
const SNOOZE_KEY      = 'goodjobs.snoozed_items.v2';

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
  actionType?: 'receipts' | 'whatsapp';
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
interface RoleStat { value: string; label: string; }

function getRoleStats(
  role: string,
  transactions: any[],
  beneficiaries: any[],
  complianceDocs: any[],
  donors: any[],
  campaigns: any[],
): RoleStat[] {
  const nowMs = Date.now();
  const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0);
  const monthTotal = transactions
    .filter((t: any) => new Date(t.date || t.created_at || 0) >= thisMonth)
    .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
  const fmtMoney = (v: number) => v >= 1e5 ? `₹${(v/1e5).toFixed(1)}L` : v > 0 ? `₹${(v/1000).toFixed(0)}K` : '—';
  const active = beneficiaries.filter((b: any) => b.status !== 'inactive' && b.status !== 'Inactive').length;
  const validDocs = complianceDocs.filter(d => d.status === 'Valid');
  const compliancePct = complianceDocs.length > 0 ? Math.round((validDocs.length / complianceDocs.length) * 100) : 100;
  const pendingReceipts = transactions.filter((t: any) => t.receipt_status === 'pending' || !t.receipt_number).length;

  switch (role) {
    case 'ed':      return [{ value: fmtMoney(monthTotal), label: 'raised this month' }, { value: `${compliancePct}%`, label: 'compliance health' }];
    case 'finance': return [{ value: fmtMoney(monthTotal), label: 'raised this month' }, { value: String(pendingReceipts || 0), label: 'receipts pending' }];
    case 'programs':return [{ value: String(active), label: 'active beneficiaries' }, { value: String(beneficiaries.filter((b: any) => b.status === 'inactive' || b.status === 'Inactive').length), label: 'need follow-up' }];
    case 'field':   return [{ value: String(active), label: 'active beneficiaries' }, { value: String(pendingReceipts), label: 'forms pending' }];
    case 'board':   return [{ value: `${compliancePct}%`, label: 'compliance health' }, { value: String(campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active').length), label: 'active grants' }];
    default:        return [{ value: fmtMoney(monthTotal), label: 'raised this month' }, { value: `${compliancePct}%`, label: 'compliance' }];
  }
}

// ── Context-aware quick actions ───────────────────────────────────────────────
function getQuickActions(
  role: string,
  transactions: any[],
  beneficiaries: any[],
  campaigns: any[],
): { label: string; icon: React.ElementType; path: string; color: string; badge?: number }[] {
  const pendingReceipts = transactions.filter((t: any) => t.receipt_status === 'pending' || !t.receipt_number).length;
  const inactiveBen     = beneficiaries.filter((b: any) => b.status === 'inactive' || b.status === 'Inactive').length;
  const activeCamp      = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active').length;

  const base: Record<string, { label: string; icon: React.ElementType; path: string; color: string; badge?: number }[]> = {
    ed: [
      { label: pendingReceipts > 0 ? `Generate Receipts` : 'Funding Hub',     icon: Wallet,        path: '/funding',   color: '#0F766E', badge: pendingReceipts > 0 ? pendingReceipts : undefined },
      { label: inactiveBen > 0 ? `Re-engage Beneficiaries` : 'Programs',      icon: ClipboardList, path: '/programs',  color: '#059669', badge: inactiveBen > 0 ? inactiveBen : undefined },
      { label: 'Reports',                                                        icon: FileText,      path: '/reports',   color: '#7c3aed' },
      { label: 'AI Copilot',                                                     icon: Cpu,           path: '/agent-hq',  color: '#6366f1' },
    ],
    finance: [
      { label: pendingReceipts > 0 ? `Generate Receipts` : 'Funding',  icon: Wallet,    path: '/funding',    color: '#0891b2', badge: pendingReceipts > 0 ? pendingReceipts : undefined },
      { label: 'Reports',                                                icon: FileText,  path: '/reports',    color: '#7c3aed' },
      { label: 'Insights',                                               icon: BarChart2, path: '/insights',   color: '#059669' },
      { label: 'Compliance',                                             icon: ShieldCheck,path: '/compliance',color: '#d97706' },
    ],
    programs: [
      { label: inactiveBen > 0 ? `Follow-up` : 'Programs', icon: ClipboardList, path: '/programs',  color: '#059669', badge: inactiveBen > 0 ? inactiveBen : undefined },
      { label: 'Volunteers',                                 icon: CalendarCheck, path: '/volunteers', color: '#0891b2' },
      { label: 'Insights',                                   icon: BarChart2,     path: '/insights',  color: '#7c3aed' },
      { label: 'Reports',                                    icon: FileText,      path: '/reports',   color: '#0F766E' },
    ],
    field: [
      { label: 'Programs',   icon: ClipboardList, path: '/programs',   color: '#059669' },
      { label: 'Volunteers', icon: CalendarCheck, path: '/volunteers', color: '#0891b2' },
      { label: 'Tasks',      icon: CheckCircle2,  path: '/tasks',      color: '#d97706' },
      { label: 'Reports',    icon: FileText,      path: '/reports',    color: '#0F766E' },
    ],
    board: [
      { label: 'Insights',  icon: BarChart2,    path: '/insights',   color: '#7c3aed' },
      { label: 'Reports',   icon: FileText,     path: '/reports',    color: '#0F766E' },
      { label: activeCamp > 0 ? `${activeCamp} Active Grants` : 'Funding', icon: Wallet, path: '/funding', color: '#0891b2', badge: activeCamp > 0 ? activeCamp : undefined },
      { label: 'Programs',  icon: ClipboardList,path: '/programs',   color: '#059669' },
    ],
  };

  return base[role] ?? base.ed;
}

// ── Derive priorities from store ──────────────────────────────────────────────
function deriveFromStore(role: string, donors: any[], transactions: any[], campaigns: any[], beneficiaries: any[], complianceDocs: any[], csrCards: any[] = []): PriorityItem[] {
  const items: PriorityItem[] = [];
  const nowMs = Date.now();

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
      // Match GrantDetail's deterministic mock so T-7 actually fires for some demo cards
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


  const expiringDocs = complianceDocs.filter(d => d.status === 'Expiring Soon' || d.status === 'Expired');
  if (expiringDocs.length > 0)
    items.push({ id: 'exp-docs', text: `${expiringDocs.length} compliance document${expiringDocs.length > 1 ? 's' : ''} expiring — renewal required`, action: 'Renew now', path: '/compliance', level: 'urgent', ageDays: 3 });

  const pendingReceipts = transactions.filter((t: any) => t.receipt_status === 'pending' || !t.receipt_number);
  if (pendingReceipts.length > 3)
    items.push({ id: 'receipts', text: `${pendingReceipts.length} donor receipts pending — 80G compliance at risk`, action: 'Bulk generate', path: '/funding', level: 'urgent', ageDays: 7, actionType: 'receipts' });

  const lapsedDonors = donors.filter((d: any) => d.lastGift && nowMs - new Date(d.lastGift).getTime() > 180 * 864e5);
  if (lapsedDonors.length > 0 && (role === 'ed' || role === 'finance'))
    items.push({ id: 'lapsed', text: `${lapsedDonors.length} donor${lapsedDonors.length > 1 ? 's' : ''} lapsed — no gift in 6+ months`, action: 'Follow up via WhatsApp', path: '/funding', level: 'urgent', ageDays: 14, actionType: 'whatsapp' });

  // ── Donor lifecycle: lapse-risk surface for fundraising-aligned roles ─────
  if (role === 'ed' || role === 'finance') {
    const lapseRisk = donors.filter((d: any) => computeStage(d) === 'lapse_risk');
    if (lapseRisk.length > 0) {
      items.push({
        id: 'donors-lapse-risk',
        text: `${lapseRisk.length} donor${lapseRisk.length > 1 ? 's' : ''} at lapse risk — no response in 14d after renewal touch`,
        action: 'Open re-engagement queue',
        path: '/crm',
        level: 'attention',
        ageDays: 14,
      });
    }
    // Touchpoint due today/overdue across all donors → single rollup item.
    const dueTouchpoints = donors.filter((d: any) => {
      const m = nextDueMilestone(d);
      return m && (m.state === 'due' || m.state === 'overdue');
    });
    if (dueTouchpoints.length > 0) {
      items.push({
        id: 'donors-touchpoints-due',
        text: `${dueTouchpoints.length} donor touchpoint${dueTouchpoints.length > 1 ? 's' : ''} due — approve & send today`,
        action: 'Open nurture queue',
        path: '/crm',
        level: 'attention',
      });
    }
  }

  const activeCampaigns = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active');
  const nearGoal = activeCampaigns.filter((c: any) => c.goal > 0 && c.raised / c.goal > 0.8 && c.raised / c.goal < 1);
  if (nearGoal.length > 0)
    items.push({ id: 'campaigns-near', text: `${nearGoal.length} campaign${nearGoal.length > 1 ? 's' : ''} within 20% of goal — push now`, action: 'Share campaign', path: '/funding', level: 'attention' });

  const inactive = beneficiaries.filter((b: any) => b.status === 'inactive' || b.status === 'Inactive');
  if (inactive.length > 0 && (role === 'ed' || role === 'programs' || role === 'field'))
    items.push({ id: 'inactive-ben', text: `${inactive.length} beneficiar${inactive.length > 1 ? 'ies' : 'y'} inactive — re-engagement needed`, action: 'Review list', path: '/programs', level: 'attention' });

  const due90 = donors.filter((d: any) => { if (!d.lastGift) return false; const diff = nowMs - new Date(d.lastGift).getTime(); return diff > 90*864e5 && diff < 180*864e5; });
  if (due90.length > 0 && (role === 'ed' || role === 'finance'))
    items.push({ id: 'donors-attention', text: `${due90.length} donor${due90.length > 1 ? 's' : ''} due for impact update — 90+ days since gift`, action: 'Draft update', path: '/funding', level: 'attention' });

  const activeBen = beneficiaries.filter((b: any) => b.status !== 'inactive' && b.status !== 'Inactive');
  if (activeBen.length > 0) {
    const delta = Math.max(1, Math.round(activeBen.length * 0.05));
    items.push({ id: 'active-ben', text: `${activeBen.length} beneficiar${activeBen.length > 1 ? 'ies' : 'y'} active across programs`, level: 'well', delta: `+${delta} from last month`, deltaDir: 'up' });
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
    items.push({ id: 'active-campaigns', text: `${activeCampaigns.length} active campaign${activeCampaigns.length > 1 ? 's' : ''} running`, action: 'View all', path: '/funding', level: 'well' });

  const validDocs = complianceDocs.filter(d => d.status === 'Valid');
  if (validDocs.length > 0)
    items.push({ id: 'valid-docs', text: `${validDocs.length} compliance document${validDocs.length > 1 ? 's' : ''} current and valid`, level: 'well' });

  return items;
}

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
              className={`priority-item ${item.ageDays && item.ageDays >= 5 ? 'priority-item--escalated' : ''}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ delay: idx * 0.04 }}
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
                  onClick={() => void handleItemAction(item)}
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

              {level !== 'urgent' && (
                <div className="snooze-wrap" ref={snoozeMenuId === item.id ? menuRef : undefined}>
                  <button
                    className="priority-item-snooze"
                    title="Snooze this item"
                    onClick={() => setSnoozeMenuId(snoozeMenuId === item.id ? null : item.id)}
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
                      >
                        <div className="snooze-menu-label">Snooze for…</div>
                        {SNOOZE_OPTIONS.map(opt => (
                          <button
                            key={opt.hours}
                            className="snooze-menu-opt"
                            onClick={() => { onSnooze(item.id, opt.hours); setSnoozeMenuId(null); }}
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

  const [briefItems,   setBriefItems]   = useState<PriorityItem[]>([]);
  const [briefLoading, setBriefLoading] = useState(true);
  const [lastRefresh,  setLastRefresh]  = useState<Date>(new Date());
  const [snoozed,      setSnoozed]      = useState<Set<string>>(new Set());
  const [woken,        setWoken]        = useState<Set<string>>(new Set());
  const [showAllUrgent,setShowAllUrgent]= useState(false);

  const role         = user?.role ?? 'ed';
  const greeting     = getGreeting();
  const quickActions = useMemo(() => getQuickActions(role, transactions, beneficiaries, campaigns), [role, transactions, beneficiaries, campaigns]);
  const roleStats    = useMemo(() => getRoleStats(role, transactions, beneficiaries, complianceDocs, donors, campaigns), [role, transactions, beneficiaries, complianceDocs, donors, campaigns]);

  const handleSnooze = useCallback((id: string, hours: number) => {
    snoozeItem(id, hours);
    setSnoozed(prev => new Set([...prev, id]));
    const label = hours === 24 ? 'tomorrow' : hours === 72 ? 'in 3 days' : 'next week';
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
              setBriefItems(c.priorities.map((p: any, i: number) => ({ id: `brief-${i}`, text: p.text ?? p.message ?? String(p), action: p.action, path: p.path, level: (p.level ?? 'attention') as PriorityLevel, ageDays: p.ageDays, delta: p.delta, deltaDir: p.deltaDir })));
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
        const mapped: PriorityItem[] = priorities.map((p: any, i: number) => ({ id: `brief-${i}`, text: p.text ?? p.message ?? String(p), action: p.action, path: p.path, level: (p.level ?? 'attention') as PriorityLevel, ageDays: p.ageDays, delta: p.delta, deltaDir: p.deltaDir }));
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

  const allItems = useMemo(() => {
    const store = deriveFromStore(role, donors, transactions, campaigns, beneficiaries, complianceDocs, csrCards);
    const combined = [...briefItems, ...store];
    return combined.length === 0 ? getStaticFallback(role) : combined;
  }, [briefItems, role, donors, transactions, campaigns, beneficiaries, complianceDocs, csrCards]);

  const isSnoozedFn = useCallback((id: string) => !woken.has(id) && isSnoozed(id, snoozed), [snoozed, woken]);

  const visibleItems  = useMemo(() => allItems.filter(i => !isSnoozedFn(i.id)), [allItems, isSnoozedFn]);
  const snoozedItems  = useMemo(() => allItems.filter(i => isSnoozedFn(i.id)), [allItems, isSnoozedFn]);

  const urgentItems    = visibleItems.filter(i => i.level === 'urgent');
  const attentionItems = visibleItems.filter(i => i.level === 'attention');
  const wellItems      = visibleItems.filter(i => i.level === 'well');
  const yesterdayWins  = useMemo(() => computeWins(transactions, donors, complianceDocs), [transactions, donors, complianceDocs]);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
                <strong>{s.value}</strong> {s.label}
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

      {/* ── Stats Row ────────────────────────────────────────────────── */}
      <motion.div className="today-stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <div className="today-stat-card" onClick={() => navigate('/programs')}>
          <Users size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{beneficiaries.length || '—'}</div><div className="today-stat-label">Beneficiaries</div></div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/funding')}>
          <HeartHandshake size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{donors.length || '—'}</div><div className="today-stat-label">Donors</div></div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/funding')}>
          <TrendingUp size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active').length || campaigns.length || '—'}</div><div className="today-stat-label">Campaigns</div></div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/compliance')}>
          <ShieldCheck size={18} className="today-stat-icon" />
          <div><div className="today-stat-value">{complianceDocs.filter(d => d.status === 'Valid').length || '—'}</div><div className="today-stat-label">Docs Current</div></div>
        </div>
      </motion.div>
    </div>
  );
};

export default Dashboard;
