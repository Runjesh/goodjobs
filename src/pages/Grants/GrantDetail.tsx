import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, AlertCircle, AlertTriangle, Check, CheckCircle2,
  Clock, Edit, X, Sparkles, Target, Wallet, FileText, BellRing, Award,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import './GrantDetail.css';
import GrantTrancheCard from '../../components/Grants/GrantTrancheCard';
import GrantProgramsPanel from '../../components/Grants/GrantProgramsPanel';
import GrantBudgetHeadsPanel from '../../components/Grants/GrantBudgetHeadsPanel';
import { selectGrantUtilisation } from '../../utils/grantBudgetHeads';
import AtRiskGrantsBanner from '../../components/Compliance/AtRiskGrantsBanner';
import { apiFetch } from '../../api/client';
import { mergeGrantState, sanitiseGrantStateForServer } from '../../utils/grantState';
import {
  projectParserRowsIntoState,
  type ParserExtraction,
  type ParserRow,
} from '../../utils/grantParserProjection';
import RecordTasksPanel from '../../components/Common/RecordTasksPanel';

type LifecycleStage = 'pipeline' | 'applied' | 'awarded' | 'active' | 'closed';

const STAGES: { id: LifecycleStage; label: string }[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'applied',  label: 'Applied' },
  { id: 'awarded',  label: 'Awarded' },
  { id: 'active',   label: 'Active' },
  { id: 'closed',   label: 'Closed' },
];

const STORAGE_PREFIX = 'goodjobs.grant.';

function colToStage(col?: string): LifecycleStage {
  switch (col) {
    case 'prospecting': return 'pipeline';
    case 'pitch':
    case 'diligence':   return 'applied';
    case 'mou':         return 'awarded';
    case 'live':        return 'active';
    case 'closed':      return 'closed';
    default:            return 'pipeline';
  }
}

function stageToCol(stage: LifecycleStage, current: string): string {
  switch (stage) {
    case 'pipeline': return 'prospecting';
    case 'applied':  return current === 'diligence' ? 'diligence' : 'pitch';
    case 'awarded':  return 'mou';
    case 'active':   return 'live';
    case 'closed':   return 'closed';
  }
}

interface GrantState {
  notes: string;
  decisionDate: string;
  followUpDate: string;
  parserDecisions: Record<string, 'pending' | 'approved' | 'rejected' | 'edited'>;
  parserEdits: Record<string, string>;
  deliverables: { id: string; title: string; progress: number; due: string }[];
  reports: { id: string; title: string; status: 'draft' | 'in_review' | 'submitted'; due: string }[];
  budget: { id: string; head: string; allocated: number; spent: number }[];
  nextReportDue: string;
  closureChecklist: Record<string, boolean>;
  closureSummary: { beneficiariesServed: number; outcomes: string[] };
  closingMode: boolean;
  isClosed: boolean;
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function deterministicMock(card: any): GrantState {
  const seed = String(card?.id ?? '0').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const rand = (mod: number) => Math.abs((seed * 9301 + 49297) % 233280) % mod;
  const amount = Number(card?.amount) || 1000000;

  return {
    notes: '',
    decisionDate: inDays(21),
    followUpDate: inDays(7),
    parserDecisions: {},
    parserEdits: {},
    deliverables: [
      { id: 'd1', title: `Train ${100 + rand(400)} direct beneficiaries`, progress: 28, due: inDays(60) },
      { id: 'd2', title: 'Quarterly narrative + utilisation report',     progress: 55, due: inDays(15) },
      { id: 'd3', title: 'Mid-line outcome survey (independent)',         progress: 0,  due: inDays(120) },
      { id: 'd4', title: 'Beneficiary case studies (5)',                   progress: 40, due: inDays(45) },
    ],
    reports: [
      { id: 'r1', title: 'Q1 Narrative + UC', status: 'submitted', due: inDays(-30) },
      { id: 'r2', title: 'Q2 Narrative + UC', status: 'in_review', due: inDays(-2) },
      { id: 'r3', title: 'Q3 Narrative + UC', status: 'draft',     due: inDays(60) },
    ],
    budget: [
      { id: 'h1', head: 'Programme delivery', allocated: Math.round(amount * 0.60), spent: Math.round(amount * 0.18) },
      { id: 'h2', head: 'M&E + reporting',     allocated: Math.round(amount * 0.10), spent: Math.round(amount * 0.03) },
      { id: 'h3', head: 'Capacity building',   allocated: Math.round(amount * 0.15), spent: Math.round(amount * 0.05) },
      { id: 'h4', head: 'Admin (cap 15%)',     allocated: Math.round(amount * 0.15), spent: Math.round(amount * 0.06) },
    ],
    nextReportDue: inDays(5 + rand(30)),
    closureChecklist: {},
    closureSummary: {
      beneficiariesServed: 200 + rand(800),
      outcomes: [
        'All milestone targets reached or exceeded',
        '92% beneficiary satisfaction (target: 80%)',
        'Independent evaluation submitted to funder',
      ],
    },
    closingMode: false,
    isClosed: false,
  };
}

function loadGrantState(card: any): GrantState {
  if (!card) return deterministicMock({ id: '0' });
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + String(card.id) + '.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      const mock = deterministicMock(card);
      return { ...mock, ...parsed };
    }
  } catch {
    // ignore
  }
  return deterministicMock(card);
}

function saveGrantState(id: string | number, state: GrantState) {
  try {
    localStorage.setItem(STORAGE_PREFIX + String(id) + '.v1', JSON.stringify(state));
  } catch {
    // ignore
  }
}

function buildParserRows(card: any): ParserRow[] {
  const amount = Number(card?.amount) || 1000000;
  const project = card?.project || 'Project';
  return [
    { id: 'pl1', type: 'deadline',    label: 'Final UC submission',           detail: 'Within 30 days of project completion',           confidence: 0.96 },
    { id: 'pl2', type: 'deadline',    label: 'Quarterly progress reports',    detail: 'Q1 Jan, Q2 Apr, Q3 Jul, Q4 Oct (15th)',          confidence: 0.91 },
    { id: 'pl3', type: 'deadline',    label: 'Mid-line evaluation',           detail: 'At month 6 of project',                          confidence: 0.78 },
    { id: 'dv1', type: 'deliverable', label: 'Beneficiary training',          detail: `${project} — direct training cohort`,            confidence: 0.93 },
    { id: 'dv2', type: 'deliverable', label: 'Field documentation',           detail: '5 case studies + photo essay',                   confidence: 0.85 },
    { id: 'dv3', type: 'deliverable', label: 'Independent assessment',        detail: 'Third-party endline survey',                     confidence: 0.72 },
    { id: 'bg1', type: 'budget',      label: 'Programme delivery',            detail: `₹${(amount * 0.60 / 100000).toFixed(1)}L · 60%`, confidence: 0.97 },
    { id: 'bg2', type: 'budget',      label: 'Capacity building',             detail: `₹${(amount * 0.15 / 100000).toFixed(1)}L · 15%`, confidence: 0.94 },
    { id: 'bg3', type: 'budget',      label: 'M&E + reporting',               detail: `₹${(amount * 0.10 / 100000).toFixed(1)}L · 10%`, confidence: 0.89 },
    { id: 'bg4', type: 'budget',      label: 'Admin overhead',                detail: `₹${(amount * 0.15 / 100000).toFixed(1)}L · 15% (cap 15%)`, confidence: 0.82 },
    { id: 'cd1', type: 'condition',   label: 'No-diversion clause',           detail: 'Funds usable only for the Schedule VII purpose', confidence: 0.96 },
    { id: 'cd2', type: 'condition',   label: 'Auditor sign-off',              detail: 'Independent CA sign-off required on UC',         confidence: 0.94 },
    { id: 'cd3', type: 'condition',   label: 'Branding & visibility',         detail: 'Funder logo on all collaterals',                 confidence: 0.88 },
    { id: 'cd4', type: 'condition',   label: 'Repayment of unspent funds',    detail: 'Within 60 days of project closure',              confidence: 0.79 },
  ];
}

const CLOSURE_STEPS = [
  { id: 'uc',           label: 'Final Utilisation Certificate filed (CA-signed)', help: 'Generated from Finance and signed by independent CA' },
  { id: 'unspent',      label: 'Unspent funds reconciled / refunded',              help: 'Repayment within 60 days of project closure' },
  { id: 'deliverables', label: 'All deliverables marked complete',                  help: 'Programme team confirms; outcomes evidenced' },
  { id: 'beneficiaries',label: 'Beneficiary status updated in roster',              help: 'Programs module — exit / graduation flags set' },
  { id: 'archive',      label: 'Document Room archived & locked',                   help: 'Contracts, MoUs, photos and reports indexed' },
  { id: 'ed',           label: 'Executive Director sign-off',                       help: 'Final approval to mark grant Closed' },
];

const fmtINR = (v: number) => v >= 1e7 ? `₹${(v/1e7).toFixed(2)}Cr` : `₹${(v/1e5).toFixed(1)}L`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const GrantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { csrCards, updateCSRCard } = useStore();
  const grantBudgetHeads = useStore(s => s.grantBudgetHeads);
  const journalEntries   = useStore(s => s.journalEntries);

  const card = useMemo(() => csrCards.find(c => String(c.id) === String(id)), [csrCards, id]);

  const [state, setState] = useState<GrantState>(() => loadGrantState(card));
  // Track which card.id our `state` was hydrated for, to avoid a save-before-
  // load race that would overwrite persisted state with the mock. Init to
  // null (NOT card.id) so the hydration effect runs on first mount even when
  // the card is already in the store — otherwise the GET never fires and the
  // PUT gate stays closed forever.
  const [hydratedForId, setHydratedForId] = useState<string | null>(null);
  // Flips to the card.id after the initial GET settles (success, empty, OR
  // network error). The PUT effect waits for this so we never clobber newer
  // server state with stale localStorage/mock on mount.
  const [serverHydratedFor, setServerHydratedFor] = useState<string | null>(null);
  // 'idle' between writes; 'saving' while a PUT is in flight; 'error' if the
  // last PUT failed (we still keep the LS write so nothing is lost).
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Persisted closure flag survives page reload even if API resets card.col to 'live'
  const baseStage: LifecycleStage = state.isClosed
    ? 'closed'
    : (card ? colToStage(card.col) : 'pipeline');
  // Visual stage: if user clicked "Begin Closure" while Active, show Closed UI without advancing card.col
  const stage: LifecycleStage = baseStage === 'active' && state.closingMode ? 'closed' : baseStage;
  const stageIdx = STAGES.findIndex(s => s.id === stage);
  const [activeActiveTab, setActiveActiveTab] = useState<'deliverables' | 'budget' | 'reports' | 'cascade'>('deliverables');
  const [editingRow, setEditingRow] = useState<string | null>(null);

  // Hydrate for this card: LS is the fast cache, the server is source-of-
  // truth. Server fields win when present; missing fields fall through to
  // whatever the cache had so a partial server response can never blank out
  // a user's edits.
  useEffect(() => {
    if (!card) return;
    const cardKey = String(card.id);
    if (hydratedForId === cardKey) return;
    const cached = loadGrantState(card);
    setState(cached);
    setHydratedForId(cardKey);

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/csr/cards/${encodeURIComponent(cardKey)}/grant-state`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const serverState = data?.state as Partial<GrantState> | null | undefined;
          if (serverState) {
            setState(prev => {
              // Merge into the latest local state, not the cache snapshot, so
              // any edits the user made between mount and fetch survive on
              // fields the server payload didn't touch.
              const merged = mergeGrantState(prev, serverState);
              // Refresh the LS cache so a refresh-without-server still shows
              // the server-resident state.
              saveGrantState(card.id, merged);
              return merged;
            });
          }
        }
      } catch { /* offline — LS cache stays in effect */ }
      finally {
        // Always release the PUT gate, even on network failure, so the user
        // can keep working offline. In offline mode the PUT will fail too,
        // surfaced as the "Local only" sync chip.
        if (!cancelled) setServerHydratedFor(cardKey);
      }
    })();
    return () => { cancelled = true; };
  }, [card, hydratedForId]);

  // Persist on change: write LS immediately (optimistic), then debounce a PUT
  // to the server so rapid edits coalesce into one network round-trip. Gated
  // on `serverHydratedFor` so the initial mount can't PUT stale cache before
  // we've seen what the server already has.
  useEffect(() => {
    if (!card) return;
    if (hydratedForId !== String(card.id)) return;
    saveGrantState(card.id, state);
    if (serverHydratedFor !== String(card.id)) return;

    const cardKey = String(card.id);
    setSyncStatus('saving');
    const handle = window.setTimeout(async () => {
      try {
        const payload = sanitiseGrantStateForServer(state);
        const res = await apiFetch(`/csr/cards/${encodeURIComponent(cardKey)}/grant-state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: payload }),
        });
        setSyncStatus(res.ok ? 'saved' : 'error');
      } catch {
        setSyncStatus('error');
      }
    }, 800);
    return () => window.clearTimeout(handle);
  }, [state, card, hydratedForId, serverHydratedFor]);

  // Server-extracted parser rows + cache state. We start with the local
  // mock so the UI is never blank, then replace once the server responds.
  // `extractionMeta` powers the small "AI / Heuristic / Mock — re-run" chip.
  const [extractionMeta, setExtractionMeta] = useState<{
    source: ParserExtraction['source'];
    docName?: string | null;
    extractedAt?: string;
  } | null>(null);
  const [parserRows, setParserRows] = useState<ParserRow[]>(() =>
    buildParserRows(card) as ParserRow[]
  );
  const [extracting, setExtracting] = useState(false);
  // null until the GET (and any auto-POST) settles for this card. Projection
  // is gated on this so the previous card's parser rows can never be written
  // into the new card's deliverables/budget/reports during navigation.
  const [parserHydratedFor, setParserHydratedFor] = useState<string | null>(null);

  // Fetch the cached extraction on mount; if the server has nothing yet,
  // POST once to generate the heuristic/LLM rows so the user sees a real
  // extraction (not the static frontend mock) on first awarded view.
  useEffect(() => {
    if (!card) return;
    const cardKey = String(card.id);
    if (parserHydratedFor === cardKey) return;
    // Reset to the per-card local mock immediately on card change so the
    // previous grant's rows can't be projected into this one if the fetch
    // fails or arrives late. Clear the meta chip too so it doesn't lie.
    setParserRows(buildParserRows(card) as ParserRow[]);
    setExtractionMeta(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/csr/cards/${encodeURIComponent(cardKey)}/parser-rows`);
        if (cancelled) return;
        let extraction: ParserExtraction | null = null;
        if (res.ok) {
          const data = await res.json();
          extraction = (data?.extraction as ParserExtraction | null) ?? null;
        }
        if (!extraction && !cancelled) {
          // First view of this card — kick off an initial extraction so the
          // panel shows server-derived rows instead of the local mock.
          const post = await apiFetch(`/csr/cards/${encodeURIComponent(cardKey)}/parser-rows`, { method: 'POST' });
          if (post.ok && !cancelled) {
            const posted = await post.json();
            extraction = (posted?.extraction as ParserExtraction | null) ?? null;
          }
        }
        if (cancelled) return;
        if (extraction && Array.isArray(extraction.rows)) {
          setParserRows(extraction.rows);
          setExtractionMeta({
            source: extraction.source,
            docName: extraction.doc_name,
            extractedAt: extraction.extracted_at,
          });
        }
      } catch { /* offline — keep per-card local mock */ }
      finally {
        // Open the projection gate even on failure so offline users still
        // see approved-row mirroring against the local mock.
        if (!cancelled) setParserHydratedFor(cardKey);
      }
    })();
    return () => { cancelled = true; };
  }, [card, parserHydratedFor]);

  // User-initiated re-extraction (e.g. after uploading a fresh contract).
  const reRunExtraction = useCallback(async () => {
    if (!card || extracting) return;
    setExtracting(true);
    try {
      const res = await apiFetch(`/csr/cards/${encodeURIComponent(String(card.id))}/parser-rows`, { method: 'POST' });
      if (!res.ok) throw new Error('extract_failed');
      const data = await res.json();
      const extraction = data?.extraction as ParserExtraction | null;
      if (extraction && Array.isArray(extraction.rows)) {
        setParserRows(extraction.rows);
        setExtractionMeta({
          source: extraction.source,
          docName: extraction.doc_name,
          extractedAt: extraction.extracted_at,
        });
        toast.success('Re-extracted parser rows from latest contract.', { icon: '🔁' });
      }
    } catch {
      toast.error("Couldn't re-run extraction. Try again in a moment.");
    } finally {
      setExtracting(false);
    }
  }, [card, extracting]);

  // Whenever the parser decisions/edits change OR a fresh extraction lands,
  // mirror the approved/edited rows into the active-stage tabs so users
  // don't have to manually re-enter deliverables/budget/reports.
  useEffect(() => {
    if (!card) return;
    const cardKey = String(card.id);
    // Both gates are required: state must be hydrated for this card, AND
    // the parser fetch must have settled for this card. Otherwise we could
    // mirror the previous card's rows into this card's tabs.
    if (hydratedForId !== cardKey) return;
    if (parserHydratedFor !== cardKey) return;
    setState(prev => {
      const next = projectParserRowsIntoState(parserRows, prev.parserDecisions, prev.parserEdits, prev);
      // Avoid a no-op state churn that would re-trigger the debounced PUT.
      if (
        next.deliverables === prev.deliverables &&
        next.budget === prev.budget &&
        next.reports === prev.reports
      ) return prev;
      // Cheap deep-equal: if all three arrays serialize to the same JSON,
      // skip the update (projection produces new array refs every call).
      const sameDel = JSON.stringify(next.deliverables) === JSON.stringify(prev.deliverables);
      const sameBud = JSON.stringify(next.budget) === JSON.stringify(prev.budget);
      const sameRep = JSON.stringify(next.reports) === JSON.stringify(prev.reports);
      if (sameDel && sameBud && sameRep) return prev;
      return next;
    });
  }, [parserRows, state.parserDecisions, state.parserEdits, card, hydratedForId, parserHydratedFor]);

  if (!card) {
    return (
      <div className="grant-detail">
        <div className="grant-empty">
          <AlertCircle size={36} />
          <h2>Grant not found</h2>
          <p>This grant may have been removed or is loading. Try the CSR pipeline.</p>
          <div className="grant-empty-actions">
            <button className="btn btn-secondary" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
            <button className="btn btn-primary" onClick={() => navigate('/csr')}>Open CSR Pipeline</button>
          </div>
        </div>
      </div>
    );
  }

  const advance = () => {
    if (stage === 'closed') return;
    // From Active → enter closure mode (UI only); col stays 'live' until checklist complete
    if (baseStage === 'active') {
      setState(s => ({ ...s, closingMode: true }));
      toast.success('Closure checklist started — complete all 6 steps to close.', { icon: '📋' });
      return;
    }
    const next = STAGES[stageIdx + 1].id;
    const newCol = stageToCol(next, card.col);
    updateCSRCard(card.id, { col: newCol });
    toast.success(`Grant moved to ${STAGES[stageIdx + 1].label}`, { icon: '✓' });
  };

  const closeGrant = () => {
    updateCSRCard(card.id, { col: 'closed' });
    setState(s => ({ ...s, closingMode: false, isClosed: true }));
    toast.success('Grant closed and archived.', { icon: '🏁' });
  };

  const cancelClosure = () => {
    setState(s => ({ ...s, closingMode: false }));
    toast('Returned to Active. Checklist progress is saved.', { icon: '↩️' });
  };

  const reviewedCount = parserRows.filter(r => {
    const d = state.parserDecisions[r.id];
    return d === 'approved' || d === 'edited' || d === 'rejected';
  }).length;

  const allClosureDone = CLOSURE_STEPS.every(s => state.closureChecklist[s.id]);

  return (
    <div className="grant-detail">
      {/* ── Breadcrumb / Back ───────────────────────── */}
      <div className="grant-crumb">
        <button className="grant-crumb-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="grant-crumb-trail">
          <button onClick={() => navigate('/funding')} className="grant-crumb-link">Funding</button>
          <span> · </span>
          <button onClick={() => navigate('/csr')} className="grant-crumb-link">CSR Pipeline</button>
          <span> · </span>
          <span className="grant-crumb-current">{card.company}</span>
        </span>
      </div>

      {/* Compliance → grant cascade banner. Renders only when this grant
          has a linked compliance doc that is expiring or already expired. */}
      <div style={{ marginBottom: '0.75rem' }}>
        <AtRiskGrantsBanner grantId={String(card.id)} />
      </div>

      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        className="grant-header"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="grant-header-main">
          <div className="grant-header-eyebrow">{card.agent} · {card.tags?.join(' · ') || 'Grant'}</div>
          <h1 className="grant-title">{card.project}</h1>
          <div className="grant-header-funder">{card.company}</div>
        </div>
        <div className="grant-header-actions">
          {baseStage !== 'closed' && baseStage !== 'awarded' && !state.closingMode && (
            <button className="btn btn-primary" onClick={advance}>
              {baseStage === 'pipeline'  && 'Mark as Applied'}
              {baseStage === 'applied'   && 'Mark as Awarded'}
              {baseStage === 'active'    && 'Begin Closure'}
              <ArrowRight size={14} />
            </button>
          )}
          {baseStage === 'active' && state.closingMode && (
            <button className="btn btn-secondary" onClick={cancelClosure}>
              <ArrowLeft size={14} /> Back to Active
            </button>
          )}
          {baseStage === 'closed' && (
            <span className="grant-closed-pill"><Award size={14} /> Closed</span>
          )}
          {/* Tiny sync indicator so users know their edits are being shared,
              not just stashed in this browser. */}
          {syncStatus === 'saving' && (
            <span className="grant-sync-chip" title="Saving to server…"><Clock size={12} /> Saving…</span>
          )}
          {syncStatus === 'saved' && (
            <span className="grant-sync-chip grant-sync-chip--ok" title="Synced to server"><Check size={12} /> Synced</span>
          )}
          {syncStatus === 'error' && (
            <span className="grant-sync-chip grant-sync-chip--err" title="Server unreachable — saved in this browser only"><AlertCircle size={12} /> Local only</span>
          )}
        </div>
      </motion.div>

      {/* ── Stage stepper ───────────────────────────── */}
      <div className="grant-stepper">
        {STAGES.map((s, i) => {
          const cls = i < stageIdx ? 'done' : i === stageIdx ? 'current' : 'todo';
          return (
            <React.Fragment key={s.id}>
              <div className={`grant-step grant-step--${cls}`}>
                <div className="grant-step-dot">
                  {i < stageIdx ? <Check size={13} /> : i + 1}
                </div>
                <span className="grant-step-label">{s.label}</span>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`grant-step-bar ${i < stageIdx ? 'grant-step-bar--done' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Summary strip ───────────────────────────── */}
      <div className="grant-summary-strip">
        <div className="grant-summary-cell">
          <span className="grant-summary-key">Funder</span>
          <span className="grant-summary-value">{card.company}</span>
        </div>
        <div className="grant-summary-cell">
          <span className="grant-summary-key">Amount</span>
          <span className="grant-summary-value">{fmtINR(card.amount || 0)}</span>
        </div>
        <div className="grant-summary-cell">
          <span className="grant-summary-key">Owner</span>
          <span className="grant-summary-value">{card.agent}</span>
        </div>
        <div className="grant-summary-cell">
          <span className="grant-summary-key">Last touch</span>
          <span className="grant-summary-value">{card.date || '—'}</span>
        </div>
        {(stage === 'active' || stage === 'closed') && (
          <div className="grant-summary-cell">
            <span className="grant-summary-key">Next report</span>
            <span className="grant-summary-value">{fmtDate(state.nextReportDue)}</span>
          </div>
        )}
      </div>

      {/* Programme ↔ grant live link — surfaces every programme this
          grant funds with live beneficiary count, service-log count
          for the period, and report-readiness. */}
      <GrantProgramsPanel grantId={String(card.id)} />

      {/* Open tasks for this grant — drives the same Complete / Snooze /
          Dismiss controls as the Tasks page, scoped to this record. */}
      <div style={{ marginTop: '0.75rem' }}>
        <RecordTasksPanel
          entityType="grant"
          entityId={String(card.id)}
          entityLabel={card.project || card.company}
        />
      </div>

      {/* ── Stage panels ────────────────────────────── */}

      {stage === 'pipeline' && (
        <motion.div className="grant-panel" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <h3 className="grant-panel-title">Pipeline notes</h3>
          <p className="grant-panel-help">
            Capture the funder relationship, decision-makers, and any signal you've received so far.
          </p>
          <textarea
            className="grant-textarea"
            rows={6}
            value={state.notes}
            onChange={e => setState(s => ({ ...s, notes: e.target.value }))}
            placeholder={`Notes for ${card.company}…`}
          />
          <div className="grant-form-row">
            <label className="grant-label">
              Expected decision date
              <input
                type="date"
                className="grant-input"
                value={state.decisionDate}
                onChange={e => setState(s => ({ ...s, decisionDate: e.target.value }))}
              />
            </label>
          </div>
        </motion.div>
      )}

      {stage === 'applied' && (() => {
        const days = Math.ceil((new Date(state.decisionDate).getTime() - Date.now()) / 86400000);
        const tone: 'overdue' | 'warn' | 'ok' = days < 0 ? 'overdue' : days <= 7 ? 'warn' : 'ok';
        return (
          <motion.div className="grant-panel" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
            <h3 className="grant-panel-title">Application submitted — awaiting decision</h3>
            <div className={`grant-countdown grant-countdown--${tone}`}>
              <Clock size={20} />
              <div>
                <div className="grant-countdown-num">
                  {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d to go`}
                </div>
                <div className="grant-countdown-sub">
                  Expected decision {new Date(state.decisionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>
            </div>
            <div className="grant-form-row">
              <label className="grant-label">
                Next follow-up
                <input
                  type="date"
                  className="grant-input"
                  value={state.followUpDate}
                  onChange={e => setState(s => ({ ...s, followUpDate: e.target.value }))}
                />
              </label>
              <label className="grant-label">
                Decision date (update if it slips)
                <input
                  type="date"
                  className="grant-input"
                  value={state.decisionDate}
                  onChange={e => setState(s => ({ ...s, decisionDate: e.target.value }))}
                />
              </label>
            </div>
          </motion.div>
        );
      })()}

      {stage === 'awarded' && (
        <motion.div className="grant-panel" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <div className="grant-parser-header">
            <div className="grant-parser-icon"><Sparkles size={16} /></div>
            <div>
              <h3 className="grant-panel-title">Grant Parser preview</h3>
              <p className="grant-panel-help">
                Extracted from the signed contract PDF. Review each item — Approve, Edit, or Reject — before activating the grant.
              </p>
            </div>
            <span className="grant-parser-progress">{reviewedCount} of {parserRows.length} reviewed</span>
          </div>

          {/* Source + re-run controls. Tiny chip lets the user see whether
              the rows came from the LLM, the heuristic fallback, or the
              local mock (offline), and re-run after uploading a contract. */}
          <div className="grant-parser-meta">
            <span className={`grant-parser-source grant-parser-source--${extractionMeta?.source ?? 'local'}`}>
              {extractionMeta?.source === 'llm'       && 'AI extraction'}
              {extractionMeta?.source === 'heuristic' && 'Heuristic extraction'}
              {extractionMeta?.source === 'mock'      && 'Demo extraction'}
              {!extractionMeta                         && 'Local preview'}
              {extractionMeta?.docName && <> · from <strong>{extractionMeta.docName}</strong></>}
            </span>
            <button
              type="button"
              className="btn btn-secondary grant-parser-rerun"
              onClick={reRunExtraction}
              disabled={extracting}
              title="Re-run extraction over the latest uploaded MoU/contract"
            >
              {extracting ? <><Clock size={12} /> Extracting…</> : <><Sparkles size={12} /> Re-run extraction</>}
            </button>
          </div>

          {(['deadline', 'deliverable', 'budget', 'condition'] as const).map(group => {
            const rows = parserRows.filter(r => r.type === group);
            const labelMap: Record<typeof group, string> = {
              deadline:    'Deadlines',
              deliverable: 'Deliverables',
              budget:      'Budget heads',
              condition:   'Compliance conditions',
            };
            return (
              <div key={group} className="grant-parser-group">
                <div className="grant-parser-group-title">{labelMap[group]} ({rows.length})</div>
                {rows.map(row => {
                  const decision = state.parserDecisions[row.id] || 'pending';
                  const tone = row.confidence >= 0.9 ? 'high' : row.confidence >= 0.8 ? 'med' : 'low';
                  const editing = editingRow === row.id;
                  const setDecision = (d: GrantState['parserDecisions'][string]) =>
                    setState(s => ({ ...s, parserDecisions: { ...s.parserDecisions, [row.id]: d } }));
                  return (
                    <div key={row.id} className={`grant-parser-row grant-parser-row--${decision}`}>
                      <div className="grant-parser-row-main">
                        <div className="grant-parser-row-label">{row.label}</div>
                        {editing ? (
                          <input
                            className="grant-input"
                            value={state.parserEdits[row.id] ?? row.detail}
                            onChange={e => setState(s => ({ ...s, parserEdits: { ...s.parserEdits, [row.id]: e.target.value } }))}
                            onBlur={() => { setEditingRow(null); setDecision('edited'); }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { setEditingRow(null); setDecision('edited'); }
                              if (e.key === 'Escape') setEditingRow(null);
                            }}
                            autoFocus
                          />
                        ) : (
                          <div className="grant-parser-row-detail">{state.parserEdits[row.id] ?? row.detail}</div>
                        )}
                      </div>
                      <span className={`grant-confidence-chip grant-confidence-chip--${tone}`}>
                        {Math.round(row.confidence * 100)}%
                      </span>
                      <div className="grant-parser-actions">
                        {decision !== 'pending' && (
                          <span className={`grant-parser-status grant-parser-status--${decision}`}>
                            {decision === 'approved' && <><CheckCircle2 size={12} /> Approved</>}
                            {decision === 'rejected' && <><X size={12} /> Rejected</>}
                            {decision === 'edited' && <><Edit size={12} /> Edited</>}
                          </span>
                        )}
                        <button title="Approve" className="grant-parser-btn ok" onClick={() => setDecision('approved')}><Check size={13} /></button>
                        <button title="Edit"    className="grant-parser-btn edit" onClick={() => setEditingRow(row.id)}><Edit size={13} /></button>
                        <button title="Reject"  className="grant-parser-btn bad" onClick={() => setDecision('rejected')}><X size={13} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="grant-parser-footer">
            <span className="grant-parser-foot-note">
              <ShieldCheck size={13} /> Finance review · Approve all critical items, then activate to begin reminders.
            </span>
            <button className="btn btn-primary" onClick={advance}>Activate grant <ArrowRight size={14} /></button>
          </div>
        </motion.div>
      )}

      {stage === 'active' && (
        <motion.div className="grant-panel" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <GrantTrancheCard grantId={String(card.id)} />
          <GrantBudgetHeadsPanel grantId={String(card.id)} grantTotal={Number(card.amount) || 0} />
          <div className="grant-subtabs" role="tablist">
            <button role="tab" className={`grant-subtab ${activeActiveTab === 'deliverables' ? 'active' : ''}`} onClick={() => setActiveActiveTab('deliverables')}>
              <Target size={13} /> Deliverables
            </button>
            <button role="tab" className={`grant-subtab ${activeActiveTab === 'budget' ? 'active' : ''}`} onClick={() => setActiveActiveTab('budget')}>
              <Wallet size={13} /> Budget Utilization
            </button>
            <button role="tab" className={`grant-subtab ${activeActiveTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveActiveTab('reports')}>
              <FileText size={13} /> Reports
            </button>
            <button role="tab" className={`grant-subtab ${activeActiveTab === 'cascade' ? 'active' : ''}`} onClick={() => setActiveActiveTab('cascade')}>
              <BellRing size={13} /> Reminder cascade
            </button>
          </div>

          {activeActiveTab === 'deliverables' && (
            <div className="grant-deliverables">
              {state.deliverables.map(d => (
                <div key={d.id} className="grant-deliverable">
                  <div className="grant-deliverable-head">
                    <input
                      type="checkbox"
                      checked={d.progress >= 100}
                      onChange={e => setState(s => ({
                        ...s,
                        deliverables: s.deliverables.map(x =>
                          x.id === d.id
                            ? { ...x, progress: e.target.checked ? 100 : Math.min(99, x.progress) }
                            : x
                        ),
                      }))}
                    />
                    <div className="grant-deliverable-title">{d.title}</div>
                    <span className="grant-deliverable-due">Due {fmtDate(d.due)}</span>
                  </div>
                  <div className="grant-progress-row">
                    <div className="grant-progress-track">
                      <div className="grant-progress-fill" style={{ width: `${d.progress}%` }} />
                    </div>
                    <input
                      type="number"
                      className="grant-progress-num"
                      value={d.progress}
                      min={0}
                      max={100}
                      onChange={e => {
                        const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                        setState(s => ({ ...s, deliverables: s.deliverables.map(x => x.id === d.id ? { ...x, progress: v } : x) }));
                      }}
                    />
                    <span className="grant-progress-suffix">%</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeActiveTab === 'budget' && (() => {
            // Source-of-truth: real budget heads + tagged Finance transactions.
            // Falls back to the deterministic mock only when the user hasn't
            // configured any heads for this grant yet (so demo + early-onboarding
            // grants still show something).
            const live = selectGrantUtilisation(
              String(card.id),
              grantBudgetHeads,
              journalEntries,
            );
            const useLive = live.rows.length > 0;
            const totalAlloc = useLive ? live.totalAllocated : state.budget.reduce((s, b) => s + b.allocated, 0);
            const totalSpent = useLive ? live.totalSpent      : state.budget.reduce((s, b) => s + b.spent, 0);
            const utilPct    = totalAlloc > 0 ? Math.round((totalSpent/totalAlloc)*100) : 0;
            return (
              <div className="grant-budget">
                <div className="grant-budget-summary">
                  <span className="grant-budget-summary-cell">
                    <span className="grant-summary-key">Allocated</span>
                    <span className="grant-summary-value">{fmtINR(totalAlloc)}</span>
                  </span>
                  <span className="grant-budget-summary-cell">
                    <span className="grant-summary-key">Spent {useLive ? '(tagged)' : '(mock)'}</span>
                    <span className="grant-summary-value">{fmtINR(totalSpent)}</span>
                  </span>
                  <span className="grant-budget-summary-cell">
                    <span className="grant-summary-key">Utilisation</span>
                    <span className="grant-summary-value">{utilPct}%</span>
                  </span>
                  <button className="btn btn-secondary" onClick={() => navigate('/finance')}>
                    {useLive ? 'Tag more in Finance →' : 'Open in Finance →'}
                  </button>
                </div>
                {!useLive && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', marginBottom: '0.5rem' }}>
                    Showing the mock budget breakdown. Add real budget heads above and tag transactions in Finance to see live utilisation.
                  </div>
                )}
                {(useLive ? live.rows : state.budget.map(b => ({
                  headId: b.id, label: b.head, allocated: b.allocated, spent: b.spent,
                  utilisationPct: b.allocated > 0 ? Math.round((b.spent / b.allocated) * 100) : 0,
                  remaining: b.allocated - b.spent,
                }))).map(r => {
                  const pct = r.utilisationPct;
                  const tone = pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : 'ok';
                  return (
                    <div key={r.headId} className="grant-budget-row">
                      <div className="grant-budget-head">{r.label}</div>
                      <div className={`grant-progress-track grant-progress-track--${tone}`}>
                        <div className="grant-progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <div className="grant-budget-num">
                        {fmtINR(r.spent)} / {fmtINR(r.allocated)} · {pct}%
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {activeActiveTab === 'reports' && (
            <div className="grant-reports">
              {state.reports.map(r => {
                const days = Math.ceil((new Date(r.due).getTime() - Date.now()) / 86400000);
                const dueLabel =
                  r.status === 'submitted' ? 'submitted'
                  : days < 0 ? `${Math.abs(days)}d overdue`
                  : `due in ${days}d`;
                return (
                  <div key={r.id} className="grant-report">
                    <div className="grant-report-title">{r.title}</div>
                    <div className={`grant-report-due ${days < 0 && r.status !== 'submitted' ? 'grant-report-due--late' : ''}`}>{dueLabel}</div>
                    <select
                      className="grant-input grant-input--inline"
                      value={r.status}
                      onChange={e => setState(s => ({ ...s, reports: s.reports.map(x => x.id === r.id ? { ...x, status: e.target.value as GrantState['reports'][number]['status'] } : x) }))}
                    >
                      <option value="draft">Draft</option>
                      <option value="in_review">In Review</option>
                      <option value="submitted">Submitted</option>
                    </select>
                    <span className={`grant-report-chip grant-report-chip--${r.status}`}>
                      {r.status === 'submitted' ? 'Submitted' : r.status === 'in_review' ? 'In Review' : 'Draft'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {activeActiveTab === 'cascade' && (() => {
            const due = new Date(state.nextReportDue);
            const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
            const markers = [
              { id: 'T-30', day: 30, label: 'T-30 · Soft reminder',           tone: 'ok'   as const },
              { id: 'T-14', day: 14, label: 'T-14 · Programme team nudge',    tone: 'warn' as const },
              { id: 'T-7',  day: 7,  label: 'T-7 · ED escalation (HITL)',     tone: 'crit' as const },
              { id: 'T-0',  day: 0,  label: 'T-0 · Report due',                tone: 'crit' as const },
            ];
            const currentIdx = (() => {
              for (let i = 0; i < markers.length; i++) if (days >= markers[i].day) return i;
              return markers.length - 1;
            })();
            return (
              <div className="grant-cascade">
                <div className="grant-cascade-head">
                  <BellRing size={16} />
                  <div>
                    <div className="grant-cascade-title">
                      Next report {days < 0 ? `was due ${Math.abs(days)}d ago` : `due in ${days}d`}
                    </div>
                    <div className="grant-cascade-sub">
                      {due.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      {' — '}
                      {state.reports.find(r => r.status !== 'submitted')?.title || 'Quarterly report'}
                    </div>
                  </div>
                  <label className="grant-label grant-cascade-edit">
                    Update due date
                    <input
                      type="date"
                      className="grant-input"
                      value={state.nextReportDue}
                      onChange={e => setState(s => ({ ...s, nextReportDue: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="grant-cascade-track">
                  {markers.map((m, i) => {
                    const passed = days <= m.day;
                    const isCurrent = i === currentIdx;
                    return (
                      <div
                        key={m.id}
                        className={`grant-cascade-marker grant-cascade-marker--${m.tone} ${passed ? 'passed' : ''} ${isCurrent ? 'current' : ''}`}
                      >
                        <div className="grant-cascade-dot">{m.id}</div>
                        <div className="grant-cascade-label">{m.label}</div>
                        {isCurrent && <div className="grant-cascade-badge">YOU ARE HERE</div>}
                      </div>
                    );
                  })}
                </div>
                {days <= 7 && days >= -3 && (
                  <div className="grant-cascade-alert">
                    <AlertTriangle size={16} />
                    T-7 fired — this grant is now surfaced as an urgent item on the ED's Today screen for human-in-the-loop sign-off.
                  </div>
                )}
              </div>
            );
          })()}
        </motion.div>
      )}

      {stage === 'closed' && (
        <motion.div className="grant-panel" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <h3 className="grant-panel-title">Grant Closure Checklist</h3>
          <p className="grant-panel-help">
            Each step must be completed in order. The ED's sign-off is the final gate that unlocks the closure summary.
          </p>
          <ol className="grant-closure-list">
            {CLOSURE_STEPS.map((step, i) => {
              const prevDone = i === 0 || !!state.closureChecklist[CLOSURE_STEPS[i - 1].id];
              const done = !!state.closureChecklist[step.id];
              return (
                <li key={step.id} className={`grant-closure-item ${done ? 'done' : ''} ${!prevDone ? 'locked' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={!prevDone}
                    checked={done}
                    onChange={e => setState(s => ({ ...s, closureChecklist: { ...s.closureChecklist, [step.id]: e.target.checked } }))}
                  />
                  <div className="grant-closure-text">
                    <div className="grant-closure-label">{i + 1}. {step.label}</div>
                    <div className="grant-closure-help">{step.help}</div>
                  </div>
                  {done && <CheckCircle2 size={16} className="grant-closure-tick" />}
                </li>
              );
            })}
          </ol>

          {(() => {
            const totalSpent = state.budget.reduce((s, b) => s + b.spent, 0);
            const totalAlloc = state.budget.reduce((s, b) => s + b.allocated, 0);
            const utilPct = totalAlloc > 0 ? Math.round((totalSpent / totalAlloc) * 100) : 0;
            const renewal: 'high' | 'medium' | 'low' =
              utilPct >= 85 && utilPct <= 100 ? 'high' :
              utilPct >= 70 ? 'medium' : 'low';
            const renewalLabel = renewal === 'high' ? 'High likelihood' : renewal === 'medium' ? 'Medium likelihood' : 'Low likelihood';
            return (
              <div className={`grant-closure-summary ${allClosureDone ? 'unlocked' : ''}`}>
                <div className="grant-closure-summary-head">
                  <Award size={18} />
                  <h4>Closure summary</h4>
                  <span className={`grant-renewal-chip grant-renewal-chip--${renewal}`}>
                    Renewal · {renewalLabel}
                  </span>
                </div>
                <div className="grant-closure-summary-grid">
                  <div className="grant-closure-summary-cell">
                    <span className="grant-summary-key">Total spent</span>
                    <span className="grant-summary-value">{fmtINR(totalSpent)}</span>
                  </div>
                  <div className="grant-closure-summary-cell">
                    <span className="grant-summary-key">Beneficiaries served</span>
                    <span className="grant-summary-value">{state.closureSummary.beneficiariesServed.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="grant-closure-summary-cell">
                    <span className="grant-summary-key">Utilisation</span>
                    <span className="grant-summary-value">{utilPct}%</span>
                  </div>
                  <div className="grant-closure-summary-cell">
                    <span className="grant-summary-key">Deliverables</span>
                    <span className="grant-summary-value">
                      {state.deliverables.filter(d => d.progress >= 100).length}/{state.deliverables.length}
                    </span>
                  </div>
                </div>
                <div className="grant-outcomes">
                  <div className="grant-summary-key">Outcomes achieved</div>
                  <ul>
                    {state.closureSummary.outcomes.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
                {!allClosureDone && (
                  <div className="grant-closure-locked-msg">
                    <AlertCircle size={14} /> Complete the checklist to release this summary to the funder.
                  </div>
                )}
                {allClosureDone && !state.isClosed && (
                  <button className="btn btn-primary" onClick={closeGrant} style={{ marginTop: '0.75rem' }}>
                    Mark grant Closed <Award size={14} />
                  </button>
                )}
              </div>
            );
          })()}
        </motion.div>
      )}

      {/* If in 'live' col but checklist began, allow user to advance to closure */}
      {stage === 'active' && allClosureDone === false && (
        <div className="grant-panel grant-panel--ghost">
          <div className="grant-panel-help">
            Project wrapping up? Click "Begin Closure" above to start the closure checklist.
          </div>
        </div>
      )}
    </div>
  );
};

export default GrantDetail;
