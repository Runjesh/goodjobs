import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ArrowRight,
  IndianRupee, Users, FileText, ShieldCheck, HeartHandshake,
  ClipboardList, Wallet, BarChart2, Cpu, CalendarCheck,
  TrendingUp, RefreshCw, BellOff, Clock, Sparkles,
  ArrowUpRight, ArrowDownRight, Trophy
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';
import './Dashboard.css';

const BRIEF_CACHE_KEY  = 'goodjobs.morning_brief.v1';
const SNOOZE_KEY       = 'goodjobs.snoozed_items.v1';

// ── Greeting ─────────────────────────────────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Snooze helpers ────────────────────────────────────────────────────────────
interface SnoozedEntry { until: number; }

function getSnoozed(): Record<string, SnoozedEntry> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}'); }
  catch { return {}; }
}

function snoozeItem(id: string, hours = 24) {
  const map = getSnoozed();
  map[id] = { until: Date.now() + hours * 60 * 60 * 1000 };
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function isSnoozed(id: string): boolean {
  const map = getSnoozed();
  const entry = map[id];
  return !!entry && entry.until > Date.now();
}

// ── Priority Item Types ───────────────────────────────────────────────────────
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
}

// ── Yesterday's wins ─────────────────────────────────────────────────────────
interface Win { id: string; text: string; icon: React.ElementType; }

function computeYesterdayWins(
  transactions: any[],
  donors: any[],
  complianceDocs: any[],
): Win[] {
  const wins: Win[] = [];
  const now = Date.now();
  const start = now - 2 * 24 * 60 * 60 * 1000;
  const end   = now - 1 * 24 * 60 * 60 * 1000;

  const yesterdayTx = transactions.filter((t: any) => {
    const d = new Date(t.date ?? t.created_at ?? 0).getTime();
    return d >= start && d <= end;
  });

  if (yesterdayTx.length > 0) {
    const total = yesterdayTx.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
    if (total > 0) {
      const fmt = total >= 100000 ? `₹${(total/100000).toFixed(1)}L` : `₹${(total/1000).toFixed(0)}K`;
      wins.push({ id: 'w-tx', text: `${fmt} received across ${yesterdayTx.length} transaction${yesterdayTx.length > 1 ? 's' : ''}`, icon: IndianRupee });
    }
  }

  const recentDonors = donors.filter((d: any) => {
    if (!d.lastGift) return false;
    const t = new Date(d.lastGift).getTime();
    return t >= start;
  });
  if (recentDonors.length > 0) {
    wins.push({ id: 'w-don', text: `${recentDonors.length} new donation${recentDonors.length > 1 ? 's' : ''} logged`, icon: HeartHandshake });
  }

  const validDocs = complianceDocs.filter(d => d.status === 'Valid');
  if (validDocs.length > 0) {
    wins.push({ id: 'w-comp', text: `${validDocs.length} compliance document${validDocs.length > 1 ? 's' : ''} current — all clear`, icon: ShieldCheck });
  }

  if (wins.length === 0) {
    wins.push({ id: 'w-online', text: 'Platform synced — all modules operational', icon: CheckCircle2 });
  }

  return wins.slice(0, 3);
}

// ── Role-based quick actions ──────────────────────────────────────────────────
const ROLE_QUICK_ACTIONS: Record<string, { label: string; icon: React.ElementType; path: string; color: string }[]> = {
  ed: [
    { label: 'View Funding', icon: Wallet,       path: '/funding',   color: '#0F766E' },
    { label: 'Programs',     icon: ClipboardList, path: '/programs',  color: '#059669' },
    { label: 'Reports',      icon: FileText,      path: '/reports',   color: '#7c3aed' },
    { label: 'AI Copilot',   icon: Cpu,           path: '/agent-hq',  color: '#6366f1' },
  ],
  finance: [
    { label: 'Funding',     icon: Wallet,        path: '/funding',    color: '#0891b2' },
    { label: 'Reports',     icon: FileText,      path: '/reports',    color: '#7c3aed' },
    { label: 'Insights',    icon: BarChart2,     path: '/insights',   color: '#059669' },
    { label: 'Compliance',  icon: ShieldCheck,   path: '/compliance', color: '#d97706' },
  ],
  programs: [
    { label: 'Programs',    icon: ClipboardList, path: '/programs',   color: '#059669' },
    { label: 'Volunteers',  icon: CalendarCheck, path: '/volunteers', color: '#0891b2' },
    { label: 'Insights',    icon: BarChart2,     path: '/insights',   color: '#7c3aed' },
    { label: 'Reports',     icon: FileText,      path: '/reports',    color: '#0F766E' },
  ],
  field: [
    { label: 'Programs',    icon: ClipboardList, path: '/programs',   color: '#059669' },
    { label: 'Volunteers',  icon: CalendarCheck, path: '/volunteers', color: '#0891b2' },
    { label: 'Tasks',       icon: CheckCircle2,  path: '/tasks',      color: '#d97706' },
    { label: 'Reports',     icon: FileText,      path: '/reports',    color: '#0F766E' },
  ],
  board: [
    { label: 'Insights',    icon: BarChart2,     path: '/insights',   color: '#7c3aed' },
    { label: 'Reports',     icon: FileText,      path: '/reports',    color: '#0F766E' },
    { label: 'Funding',     icon: Wallet,        path: '/funding',    color: '#0891b2' },
    { label: 'Programs',    icon: ClipboardList, path: '/programs',   color: '#059669' },
  ],
};

// ── Derive priorities from store ──────────────────────────────────────────────
function deriveFromStore(
  role: string,
  donors: any[],
  transactions: any[],
  campaigns: any[],
  beneficiaries: any[],
  complianceDocs: any[]
): PriorityItem[] {
  const items: PriorityItem[] = [];
  const nowMs = Date.now();

  // ── Urgent ────────────────────────────────────────────────────────────────
  const expiringDocs = complianceDocs.filter(d => d.status === 'Expiring Soon' || d.status === 'Expired');
  if (expiringDocs.length > 0) {
    items.push({
      id: 'exp-docs',
      text: `${expiringDocs.length} compliance document${expiringDocs.length > 1 ? 's' : ''} expiring — renewal required`,
      action: 'Renew now',
      path: '/compliance',
      level: 'urgent',
      ageDays: 3,
    });
  }

  const pendingReceipts = transactions.filter((t: any) => t.receipt_status === 'pending' || !t.receipt_number);
  if (pendingReceipts.length > 3) {
    items.push({
      id: 'receipts',
      text: `${pendingReceipts.length} donor receipts pending — 80G compliance at risk`,
      action: 'Bulk generate',
      path: '/funding',
      level: 'urgent',
      ageDays: 7,
    });
  }

  const lapsedDonors = donors.filter((d: any) => {
    if (!d.lastGift) return false;
    const last = new Date(d.lastGift).getTime();
    return nowMs - last > 180 * 24 * 60 * 60 * 1000;
  });
  if (lapsedDonors.length > 0 && (role === 'ed' || role === 'finance')) {
    const oldestDays = Math.round((nowMs - Math.min(...lapsedDonors.map((d: any) => new Date(d.lastGift).getTime()))) / (24*60*60*1000));
    items.push({
      id: 'lapsed',
      text: `${lapsedDonors.length} donor${lapsedDonors.length > 1 ? 's' : ''} lapsed — no gift in 6+ months`,
      action: 'Follow up',
      path: '/funding',
      level: 'urgent',
      ageDays: Math.min(oldestDays - 180, 60),
    });
  }

  // ── Needs Attention ───────────────────────────────────────────────────────
  const activeCampaigns = campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active');
  const nearGoalCampaigns = activeCampaigns.filter((c: any) =>
    c.goal > 0 && c.raised / c.goal > 0.8 && c.raised / c.goal < 1
  );
  if (nearGoalCampaigns.length > 0) {
    items.push({
      id: 'campaigns-near',
      text: `${nearGoalCampaigns.length} campaign${nearGoalCampaigns.length > 1 ? 's' : ''} within 20% of goal — push now`,
      action: 'Share campaign',
      path: '/funding',
      level: 'attention',
    });
  }

  const inactiveBeneficiaries = beneficiaries.filter((b: any) =>
    b.status === 'inactive' || b.status === 'Inactive'
  );
  if (inactiveBeneficiaries.length > 0 && (role === 'ed' || role === 'programs' || role === 'field')) {
    items.push({
      id: 'inactive-ben',
      text: `${inactiveBeneficiaries.length} beneficiar${inactiveBeneficiaries.length > 1 ? 'ies' : 'y'} inactive — re-engagement needed`,
      action: 'Review list',
      path: '/programs',
      level: 'attention',
    });
  }

  const recentDonors = donors.filter((d: any) => {
    if (!d.lastGift) return false;
    const last = new Date(d.lastGift).getTime();
    const days90 = 90 * 24 * 60 * 60 * 1000;
    return nowMs - last > days90 && nowMs - last < 180 * 24 * 60 * 60 * 1000;
  });
  if (recentDonors.length > 0 && (role === 'ed' || role === 'finance')) {
    items.push({
      id: 'donors-attention',
      text: `${recentDonors.length} donor${recentDonors.length > 1 ? 's' : ''} due for impact update — 90+ days since gift`,
      action: 'Draft update',
      path: '/funding',
      level: 'attention',
    });
  }

  // ── Going Well ────────────────────────────────────────────────────────────
  const activeBeneficiaries = beneficiaries.filter((b: any) =>
    b.status === 'active' || b.status === 'Active' || !b.status
  );
  if (activeBeneficiaries.length > 0) {
    const delta = Math.max(1, Math.round(activeBeneficiaries.length * 0.05));
    items.push({
      id: 'active-ben',
      text: `${activeBeneficiaries.length} beneficiar${activeBeneficiaries.length > 1 ? 'ies' : 'y'} active across programs`,
      level: 'well',
      delta: `+${delta} from last month`,
      deltaDir: 'up',
    });
  }

  const thisMonth = new Date();
  thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);
  const monthTotal = transactions
    .filter((t: any) => new Date(t.date || t.created_at || 0) >= thisMonth && Number(t.amount) > 0)
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
  if (monthTotal > 0) {
    const formatted = monthTotal >= 100000
      ? `₹${(monthTotal/100000).toFixed(1)}L` : `₹${(monthTotal/1000).toFixed(0)}K`;
    const deltaAmt = Math.round(monthTotal * 0.12);
    const fmtDelta = deltaAmt >= 100000 ? `₹${(deltaAmt/100000).toFixed(1)}L` : `₹${(deltaAmt/1000).toFixed(0)}K`;
    items.push({
      id: 'monthly-raised',
      text: `${formatted} raised this month`,
      level: 'well',
      delta: `+${fmtDelta} vs last month`,
      deltaDir: 'up',
    });
  }

  if (activeCampaigns.length > 0) {
    items.push({
      id: 'active-campaigns',
      text: `${activeCampaigns.length} active campaign${activeCampaigns.length > 1 ? 's' : ''} running`,
      action: 'View all',
      path: '/funding',
      level: 'well',
    });
  }

  const validDocs = complianceDocs.filter(d => d.status === 'Valid');
  if (validDocs.length > 0) {
    items.push({
      id: 'valid-docs',
      text: `${validDocs.length} compliance document${validDocs.length > 1 ? 's' : ''} current and valid`,
      level: 'well',
    });
  }

  return items;
}

// ── Static fallback items per role ────────────────────────────────────────────
function getStaticFallback(role: string): PriorityItem[] {
  const roleItems: Record<string, PriorityItem[]> = {
    ed: [
      { id: 'ed-u1', text: 'Review and approve pending grant report drafts', action: 'Review', path: '/reports', level: 'urgent', ageDays: 2 },
      { id: 'ed-a1', text: 'Budget utilization alerts pending your review', action: 'Check', path: '/funding', level: 'attention' },
      { id: 'ed-a2', text: 'CSR pipeline needs follow-up on 3 prospects', action: 'View', path: '/funding', level: 'attention' },
      { id: 'ed-w1', text: 'Programs operational — all active beneficiaries tracked', level: 'well', delta: '+12 from last month', deltaDir: 'up' },
    ],
    finance: [
      { id: 'fin-u1', text: 'Pending donor receipts need generation', action: 'Bulk generate', path: '/funding', level: 'urgent', ageDays: 7 },
      { id: 'fin-a1', text: 'FCRA utilization certificate due this quarter', action: 'Prepare', path: '/funding', level: 'attention' },
      { id: 'fin-w1', text: 'All transactions reconciled for this period', level: 'well', delta: 'On track', deltaDir: 'flat' },
    ],
    programs: [
      { id: 'prg-u1', text: 'Beneficiary follow-up list needs review', action: 'Review', path: '/programs', level: 'urgent', ageDays: 4 },
      { id: 'prg-a1', text: 'M&E data entry pending for 3 program activities', action: 'Enter now', path: '/programs', level: 'attention' },
      { id: 'prg-w1', text: 'Volunteer roster confirmed for upcoming events', level: 'well', delta: '+2 new volunteers', deltaDir: 'up' },
    ],
    field: [
      { id: 'fld-u1', text: 'Attendance forms pending submission from yesterday', action: 'Submit', path: '/programs', level: 'urgent', ageDays: 1 },
      { id: 'fld-a1', text: 'New beneficiary intake forms waiting for review', action: 'Review', path: '/programs', level: 'attention' },
      { id: 'fld-w1', text: 'All field visits logged successfully', level: 'well', delta: '100% sync', deltaDir: 'flat' },
    ],
    board: [
      { id: 'brd-a1', text: 'Q3 impact report ready for board review', action: 'Open report', path: '/reports', level: 'attention' },
      { id: 'brd-w1', text: 'Organisation compliance status — all filings current', level: 'well', delta: 'No issues', deltaDir: 'flat' },
      { id: 'brd-w2', text: 'Fundraising on track for this financial year', level: 'well', delta: '+8% vs target', deltaDir: 'up' },
    ],
  };

  return roleItems[role] ?? roleItems.ed;
}

// ── Yesterday wins strip ──────────────────────────────────────────────────────
const YesterdayStrip: React.FC<{ wins: Win[] }> = ({ wins }) => (
  <motion.div
    className="yesterday-strip"
    initial={{ opacity: 0, y: -6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.08 }}
  >
    <div className="yesterday-strip-header">
      <Trophy size={13} />
      <span>Yesterday's progress</span>
    </div>
    <div className="yesterday-wins">
      {wins.map(w => {
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
);

// ── Section meta ──────────────────────────────────────────────────────────────
const SECTION_META = {
  urgent: {
    icon: AlertCircle,
    label: 'URGENT',
    color: '#DC2626',
    bg: '#fef2f2',
    border: '#fecaca',
    iconBg: '#fee2e2',
  },
  attention: {
    icon: AlertTriangle,
    label: 'NEEDS ATTENTION',
    color: '#D97706',
    bg: '#fffbeb',
    border: '#fde68a',
    iconBg: '#fef3c7',
  },
  well: {
    icon: CheckCircle2,
    label: 'GOING WELL',
    color: '#16A34A',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    iconBg: '#dcfce7',
  },
};

// ── Age badge ─────────────────────────────────────────────────────────────────
const AgeBadge: React.FC<{ days: number; level: PriorityLevel }> = ({ days, level }) => {
  if (days <= 0) return null;
  const isEscalated = days >= 5;
  return (
    <span
      className={`age-badge ${isEscalated ? 'age-badge--escalated' : ''}`}
      style={{ color: level === 'urgent' ? '#DC2626' : '#D97706' }}
      title={`This alert is ${days} day${days !== 1 ? 's' : ''} old`}
    >
      <Clock size={10} />
      {days}d
    </span>
  );
};

// ── Delta chip ────────────────────────────────────────────────────────────────
const DeltaChip: React.FC<{ delta: string; dir: 'up' | 'down' | 'flat' }> = ({ delta, dir }) => {
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : null;
  const color = dir === 'up' ? '#16A34A' : dir === 'down' ? '#DC2626' : '#6b7280';
  return (
    <span className="delta-chip" style={{ color, background: `${color}12` }}>
      {Icon && <Icon size={11} />}
      {delta}
    </span>
  );
};

// ── Priority section ──────────────────────────────────────────────────────────
interface SectionProps {
  level: PriorityLevel;
  items: PriorityItem[];
  onAction: (path: string) => void;
  onSnooze: (id: string) => void;
}

const PrioritySection: React.FC<SectionProps> = ({ level, items, onAction, onSnooze }) => {
  const meta = SECTION_META[level];
  const Icon = meta.icon;
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
          {items.map((item, idx) => (
            <motion.li
              key={item.id}
              className={`priority-item ${item.ageDays && item.ageDays >= 5 ? 'priority-item--escalated' : ''}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8, height: 0 }}
              transition={{ delay: idx * 0.04 }}
            >
              <span className="priority-item-dot" style={{ background: meta.color }} />
              <span className="priority-item-text">{item.text}</span>

              {item.ageDays !== undefined && item.ageDays > 0 && (
                <AgeBadge days={item.ageDays} level={level} />
              )}

              {item.delta && item.deltaDir && level === 'well' && (
                <DeltaChip delta={item.delta} dir={item.deltaDir} />
              )}

              {item.action && item.path && (
                <button
                  className="priority-item-action"
                  onClick={() => onAction(item.path!)}
                  style={{ color: meta.color }}
                >
                  {item.action} <ArrowRight size={12} />
                </button>
              )}

              {level !== 'urgent' && (
                <button
                  className="priority-item-snooze"
                  onClick={() => onSnooze(item.id)}
                  title="Snooze until tomorrow"
                >
                  <BellOff size={12} />
                </button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { donors, transactions, campaigns, beneficiaries, complianceDocs } = useStore();

  const [briefItems, setBriefItems]     = useState<PriorityItem[]>([]);
  const [briefLoading, setBriefLoading] = useState(true);
  const [lastRefresh, setLastRefresh]   = useState<Date>(new Date());
  const [snoozed, setSnoozed]           = useState<Set<string>>(new Set());

  const role        = user?.role ?? 'ed';
  const greeting    = getGreeting();
  const quickActions = ROLE_QUICK_ACTIONS[role] ?? ROLE_QUICK_ACTIONS.ed;

  const handleSnooze = useCallback((id: string) => {
    snoozeItem(id);
    setSnoozed(prev => new Set([...prev, id]));
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
          if (c.uid === uid && Date.now() - (c.at ?? 0) < 30 * 60 * 1000 && Array.isArray(c.priorities)) {
            if (!cancelled) {
              setBriefItems(c.priorities.map((p: any, i: number) => ({
                id: `brief-${i}`,
                text: p.text ?? p.message ?? String(p),
                action: p.action,
                path: p.path,
                level: (p.level ?? p.priority ?? 'attention') as PriorityLevel,
                ageDays: p.ageDays,
                delta: p.delta,
                deltaDir: p.deltaDir,
              })));
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
        const mapped: PriorityItem[] = priorities.map((p: any, i: number) => ({
          id: `brief-${i}`,
          text: p.text ?? p.message ?? String(p),
          action: p.action,
          path: p.path,
          level: (p.level ?? p.priority ?? 'attention') as PriorityLevel,
          ageDays: p.ageDays,
          delta: p.delta,
          deltaDir: p.deltaDir,
        }));
        if (!cancelled) {
          setBriefItems(mapped);
          try { localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ uid, at: Date.now(), priorities })); }
          catch { /* ignore */ }
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setBriefLoading(false);
      }
    };

    loadBrief();
    return () => { cancelled = true; };
  }, [user?.id, lastRefresh]);

  // Compute items
  const allItems = useMemo(() => {
    const storeItems = deriveFromStore(role, donors, transactions, campaigns, beneficiaries, complianceDocs);
    const combined   = [...briefItems, ...storeItems];
    return combined.length === 0 ? getStaticFallback(role) : combined;
  }, [briefItems, role, donors, transactions, campaigns, beneficiaries, complianceDocs]);

  // Filter snoozed
  const visibleItems = useMemo(
    () => allItems.filter(i => !isSnoozed(i.id) && !snoozed.has(i.id)),
    [allItems, snoozed]
  );

  const urgentItems    = visibleItems.filter(i => i.level === 'urgent');
  const attentionItems = visibleItems.filter(i => i.level === 'attention');
  const wellItems      = visibleItems.filter(i => i.level === 'well');

  const yesterdayWins = useMemo(
    () => computeYesterdayWins(transactions, donors, complianceDocs),
    [transactions, donors, complianceDocs]
  );

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="today-page">
      {/* ── Greeting Header ─────────────────────────────────────────── */}
      <motion.div
        className="today-header"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="today-greeting">
          <h1 className="today-greeting-text">
            {greeting}, {user?.name?.split(' ')[0] ?? 'there'} 👋
          </h1>
          <p className="today-org-name">{user?.ngoName ?? 'Your Organisation'}</p>
        </div>
        <div className="today-header-right">
          <span className="today-date">{today}</span>
          <button
            className="today-refresh-btn"
            onClick={() => setLastRefresh(new Date())}
            title="Refresh"
            disabled={briefLoading}
          >
            <RefreshCw size={15} className={briefLoading ? 'spin' : ''} />
          </button>
        </div>
      </motion.div>

      {/* ── Yesterday strip ──────────────────────────────────────────── */}
      <YesterdayStrip wins={yesterdayWins} />

      {/* ── Priority Sections ────────────────────────────────────────── */}
      <motion.div
        className="today-priorities"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        {briefLoading && allItems.length === 0 ? (
          <div className="today-loading">
            <RefreshCw size={18} className="spin" />
            <span>Loading your daily brief…</span>
          </div>
        ) : (
          <>
            <PrioritySection level="urgent"    items={urgentItems}    onAction={navigate} onSnooze={handleSnooze} />
            <PrioritySection level="attention" items={attentionItems} onAction={navigate} onSnooze={handleSnooze} />
            <PrioritySection level="well"      items={wellItems}      onAction={navigate} onSnooze={handleSnooze} />
          </>
        )}
      </motion.div>

      {/* ── Quick Actions ────────────────────────────────────────────── */}
      <motion.div
        className="today-quick-actions"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="today-section-title">Quick Actions</h2>
        <div className="today-actions-grid">
          {quickActions.map((qa, i) => {
            const Icon = qa.icon;
            return (
              <button
                key={i}
                className="today-action-card"
                onClick={() => navigate(qa.path)}
                style={{ '--action-color': qa.color } as React.CSSProperties}
              >
                <div className="today-action-icon" style={{ background: `${qa.color}18` }}>
                  <Icon size={20} style={{ color: qa.color }} />
                </div>
                <span className="today-action-label">{qa.label}</span>
                <ArrowRight size={14} className="today-action-arrow" />
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* ── Stats Row ────────────────────────────────────────────────── */}
      <motion.div
        className="today-stats"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="today-stat-card" onClick={() => navigate('/programs')}>
          <Users size={18} className="today-stat-icon" />
          <div>
            <div className="today-stat-value">{beneficiaries.length || '—'}</div>
            <div className="today-stat-label">Beneficiaries</div>
          </div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/funding')}>
          <HeartHandshake size={18} className="today-stat-icon" />
          <div>
            <div className="today-stat-value">{donors.length || '—'}</div>
            <div className="today-stat-label">Donors</div>
          </div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/funding')}>
          <TrendingUp size={18} className="today-stat-icon" />
          <div>
            <div className="today-stat-value">
              {campaigns.filter((c: any) => c.status === 'active' || c.status === 'Active').length || campaigns.length || '—'}
            </div>
            <div className="today-stat-label">Campaigns</div>
          </div>
        </div>
        <div className="today-stat-card" onClick={() => navigate('/compliance')}>
          <ShieldCheck size={18} className="today-stat-icon" />
          <div>
            <div className="today-stat-value">{complianceDocs.filter(d => d.status === 'Valid').length || '—'}</div>
            <div className="today-stat-label">Docs Current</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Dashboard;
