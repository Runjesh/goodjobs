import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FileText, Download, CheckCircle2,
  Clock, AlertCircle, Users, IndianRupee,
  TrendingUp, Send, Eye, ArrowRight, Sparkles, TriangleAlert
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useFocusFromUrl } from '../../hooks/useFocusFromUrl';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../api/client';
import toast from 'react-hot-toast';
import { useTier } from '../../hooks/useTier';
import { REPORTS_CATALOGUE, type ReportRecord } from '../../data/reportsCatalogue';
import { recordReportDraft } from '../../utils/trial';
import ContextualUpgradePrompt from '../../components/Billing/ContextualUpgradePrompt';
import { readToCForProgram } from '../../utils/tocStorage';
import { programIdFromName } from '../../utils/programFinance';
import ReportReadinessPanel from '../../components/Reports/ReportReadinessPanel';
import ReportDraftResult, { type SectionRow } from '../../components/Reports/ReportDraftResult';
import {
  computeReportReadiness,
  draftSectionSources,
  reportReadinessTaskIntent,
  type ReportReadinessInput,
} from '../../utils/reportReadiness';
import { toastSuccessWithNext } from '../../utils/toastNext';
import EmptyStateCTA from '../../components/ui/EmptyStateCTA';
import { notifyStoreChanged } from '../../utils/storeNotify';
import './Reports.css';

type ReportType = 'funder' | 'impact' | 'donor' | 'board';

const REPORT_TYPES: { id: ReportType; label: string; icon: React.ElementType; desc: string; color: string }[] = [
  {
    id: 'funder',
    label: 'Funder Report',
    icon: FileText,
    desc: 'Utilisation certificates, grant progress, and outcome reports for funders.',
    color: '#0F766E',
  },
  {
    id: 'impact',
    label: 'Impact Report',
    icon: TrendingUp,
    desc: 'Beneficiary outcomes, program results, and social impact summaries.',
    color: '#059669',
  },
  {
    id: 'donor',
    label: 'Donor Update',
    icon: Users,
    desc: 'Personalised impact updates showing donors how their gifts made a difference.',
    color: '#0891b2',
  },
  {
    id: 'board',
    label: 'Board Brief',
    icon: Eye,
    desc: 'Executive summary of operations, financials, and key risks for board meetings.',
    color: '#7c3aed',
  },
];

const STATUS_META = {
  draft:     { label: 'Draft',     color: '#7C3AED', bg: '#F5F3FF' },
  review:    { label: 'In Review', color: '#d97706', bg: '#fef3c7' },
  submitted: { label: 'Submitted', color: '#16A34A', bg: '#d1fae5' },
  overdue:   { label: 'Overdue',   color: '#DC2626', bg: '#fee2e2' },
};

// ── Step 2: Real data-readiness computation ──────────────────────────────────
// Each condition = 25%. Returns an object with per-segment booleans and total %.
interface DataReadiness {
  hasBeneficiaries: boolean;
  hasOutcomes: boolean;
  hasTransactions: boolean;
  hasToC: boolean;
  pct: number;
  segments: { label: string; met: boolean }[];
}

function computeDataReadiness(
  report: ReportRecord,
  beneficiaries: { program: string }[],
  beneficiaryOutcomes: { programId: string }[],
  transactions: { programmeId?: string }[],
): DataReadiness {
  const progId   = report.programmeId;
  const progName = report.programmeName;

  const hasBeneficiaries = progName
    ? beneficiaries.some(b => b.program === progName)
    : beneficiaries.length > 0;

  const hasOutcomes = progId
    ? beneficiaryOutcomes.some(o => o.programId === progId)
    : beneficiaryOutcomes.length > 0;

  const hasTransactions = progId
    ? transactions.some(t => t.programmeId === progId)
    : transactions.length > 0;

  const tocNodes = progName ? readToCForProgram(progName) : [];
  const hasToC = tocNodes.length > 0;

  const met = [hasBeneficiaries, hasOutcomes, hasTransactions, hasToC].filter(Boolean).length;
  const pct = met * 25;

  return {
    hasBeneficiaries,
    hasOutcomes,
    hasTransactions,
    hasToC,
    pct,
    segments: [
      { label: 'Beneficiaries', met: hasBeneficiaries },
      { label: 'Outcomes',      met: hasOutcomes },
      { label: 'Financials',    met: hasTransactions },
      { label: 'Theory of Change', met: hasToC },
    ],
  };
}

// ── Step 4: Markdown download builder ────────────────────────────────────────
function buildMarkdown(
  report: ReportRecord,
  ngoName: string,
  ngoDetails: { reg_no?: string; pan?: string; state?: string },
  beneficiaries: { program: string; location: string; details?: Record<string, unknown> }[],
  beneficiaryOutcomes: { programId: string; metricLabel: string; baseline: number; current: number }[],
  transactions: { programmeId?: string; amount: number }[],
  journalEntries: { programmeId?: string; amount: number; entryType: string }[],
): string {
  const progId   = report.programmeId;
  const progName = report.programmeName ?? 'All Programmes';
  const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const progBeneficiaries = progName !== 'All Programmes'
    ? beneficiaries.filter(b => b.program === progName)
    : beneficiaries;

  const femaleCount = progBeneficiaries.filter(b => {
    const d = b.details as Record<string, unknown> | undefined;
    return d?.gender === 'Female' || d?.gender === 'female' || d?.gender === 'F';
  }).length;
  const maleCount = progBeneficiaries.filter(b => {
    const d = b.details as Record<string, unknown> | undefined;
    return d?.gender === 'Male' || d?.gender === 'male' || d?.gender === 'M';
  }).length;

  const locationSet = new Set(progBeneficiaries.map(b => b.location.split(',')[1]?.trim()).filter(Boolean));

  const progOutcomes = progId
    ? beneficiaryOutcomes.filter(o => o.programId === progId)
    : beneficiaryOutcomes;

  const progTxSpend = progId
    ? transactions.filter(t => t.programmeId === progId).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
    : 0;
  const journalSpend = progId
    ? journalEntries.filter(e => e.programmeId === progId && e.entryType === 'Expense').reduce((s, e) => s + Math.abs(Number(e.amount) || 0), 0)
    : journalEntries.filter(e => e.entryType === 'Expense').reduce((s, e) => s + Math.abs(Number(e.amount) || 0), 0);
  const totalSpend = journalSpend > 0 ? journalSpend : progTxSpend;
  const spendFmt = totalSpend >= 100000
    ? `₹${(totalSpend / 100000).toFixed(2)}L`
    : totalSpend > 0 ? `₹${totalSpend.toLocaleString('en-IN')}` : '_Not yet recorded_';

  const tocNodes = progName !== 'All Programmes' ? readToCForProgram(progName) : [];
  const tocImpact = tocNodes.filter(n => n.type === 'outcome' || n.type === 'impact');
  const tocSection = tocImpact.length
    ? tocImpact.map(n => `- ${n.content}`).join('\n')
    : '_No Theory of Change authored for this programme. Build one in Programs → Theory of Change._';

  const outcomesSection = progOutcomes.length
    ? progOutcomes.map(o => {
        const change = o.baseline !== 0 ? (((o.current - o.baseline) / Math.abs(o.baseline)) * 100).toFixed(1) : 'N/A';
        return `| ${o.metricLabel} | ${o.baseline} | ${o.current} | ${change !== 'N/A' ? change + '%' : 'N/A'} |`;
      }).join('\n')
    : '_No outcome records found for this programme._';

  const typeLabel: Record<string, string> = {
    funder: 'Funder Progress Report',
    impact: 'Annual Impact Report',
    donor:  'Donor Impact Update',
    board:  'Board Brief',
  };

  const lines = [
    `# ${report.title}`,
    ``,
    `**Report type:** ${typeLabel[report.type] ?? report.type}`,
    `**Organisation:** ${ngoName}`,
    ngoDetails.reg_no ? `**Registration no.:** ${ngoDetails.reg_no}` : '',
    ngoDetails.pan    ? `**PAN:** ${ngoDetails.pan}` : '',
    ngoDetails.state  ? `**State:** ${ngoDetails.state}` : '',
    `**Programme:** ${progName}`,
    report.funder ? `**Funder:** ${report.funder}` : '',
    `**Period end:** ${report.date}`,
    `**Report date:** ${today}`,
    ``,
    `---`,
    ``,
    `## 1. Executive Summary`,
    ``,
    `This report presents the progress and impact of **${progName}** as implemented by **${ngoName}**.`,
    `The programme has reached **${progBeneficiaries.length} beneficiaries** across ${locationSet.size > 0 ? Array.from(locationSet).join(', ') : 'multiple locations'}.`,
    ``,
    `## 2. Beneficiary Reach`,
    ``,
    `| Indicator | Value |`,
    `|-----------|-------|`,
    `| Total beneficiaries | ${progBeneficiaries.length} |`,
    femaleCount > 0 ? `| Female beneficiaries | ${femaleCount} |` : '',
    maleCount   > 0 ? `| Male beneficiaries   | ${maleCount} |` : '',
    ``,
    `## 3. Theory of Change — Impact Statements`,
    ``,
    tocSection,
    ``,
    `## 4. Outcomes vs. Targets`,
    ``,
    progOutcomes.length ? `| Metric | Baseline | Current | Change |` : '',
    progOutcomes.length ? `|--------|----------|---------|--------|` : '',
    outcomesSection,
    ``,
    `## 5. Financial Summary`,
    ``,
    `| Item | Amount |`,
    `|------|--------|`,
    `| Total programme spend | ${spendFmt} |`,
    report.funder ? `| Primary funder | ${report.funder} |` : '',
    ``,
    `## 6. Challenges & Learnings`,
    ``,
    `_[To be completed by the programme team before submission.]_`,
    ``,
    `## 7. Next Steps`,
    ``,
    `_[To be completed by the programme team before submission.]_`,
    ``,
    `---`,
    ``,
    `_Report generated by GoodJobs on ${today}. Review all sections before submitting to funders._`,
  ].filter(l => l !== '').join('\n');

  return lines;
}

type MockReport = ReportRecord;

const Reports: React.FC = () => {
  const grantReports = useStore(s => s.grantReports);
  const allReports = useMemo(() => {
    const seeded = [...REPORTS_CATALOGUE];
    for (const r of grantReports) {
      if (!seeded.some(s => s.id === r.id)) seeded.unshift(r);
    }
    return seeded;
  }, [grantReports]);
  useFocusFromUrl('report');
  const [activeType, setActiveType] = useState<ReportType | 'all'>('all');
  const [draftingReport, setDraftingReport] = useState<string | null>(null);
  const [draftReadyIds, setDraftReadyIds]   = useState<Set<string>>(new Set());
  const [autoSaveText, setAutoSaveText] = useState('Saved 2 min ago');
  const [reportStatuses, setReportStatuses] = useState<Record<string, MockReport['status']>>({});
  // Step 3: ToC warning banner state
  const [tocWarnFor, setTocWarnFor] = useState<{ reportId: string; reportType: ReportType } | null>(null);
  const [workflowTemplate, setWorkflowTemplate] = useState<ReportType>('funder');
  const [workflowReportId, setWorkflowReportId] = useState<string | null>(null);
  const [draftSections, setDraftSections] = useState<SectionRow[] | null>(null);
  const [refreshingSection, setRefreshingSection] = useState<string | null>(null);

  const effectiveStatus = (r: MockReport): MockReport['status'] => reportStatuses[r.id] ?? r.status;

  // Step 5: Stage-change notifications
  const { upsertTaskByIntent } = useStore(s => ({ upsertTaskByIntent: s.upsertTaskByIntent }));

  const advanceStatus = (id: string, current: MockReport['status']) => {
    const next: Record<string, MockReport['status']> = {
      overdue: 'draft', draft: 'review', review: 'submitted', submitted: 'submitted',
    };
    const nextStatus = next[current];
    setReportStatuses(prev => ({ ...prev, [id]: nextStatus }));
    toast.success('Report moved to next stage.');

    if (current === 'draft' && nextStatus === 'review') {
      const report = allReports.find(r => r.id === id);
      const reportTitle = report?.title ?? `Report #${id}`;
      const nowIso = new Date().toISOString();
      const dueFin = new Date(Date.now() + 3 * 86_400_000).toISOString();
      upsertTaskByIntent({
        id: `report-review-fin-${id}`,
        title: `Review financial section — "${reportTitle}"`,
        description: `This report has moved to In Review. Finance Officers: please review the financial summary and utilisation data before it is submitted. Navigate to Reports → "${reportTitle}" to review.`,
        dueAt: dueFin,
        priority: 'high',
        status: 'open',
        sourceType: 'agent',
        sourceAgent: 'Reports',
        sourceIntentId: `report-review-finance-${id}`,
        assignee: 'Finance Officer',
        meta: { link: `/reports?report=${id}`, reportId: id, reportTitle },
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      upsertTaskByIntent({
        id: `report-review-pm-${id}`,
        title: `Review outcomes section — "${reportTitle}"`,
        description: `This report has moved to In Review. Programme Managers: please review the outcomes and beneficiary data before it is submitted. Navigate to Reports → "${reportTitle}" to review.`,
        dueAt: dueFin,
        priority: 'high',
        status: 'open',
        sourceType: 'agent',
        sourceAgent: 'Reports',
        sourceIntentId: `report-review-pm-${id}`,
        assignee: 'Programme Manager',
        meta: { link: `/reports?report=${id}`, reportId: id, reportTitle },
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      toast(
        `Finance Officers and Programme Managers notified to review "${reportTitle}".`,
        { icon: '🔔', duration: 5000 }
      );
    }
  };

  useEffect(() => {
    const steps = ['Saved just now', 'Saved 1 min ago', 'Saved 2 min ago', 'Saved 4 min ago', 'Saved 6 min ago'];
    let idx = 1;
    const interval = setInterval(() => {
      setAutoSaveText(steps[Math.min(idx, steps.length - 1)]);
      idx++;
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const navigate = useNavigate();
  const { user, can } = useAuth();
  const {
    donors,
    transactions,
    beneficiaries,
    beneficiaryOutcomes,
    journalEntries,
    ngoDetails,
    csrCards,
  } = useStore(s => ({
    donors:              s.donors,
    transactions:        s.transactions,
    beneficiaries:       s.beneficiaries,
    beneficiaryOutcomes: s.beneficiaryOutcomes,
    journalEntries:      s.journalEntries,
    ngoDetails:          s.ngoDetails,
    csrCards:            s.csrCards,
  }));

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('action') !== 'draft') return;
    const type = p.get('type') as ReportType | null;
    const reportId = p.get('report');
    if (type && REPORT_TYPES.some(t => t.id === type)) setWorkflowTemplate(type);
    if (reportId) setWorkflowReportId(reportId);
  }, []);

  const workflowReport = useMemo(() => {
    if (workflowReportId) return allReports.find(r => r.id === workflowReportId) ?? null;
    return allReports.find(r => r.type === workflowTemplate) ?? null;
  }, [allReports, workflowReportId, workflowTemplate]);

  const readinessInput: ReportReadinessInput = useMemo(() => ({
    report: workflowReport ?? {
      id: 'new',
      title: REPORT_TYPES.find(t => t.id === workflowTemplate)?.label ?? 'Report',
      type: workflowTemplate,
      status: 'draft',
      date: new Date().toISOString().slice(0, 10),
    },
    beneficiaries,
    beneficiaryOutcomes,
    transactions,
    journalEntries,
    csrCards,
    donors,
  }), [workflowReport, workflowTemplate, beneficiaries, beneficiaryOutcomes, transactions, journalEntries, csrCards, donors]);

  const workflowReadiness = useMemo(
    () => computeReportReadiness(readinessInput),
    [readinessInput],
  );

  const createReadinessFollowUpTasks = (report: ReportRecord, readiness = workflowReadiness) => {
    const now = new Date().toISOString();
    for (const item of readiness.items.filter(i => !i.met)) {
      upsertTaskByIntent({
        id: reportReadinessTaskIntent(report.id, item.id),
        title: `Report gap: ${item.label}`,
        description: `Complete before finalising "${report.title}". ${item.fixLabel}.`,
        priority: 'high',
        status: 'open',
        sourceType: 'agent',
        sourceAgent: 'Reports',
        sourceIntentId: reportReadinessTaskIntent(report.id, item.id),
        relatedEntityType: 'compliance',
        relatedEntityId: report.id,
        meta: { link: item.fixPath, reportId: report.id },
        createdAt: now,
        updatedAt: now,
      });
    }
    notifyStoreChanged();
  };

  const buildSectionRows = (report: ReportRecord, markdown?: string): SectionRow[] => {
    const sources = draftSectionSources(report, readinessInput);
    const md = markdown ?? '';
    return sources.map(src => ({
      id: src.id,
      title: src.title,
      source: src,
      preview: md.slice(0, 180) || `Pulled from ${src.sourceLabel} — refresh after you update source data.`,
    }));
  };
  const { tier, limits, usage, openUpgrade } = useTier();
  const [reportUpgradeOpen, setReportUpgradeOpen] = useState(false);

  // Pull per-program Theory-of-Change outcomes so impact/funder narratives
  // can be anchored to the same statements the program lead authored.
  const tocSnapshots = React.useMemo(() => {
    const programs = Array.from(new Set(beneficiaries.map((b: any) => String(b.program || '')).filter(Boolean)));
    const list: { program: string; outcomes: string[] }[] = [];
    const seen = new Set<string>();
    const consider = (p: string) => {
      const key = p || 'General';
      if (seen.has(key)) return;
      seen.add(key);
      const nodes = readToCForProgram(p);
      const outcomes = nodes
        .filter(n => n.type === 'outcome' || n.type === 'impact')
        .map(n => n.content)
        .filter(Boolean);
      if (outcomes.length) list.push({ program: key, outcomes });
    };
    for (const p of programs) consider(p);
    consider('General');
    return list;
  }, [beneficiaries]);

  const copyOutcomesForProgram = async (program: string, outcomes: string[]) => {
    const text = `Theory of Change — ${program}\n\n` + outcomes.map(o => `• ${o}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${program} outcomes copied — paste into your draft.`);
    } catch {
      toast.error('Copy failed — please select and copy manually.');
    }
  };

  // Step 1: Live data pull — build context object for the AI draft request
  const buildDraftContext = (report: ReportRecord | null, reportType: ReportType) => {
    const progName = report?.programmeName ?? null;
    const progId   = report?.programmeId   ?? null;

    const progBeneficiaries = progName
      ? beneficiaries.filter(b => b.program === progName)
      : beneficiaries;

    const progOutcomes = progId
      ? beneficiaryOutcomes.filter(o => o.programId === progId)
      : beneficiaryOutcomes;

    const totalSpend = progId
      ? transactions.filter(t => t.programmeId === progId)
          .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
      : transactions.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);

    const tocNodes = progName ? readToCForProgram(progName) : [];
    const tocStatements = tocNodes
      .filter(n => n.type === 'outcome' || n.type === 'impact')
      .map(n => n.content);

    return {
      ngo_name:         ngoDetails.name,
      programme_name:   progName ?? 'General',
      beneficiary_count: progBeneficiaries.length,
      outcomes: progOutcomes.map(o => `${o.metricLabel}: baseline ${o.baseline} → current ${o.current}`),
      total_spend: totalSpend,
      toc_nodes:   tocStatements,
    };
  };

  // Step 3: Check if the report's programme has a ToC — if not, show warning
  const hasToCForReport = (report: ReportRecord | null): boolean => {
    if (!report?.programmeName) return true; // no programme linked → no warning
    const nodes = readToCForProgram(report.programmeName);
    return nodes.length > 0;
  };

  const handleDraftReport = async (
    type: ReportType,
    report: ReportRecord | null = null,
    skipToCCheck = false,
    skipReadiness = false,
  ) => {
    if (!can('reports', 'canEdit')) {
      toast.error('You do not have permission to generate reports.');
      return;
    }
    if (limits.reportsPerMonth !== null && usage.reportsThisMonth >= limits.reportsPerMonth) {
      setReportUpgradeOpen(true);
      return;
    }

    const target = report ?? workflowReport;
    const input: ReportReadinessInput = target
      ? { ...readinessInput, report: target }
      : readinessInput;
    const readiness = computeReportReadiness(input);
    if (!skipReadiness && !readiness.isReady) {
      toast.error(`Cannot draft yet — ${readiness.readyLabel}. Fix linked data first.`);
      return;
    }

    // Step 3: ToC warning gate
    if (!skipToCCheck && target && !hasToCForReport(target)) {
      setTocWarnFor({ reportId: target.id, reportType: type });
      return;
    }

    const draftKey = target?.id ?? type;
    setDraftingReport(draftKey);
    let succeeded = false;
    let markdown = '';
    try {
      const context = buildDraftContext(target, type);
      const res = await apiFetch('/gen-ai/draft-report', {
        method: 'POST',
        body: JSON.stringify({ type, role: user?.role, title: target?.title, context }),
      });
      if (!res.ok) throw new Error('Draft failed');
      const data = await res.json();
      markdown = String(data.markdown ?? '');
      if (markdown) {
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(target?.title ?? data.title ?? 'Report').replace(/\s+/g, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
      }
      succeeded = true;
      if (target) {
        setDraftReadyIds(prev => new Set(prev).add(target.id));
        setDraftSections(buildSectionRows(target, markdown));
        createReadinessFollowUpTasks(target, readiness);
      }
      const firstGap = readiness.items.find(i => !i.met);
      toastSuccessWithNext(
        'AI draft generated from live programme, finance, and donor data.',
        {
          label: firstGap ? firstGap.fixLabel : 'Review draft sections',
          onClick: () => {
            if (firstGap) navigate(firstGap.fixPath);
          },
        },
      );
    } catch {
      // The mock backend intercepts all requests in dev, so catch only fires
      // on truly unexpected errors (e.g. JSON parse failure). Do not mark
      // succeeded=true here — failed drafts must not consume quota or show
      // a "Draft ready" badge. Show an error toast instead.
      toast.error('Draft failed — please try again.');
    } finally {
      if (succeeded && user?.ngoId) recordReportDraft(user.ngoId);
      setDraftingReport(null);
      setTocWarnFor(null);
    }
  };

  // Step 4: Full markdown download
  const handleDownload = (report: MockReport) => {
    const md = buildMarkdown(
      report,
      ngoDetails.name ?? '',
      { reg_no: ngoDetails.reg_no, pan: ngoDetails.pan, state: ngoDetails.state },
      beneficiaries,
      beneficiaryOutcomes,
      transactions,
      journalEntries,
    );
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report downloaded as Markdown.');
  };

  const filteredReports = activeType === 'all'
    ? allReports
    : allReports.filter(r => r.type === activeType);

  const reportsReadyForDraft = allReports.filter(r => {
    const rd = computeDataReadiness(r, beneficiaries, beneficiaryOutcomes, transactions);
    return rd.pct >= 75;
  }).length;

  return (
    <div className="reports-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="reports-header">
        <div>
          <h1 className="reports-title">Reports</h1>
          <p className="reports-subtitle">Funder Reports · Impact Reports · Donor Updates · Board Briefs</p>
        </div>
        <div className="reports-header-right">
          <span className="reports-autosave">{autoSaveText}</span>
          {can('reports', 'canEdit') && (
            <button
              className="reports-btn-primary"
              disabled={!workflowReadiness.isReady || !!draftingReport}
              title={workflowReadiness.isReady ? 'Generate AI draft' : workflowReadiness.readyLabel}
              onClick={() => handleDraftReport(workflowTemplate, workflowReport)}
            >
              <Sparkles size={15} /> {draftingReport ? 'Drafting…' : 'AI Draft'}
            </button>
          )}
        </div>
      </div>

      <section className="reports-workflow card">
        <h2 className="reports-workflow-title">1. Choose report template</h2>
        <div className="reports-workflow-templates">
          {REPORT_TYPES.map(rt => (
            <button
              key={rt.id}
              type="button"
              className={`reports-workflow-template ${workflowTemplate === rt.id ? 'active' : ''}`}
              onClick={() => { setWorkflowTemplate(rt.id); setWorkflowReportId(null); setDraftSections(null); }}
            >
              <rt.icon size={16} style={{ color: rt.color }} />
              {rt.label}
            </button>
          ))}
        </div>
        {allReports.filter(r => r.type === workflowTemplate).length > 0 && (
          <label className="reports-workflow-select">
            Linked report record
            <select
              className="input"
              value={workflowReportId ?? workflowReport?.id ?? ''}
              onChange={e => { setWorkflowReportId(e.target.value || null); setDraftSections(null); }}
            >
              {allReports.filter(r => r.type === workflowTemplate).map(r => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          </label>
        )}
        <h2 className="reports-workflow-title">2. Data readiness</h2>
        <ReportReadinessPanel readiness={workflowReadiness} />
        <h2 className="reports-workflow-title">3. AI drafting</h2>
        <p className="reports-workflow-hint">
          {workflowReadiness.isReady
            ? 'Prerequisites met — generate a draft anchored to live data.'
            : 'Resolve missing items above before the AI assembles your report.'}
        </p>
        {can('reports', 'canEdit') && (
          <button
            className="reports-btn-primary"
            disabled={!workflowReadiness.isReady || !!draftingReport}
            onClick={() => handleDraftReport(workflowTemplate, workflowReport)}
          >
            <Sparkles size={15} /> {draftingReport ? 'Drafting…' : 'Generate AI draft'}
          </button>
        )}
      </section>

      {draftSections && workflowReport && (
        <ReportDraftResult
          reportTitle={workflowReport.title}
          sections={draftSections}
          refreshingId={refreshingSection}
          onRefreshSection={async (sectionId) => {
            setRefreshingSection(sectionId);
            try {
              const res = await apiFetch('/gen-ai/draft-report', {
                method: 'POST',
                body: JSON.stringify({
                  type: workflowTemplate,
                  role: user?.role,
                  title: workflowReport.title,
                  context: buildDraftContext(workflowReport, workflowTemplate),
                  section: sectionId,
                }),
              });
              if (!res.ok) throw new Error('refresh');
              const data = await res.json();
              const snippet = String(data.markdown ?? data.section ?? '').slice(0, 280);
              setDraftSections(prev => (prev ?? []).map(s =>
                s.id === sectionId ? { ...s, preview: snippet || s.preview } : s,
              ));
              toast.success('Section refreshed from latest data.');
              notifyStoreChanged();
            } catch {
              toast.error('Could not refresh section.');
            } finally {
              setRefreshingSection(null);
            }
          }}
        />
      )}

      {/* ── Step 3: ToC warning banner ────────────────────────────── */}
      {tocWarnFor && (
        <div className="reports-toc-warning">
          <TriangleAlert size={16} style={{ flexShrink: 0 }} />
          <span>
            This programme has no Theory of Change — your report will use generic impact language.
            Build a ToC first for a more specific draft.
          </span>
          <div className="reports-toc-warning-actions">
            <button
              className="reports-btn-secondary"
              onClick={() => navigate('/programs?tab=toc')}
            >
              Build ToC <ArrowRight size={13} />
            </button>
            <button
              className="reports-ai-btn reports-ai-btn--primary"
              onClick={() => {
                const r = allReports.find(r => r.id === tocWarnFor.reportId) ?? null;
                handleDraftReport(tocWarnFor.reportType, r, true, true);
              }}
            >
              Draft anyway
            </button>
            <button
              className="reports-toc-warning-dismiss"
              onClick={() => setTocWarnFor(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── AI Assembler banner ────────────────────────────────────── */}
      {can('reports', 'canEdit') && reportsReadyForDraft > 0 && (
        <motion.div className="reports-ai-banner reports-ai-banner--top">
          <div className="reports-ai-icon">
            <Sparkles size={18} />
          </div>
          <div className="reports-ai-content">
          <div className="reports-ai-title">
              {reportsReadyForDraft} report{reportsReadyForDraft === 1 ? '' : 's'} at 75%+ legacy data score
            </div>
            <div className="reports-ai-desc">
              Use the readiness workflow above for fix links, follow-up tasks, and section refresh.
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Theory of Change anchor ───────────────────────────────── */}
      {tocSnapshots.length > 0 && (
        <div className="reports-toc-anchor">
          <div className="reports-toc-anchor-header">
            <div>
              <div className="reports-toc-anchor-title">
                <Sparkles size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                Anchor narratives to your Theory of Change
              </div>
              <div className="reports-toc-anchor-sub">
                Funders expect outcomes language to match what you committed to. Copy the relevant program's outcomes into impact / funder reports.
              </div>
            </div>
            <button className="reports-btn-secondary" onClick={() => navigate('/programs?tab=toc')}>
              Edit ToC <ArrowRight size={13} />
            </button>
          </div>
          <div className="reports-toc-anchor-grid">
            {tocSnapshots.map(({ program, outcomes }) => (
              <div key={program} className="reports-toc-anchor-card">
                <div className="reports-toc-anchor-card-title">{program}</div>
                <ul className="reports-toc-anchor-list">
                  {outcomes.slice(0, 3).map((o, i) => (<li key={i}>{o}</li>))}
                </ul>
                {outcomes.length > 3 && (
                  <div className="reports-toc-anchor-more">+{outcomes.length - 3} more</div>
                )}
                <button
                  className="reports-toc-anchor-copy"
                  onClick={() => copyOutcomesForProgram(program, outcomes)}
                >
                  Copy outcomes
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Kanban Pipeline Strip ─────────────────────────────────── */}
      <div className="reports-kanban">
        {(([
          { key: 'overdue'   , label: 'Overdue',   Icon: AlertCircle,  color: '#DC2626', bg: '#fee2e2' },
          { key: 'draft'     , label: 'Draft',     Icon: FileText,     color: '#7C3AED', bg: '#F5F3FF' },
          { key: 'review'    , label: 'In Review', Icon: Clock,        color: '#d97706', bg: '#fef3c7' },
          { key: 'submitted' , label: 'Submitted', Icon: CheckCircle2, color: '#16A34A', bg: '#d1fae5' },
        ] as { key: MockReport['status']; label: string; Icon: React.ElementType; color: string; bg: string }[]).map(lane => {
          const laneReports = allReports.filter(r => effectiveStatus(r) === lane.key);
          const advanceLabel: Record<string, string> = {
            overdue: 'Move to Draft →', draft: 'Send to Review →', review: 'Mark Submitted ✓',
          };
          return (
            <div key={lane.key} className="reports-kanban-lane" style={{ '--lane-color': lane.color } as React.CSSProperties}>
              <div className="reports-kanban-lane-header" style={{ borderTopColor: lane.color }}>
                <div className="reports-kanban-lane-icon" style={{ background: lane.bg, color: lane.color }}>
                  <lane.Icon size={13} />
                </div>
                <span className="reports-kanban-lane-label">{lane.label}</span>
                <span className="reports-kanban-lane-count" style={{ background: lane.bg, color: lane.color }}>
                  {laneReports.length}
                </span>
              </div>
              <div className="reports-kanban-cards">
                {laneReports.map(r => {
                  const typeInfo = REPORT_TYPES.find(t => t.id === r.type)!;
                  const isDrafting = draftingReport === r.id;
                  return (
                    <div key={r.id} className="reports-kanban-card">
                      <div className="reports-kanban-card-title" title={r.title}>
                        {isDrafting && <span style={{ marginRight: 4 }}>⏳</span>}
                        {r.title.length > 38 ? r.title.slice(0, 38) + '…' : r.title}
                      </div>
                      <div className="reports-kanban-card-meta" style={{ color: typeInfo.color }}>
                        {typeInfo.label}
                      </div>
                      {lane.key !== 'submitted' && (
                        <button
                          className="reports-kanban-advance"
                          onClick={() => advanceStatus(r.id, effectiveStatus(r))}
                        >
                          {advanceLabel[lane.key]}
                        </button>
                      )}
                    </div>
                  );
                })}
                {laneReports.length === 0 && (
                  <div className="reports-kanban-empty">—</div>
                )}
              </div>
            </div>
          );
        }))}
      </div>

      {/* ── Report Type Cards ─────────────────────────────────────── */}
      <div className="reports-type-grid">
        {REPORT_TYPES.map(rt => {
          const Icon = rt.icon;
          const count = allReports.filter(r => r.type === rt.id).length;
          return (
            <motion.div
              key={rt.id}
              className={`reports-type-card ${activeType === rt.id ? 'active' : ''}`}
              style={{ '--type-color': rt.color } as React.CSSProperties}
              whileHover={{ y: -2 }}
              onClick={() => setActiveType(activeType === rt.id ? 'all' : rt.id)}
            >
              <div className="reports-type-icon" style={{ background: `${rt.color}18`, color: rt.color }}>
                <Icon size={20} />
              </div>
              <div className="reports-type-info">
                <div className="reports-type-label">{rt.label}</div>
                <div className="reports-type-desc">{rt.desc}</div>
              </div>
              <div className="reports-type-count">{count}</div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Reports List ──────────────────────────────────────────── */}
      <div className="reports-list-section">
        <div className="reports-list-header">
          <h2 className="reports-list-title">
            {activeType === 'all' ? 'All Reports' : REPORT_TYPES.find(t => t.id === activeType)?.label + 's'}
          </h2>
          {activeType !== 'all' && (
            <button className="reports-filter-clear" onClick={() => setActiveType('all')}>
              Clear filter ×
            </button>
          )}
        </div>

        <motion.div className="reports-list">
          {filteredReports.length === 0 ? (
            <EmptyStateCTA
              title="No reports in this view"
              description="Pick a report type or clear the filter — then check readiness before drafting."
              actionLabel="Show all reports"
              onAction={() => setActiveType('all')}
              secondaryLabel="Open programmes"
              onSecondary={() => navigate('/programs')}
            />
          ) : filteredReports.map((report, i) => {
            const sm = STATUS_META[effectiveStatus(report)];
            const typeInfo = REPORT_TYPES.find(t => t.id === report.type)!;
            const TypeIcon = typeInfo.icon;
            const isDrafting = draftingReport === report.id;
            const isDraftReady = draftReadyIds.has(report.id);
            // Step 2: live readiness bar
            const readiness = computeReportReadiness({
              report,
              beneficiaries,
              beneficiaryOutcomes,
              transactions,
              journalEntries,
              csrCards,
              donors,
            });
            const rdColor = readiness.isReady ? '#16A34A' : readiness.missingCount <= 2 ? '#d97706' : '#DC2626';

            return (
              <motion.div
                key={report.id}
                data-focus-id={report.id}
                className="reports-list-item"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <div className="reports-item-icon" style={{ background: `${typeInfo.color}18`, color: typeInfo.color }}>
                  <TypeIcon size={16} />
                </div>
                <div className="reports-item-body">
                  <div className="reports-item-title">{report.title}</div>
                  <div className="reports-item-meta">
                    {typeInfo.label}
                    {report.programmeName && <> · {report.programmeName}</>}
                    {report.funder && <> · {report.funder}</>}
                    {' · '}
                    <span className="reports-item-date">{report.date}</span>
                  </div>

                  {/* Step 2: 4-segment readiness bar */}
                  <div className="reports-item-readiness">
                    <div className="reports-item-readiness-segments">
                      {readiness.items.map(seg => (
                        <div
                          key={seg.id}
                          className="reports-item-readiness-seg"
                          style={{ background: seg.met ? rdColor : '#e5e7eb' }}
                          title={`${seg.label}: ${seg.met ? '✓' : '✗'}`}
                        />
                      ))}
                    </div>
                    <span className="reports-item-readiness-label" style={{ color: rdColor }}>
                      {readiness.readyLabel}
                    </span>
                    <span className="reports-item-readiness-detail">
                      {readiness.items.filter(s => s.met).map(s => s.label).join(' · ') || 'No data yet'}
                    </span>
                  </div>

                  {/* Drafting spinner / draft-ready badge */}
                  {isDrafting && (
                    <div className="reports-item-drafting">
                      <span className="reports-item-drafting-spinner" aria-hidden="true" />
                      Drafting…
                    </div>
                  )}
                  {!isDrafting && isDraftReady && (
                    <div className="reports-item-draft-ready">
                      <CheckCircle2 size={12} /> Draft ready — download
                    </div>
                  )}
                </div>

                <span className="reports-item-badge" style={{ background: sm.bg, color: sm.color }}>
                  {sm.label}
                </span>

                <div className="reports-item-actions">
                  <button
                    className="reports-item-btn"
                    title="View"
                    onClick={() => toast(`Viewing: ${report.title}`, { icon: '📄' })}
                  >
                    <Eye size={14} />
                  </button>

                  {/* Step 4: formatted markdown download */}
                  <button
                    className="reports-item-btn"
                    title="Download as Markdown"
                    onClick={() => handleDownload(report)}
                  >
                    <Download size={14} />
                  </button>

                  {/* AI draft button per-report */}
                  {can('reports', 'canEdit') && (
                    <button
                      className="reports-item-btn"
                      title={readiness.isReady ? 'AI Draft' : readiness.readyLabel}
                      disabled={isDrafting || !readiness.isReady}
                      onClick={() => handleDraftReport(report.type, report)}
                    >
                      <Sparkles size={14} />
                    </button>
                  )}

                  {(effectiveStatus(report) === 'draft' || effectiveStatus(report) === 'review') && can('reports', 'canEdit') && (
                    <button
                      className="reports-item-btn reports-item-btn--send"
                      title="Submit"
                      onClick={() => toast.success(`Report "${report.title}" marked for submission.`)}
                    >
                      <Send size={14} />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Tier-cap prompt */}
      <ContextualUpgradePrompt
        open={reportUpgradeOpen}
        onClose={() => setReportUpgradeOpen(false)}
        blockedAction="More AI-drafted reports"
        reason={
          tier === 'starter'
            ? `Starter includes ${limits.reportsPerMonth} AI-drafted reports per month. You've used ${usage.reportsThisMonth}.`
            : `Growth includes ${limits.reportsPerMonth} AI-drafted reports per month. You've used ${usage.reportsThisMonth}.`
        }
        nextBenefits={
          tier === 'starter'
            ? ['20 AI report drafts / month', 'AI Copilot for receipts & funder updates', 'WhatsApp data entry', 'Priority support']
            : ['Unlimited AI report drafts', 'Unlimited team members', 'SSO + audit log', 'Dedicated success manager']
        }
        targetTier={tier === 'starter' ? 'growth' : 'scale'}
        onUpgrade={() => {
          setReportUpgradeOpen(false);
          openUpgrade({
            targetTier: tier === 'starter' ? 'growth' : 'scale',
            source: 'reports_monthly_cap',
          });
        }}
      />
    </div>
  );
};

export default Reports;
