import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IndianRupee, RefreshCw, FileText, Download, AlertCircle, ArrowUpRight, Plus, X, Bot, Globe, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import './Finance.css';
import { apiFetch } from '../../api/client';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import { useStore } from '../../store/useStore';
import { resolvePersistedJournalEntryId } from '../../utils/journalEntryId';

const Finance: React.FC = () => {
  const grantBudgetHeads = useStore(s => s.grantBudgetHeads);
  const journalEntries   = useStore(s => s.journalEntries);
  const upsertJournalEntry      = useStore(s => s.upsertJournalEntry);
  const setJournalEntryGrantTag = useStore(s => s.setJournalEntryGrantTag);
  const csrCards         = useStore(s => s.csrCards);
  const donors           = useStore(s => s.donors);
  const ngoDetails       = useStore(s => s.ngoDetails);
  const beneficiaries    = useStore(s => s.beneficiaries);
  const customPrograms   = useStore(s => s.customPrograms);

  // All distinct programme names from beneficiaries + custom programmes,
  // de-duped. Used for the programme dropdown in the journal entry form.
  const allProgrammes = useMemo(() => {
    const fromBens = beneficiaries.map(b => b.program).filter(Boolean);
    const merged = Array.from(new Set([...fromBens, ...customPrograms])).sort();
    return merged;
  }, [beneficiaries, customPrograms]);
  const [grants, setGrants] = useState<any[]>([]);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState<{ name: string; total: number; spent: number; status: string }>({
    name: '',
    total: 1000000,
    spent: 0,
    status: 'On Track',
  });
  const [entry, setEntry] = useState<{
    description: string; amount: number; type: 'Expense' | 'Income' | 'Transfer'; fund: string;
    grantId: string; budgetHeadId: string; donorId: string; programmeId: string;
  }>({ description: '', amount: 1000, type: 'Expense', fund: 'General', grantId: '', budgetHeadId: '', donorId: '', programmeId: '' });
  const [donorSearch, setDonorSearch] = useState('');
  const [classification, setClassification] = useState<{category: string, confidence: number} | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [grantsLoading, setGrantsLoading] = useState(false);
  // ngoName is now read from the Zustand ngoDetails slice (single source of truth).
  // The local useState fallback is kept only for the rare moment before store hydrates.
  const ngoName = ngoDetails.name || 'GoodJobs NGO';
  const [aaBannerDismissed, setAaBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem('gj_finance_aa_banner_dismiss') === '1';
    } catch {
      return false;
    }
  });
  const [exceptionMode, setExceptionMode] = useState(false);
  const [minConf, setMinConf] = useState(0.85);
  const [exTx, setExTx] = useState<any[]>([]);
  const [exLoading, setExLoading] = useState(false);
  const [classifiedStream, setClassifiedStream] = useState<any[]>([]);
  const [streamExceptionOnly, setStreamExceptionOnly] = useState(false);
  // Inline FCRA reclassification — per-row pending category selection + busy lock.
  const [exPending, setExPending] = useState<Record<string, string>>({});
  const [exBusy, setExBusy] = useState<Record<string, boolean>>({});
  const [exSentToBk, setExSentToBk] = useState<Record<string, boolean>>({});

  const FCRA_CATEGORIES = ['FCRA', 'Domestic', 'CSR', 'Grant', 'Donation', 'Other'];

  const loadGrants = async () => {
    setGrantsLoading(true);
    try {
      const res = await apiFetch('/finance/grants');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.grants)) setGrants(data.grants);
      }
    } catch {
      // ignore (demo fallback)
    } finally {
      setGrantsLoading(false);
    }
  };

  const loadExceptionTx = useCallback(async () => {
    setExLoading(true);
    try {
      const res = await apiFetch(
        `/finance/transactions?classify=true&exception_only=true&min_confidence=${encodeURIComponent(String(minConf))}`
      );
      if (!res.ok) throw new Error('tx');
      const data = await res.json();
      setExTx(Array.isArray(data.transactions) ? data.transactions : []);
    } catch {
      toast.error('Failed to load low-confidence transactions.');
      setExTx([]);
    } finally {
      setExLoading(false);
    }
  }, [minConf]);

  useEffect(() => {
    loadGrants();
    (async () => {
      try {
        const txRes = await apiFetch('/finance/transactions?classify=true');
        if (txRes.ok) {
          const txData = await txRes.json();
          const list = Array.isArray(txData.transactions) ? txData.transactions : [];
          setClassifiedStream(list.slice(0, 400));
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleClassifiedStream = useMemo(() => {
    if (!streamExceptionOnly) return classifiedStream;
    return classifiedStream.filter(t => (Number(t.agent_confidence) || 0) < 0.9);
  }, [classifiedStream, streamExceptionOnly]);

  const classifiedScrollRef = useRef<HTMLDivElement>(null);
  const classifiedVirtualizer = useVirtualizer({
    count: visibleClassifiedStream.length,
    getScrollElement: () => classifiedScrollRef.current,
    estimateSize: () => 46,
    overscan: 14,
  });

  const exScrollRef = useRef<HTMLDivElement>(null);
  const exVirtualizer = useVirtualizer({
    count: exTx.length,
    getScrollElement: () => exScrollRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const grantsScrollRef = useRef<HTMLDivElement>(null);
  const grantsVirtualizer = useVirtualizer({
    count: grants.length,
    getScrollElement: () => grantsScrollRef.current,
    estimateSize: () => 100,
    overscan: 8,
  });

  useEffect(() => {
    if (exceptionMode) loadExceptionTx();
  }, [exceptionMode, loadExceptionTx]);

  // Approve a low-confidence transaction with the operator's chosen FCRA category.
  // Tries the dedicated classify endpoint first, then falls back to a journal-entry
  // memo so the action is auditable even when the classify route isn't deployed.
  const approveExceptionRow = async (t: any) => {
    const id = String(t.id ?? '');
    if (!id) return;
    const category = exPending[id] || t.agent_category || 'Domestic';
    setExBusy(prev => ({ ...prev, [id]: true }));
    try {
      let ok = false;
      try {
        const r = await apiFetch(`/finance/transactions/${encodeURIComponent(id)}/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, approved_by: 'operator' }),
        });
        ok = r.ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        // Fallback: write an audit journal entry so the approval still lands somewhere.
        try {
          const r2 = await apiFetch('/finance/journal-entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              description: `FCRA reclassify TX ${id}: ${t.donorName || 'Donor'} → ${category}`,
              amount: Number(t.amount) || 0,
              entry_type: 'Reclassification',
              fund: category,
            }),
          });
          ok = r2.ok;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        toast.error('Failed to approve classification.');
        return;
      }
      // Optimistically remove from both queues.
      setExTx(prev => prev.filter(row => String(row.id) !== id));
      setClassifiedStream(prev => prev.map(row => (
        String(row.id) === id ? { ...row, agent_category: category, agent_confidence: 1 } : row
      )));
      setExPending(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      toast.success(`Classified as ${category}.`);
    } finally {
      setExBusy(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    }
  };

  // Send a low-confidence row to the bookkeeper instead of approving inline.
  // Posts a journal-entry-style memo so the action shows up in the audit log,
  // marks the row as "Sent" (greys it out) but leaves it in the queue so the
  // operator can still approve once the bookkeeper replies.
  const sendExceptionToBookkeeper = async (t: any) => {
    const id = String(t.id ?? '');
    if (!id) return;
    const proposed = exPending[id] || t.agent_category || 'Domestic';
    setExBusy(prev => ({ ...prev, [id]: true }));
    try {
      let ok = false;
      try {
        const r = await apiFetch('/finance/journal-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: `Bookkeeper review requested — TX ${id}: ${t.donorName || 'Donor'} (proposed ${proposed})`,
            amount: Number(t.amount) || 0,
            entry_type: 'Bookkeeper Review',
            fund: proposed,
          }),
        });
        ok = r.ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        toast.error('Could not notify bookkeeper. Try again.');
        return;
      }
      setExSentToBk(prev => ({ ...prev, [id]: true }));
      toast.success(`Sent to bookkeeper for review (proposed ${proposed}).`);
    } finally {
      setExBusy(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    }
  };

  const fcraGrants = grants.filter((g: any) => (g?.name || '').toString().toLowerCase().includes('fcra'));
  const fcraTotal = fcraGrants.reduce((s: number, g: any) => s + (Number(g.total) || 0), 0);
  const fcraAdminSpent = fcraGrants.reduce((s: number, g: any) => s + (Number(g.spent) || 0), 0);
  const fcraAdminLimit = fcraTotal * 0.2;
  const fcraAdminPercent = fcraAdminLimit > 0 ? (fcraAdminSpent / fcraAdminLimit) * 100 : 0;
  const fcraRealPct = fcraTotal > 0 ? (fcraAdminSpent / fcraTotal) * 100 : 0;
  const fcraStatus = (() => {
    if (fcraRealPct >= 20) return { key: 'critical', label: 'CRITICAL — Cap Breached', color: '#DC2626', bg: '#fee2e2' };
    if (fcraRealPct >= 16) return { key: 'warning',  label: 'WARNING — Near Cap',      color: '#EA580C', bg: '#fff7ed' };
    if (fcraRealPct >= 12) return { key: 'caution',  label: 'CAUTION',                 color: '#D97706', bg: '#fef3c7' };
    return                        { key: 'safe',     label: 'SAFE',                    color: '#16A34A', bg: '#f0fdf4' };
  })();
  const isFcraWarning = fcraStatus.key === 'warning' || fcraStatus.key === 'critical';

  const handleJournalEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    // Frontend-first OS: best-effort POST to the backend; if it returns a
    // persisted id we tag against THAT id (no synthetic ids in LS). When
    // the backend isn't available, we fall back to a clearly-local id
    // (prefixed with `local-`) so the entry isn't lost and the rest of the
    // app can tell drafts apart from server-resident entries.
    let payload: unknown = null;
    try {
      const res = await apiFetch('/finance/journal-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: entry.description,
          amount: Number(entry.amount),
          entry_type: entry.type,
          fund: entry.fund,
          // Forward the tag so the server can store it too — store will
          // reflect whatever id the server hands back.
          grant_id: entry.grantId || null,
          budget_head_id: entry.budgetHeadId || null,
          // Cross-module joins (Data Foundation).
          donor_id: entry.donorId || null,
          programme_id: entry.programmeId || null,
        }),
      });
      if (res.ok) {
        try { payload = await res.json(); } catch { /* empty body */ }
      }
    } catch { /* offline/no backend */ }

    const { source, id } = resolvePersistedJournalEntryId(payload);
    const tag = entry.grantId && entry.budgetHeadId
      ? { grantId: entry.grantId, budgetHeadId: entry.budgetHeadId }
      : undefined;
    upsertJournalEntry({
      id,
      date: new Date().toISOString().slice(0, 10),
      amount: Number(entry.amount) || 0,
      description: entry.description,
      fund: entry.fund,
      entryType: entry.type,
      grantTag: tag,
      // Cross-module joins: link this entry to the CRM donor and the programme.
      donorId:    entry.donorId    || undefined,
      programmeId: entry.programmeId || undefined,
    });
    const tagSuffix = tag ? ' · tagged' : '';
    if (source === 'backend') {
      toast.success(`Journal entry recorded: ₹${Number(entry.amount).toLocaleString()} (${entry.type})${tagSuffix}.`);
    } else {
      toast.success(`Saved locally: ₹${Number(entry.amount).toLocaleString()} (${entry.type})${tagSuffix}. Will sync when the server is reachable.`);
    }
    setShowEntryModal(false);
    setEntry({ description: '', amount: 1000, type: 'Expense', fund: 'General', grantId: '', budgetHeadId: '', donorId: '', programmeId: '' });
    setDonorSearch('');
  };

  const handleTallySync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch('/finance/tally/sync', { method: 'POST' });
      if (!res.ok) throw new Error('sync');
      const data = await res.json();
      setLastSyncedAt(data.synced_at || null);
      toast.success(`Tally Prime sync complete! ${data.exported_vouchers || 0} vouchers exported.`, { icon: 'T' });
    } catch {
      toast.error('Failed to sync with Tally (backend not reachable).');
    } finally {
      setSyncing(false);
    }
  };

  const handleTallyXMLExport = async () => {
    try {
      const txRes = await apiFetch('/finance/transactions');
      if (!txRes.ok) throw new Error('tx');
      const txData = await txRes.json();
      const txs = Array.isArray(txData.transactions) ? txData.transactions : [];

      // Use backend generator so the format stays consistent.
      const res = await apiFetch('/export/tally-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ngo_name: ngoName,
          transactions: txs.slice(0, 200).map((t: any) => ({
            id: t.id,
            date: (t.date || new Date().toISOString().slice(0, 10)),
            amount: Number(t.amount) || 0,
            donor_name: t.donorName || 'Donor',
            method: t.method || 'UPI',
            fund: 'General',
          })),
        }),
      });
      if (!res.ok) {
        toast.error('Failed to export Tally XML.');
        return;
      }
      const xml = await res.text();
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `goodjobs_tally_${new Date().toISOString().split('T')[0]}.xml`;
      a.click();
      toast.success('Tally Prime XML exported from backend.', { duration: 5000, icon: '💾' });
    } catch {
      toast.error('Failed to export Tally XML (backend not reachable).');
    }
  };

  const handleExportReport = () => {
    const csv = ['Grant ID,Name,Total,Spent,Variance,Status',
      ...grants.map(g => `${g.id},${g.name},${g.total},${g.spent},${g.variance},${g.status}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'grant_utilization.csv'; a.click();
    toast.success('Grant utilization report exported!');
  };

  // ── Session 4: per-grant + per-budget-head EXPENSE tagging ──────────────
  // The source of truth for utilisation is `journalEntries` — booked
  // outflows (entryType === 'Expense'). Donor receipts in `transactions`
  // are NOT counted toward grant utilisation.
  const cardLabel = (cid: string | number) => {
    const c = csrCards.find(x => String(x.id) === String(cid));
    return c ? `${c.company} — ${c.project}` : `Grant ${cid}`;
  };
  const headLabel = (hid: string) =>
    grantBudgetHeads.find(h => h.id === hid)?.label ?? hid;

  // Only Expense-type entries are taggable to a grant budget head.
  const expensesOnly = useMemo(
    () => journalEntries
      .filter(e => e.entryType === 'Expense')
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    [journalEntries],
  );

  // ≥ ₹1k untagged expenses — what the audit calls "no idea which grant
  // they belong to". Surface them so the user can clean them up.
  const untaggedSignificant = useMemo(
    () => expensesOnly.filter(e => Math.abs(e.amount) >= 1000 && !e.grantTag),
    [expensesOnly],
  );
  const untaggedTotal = untaggedSignificant.reduce((s, e) => s + Math.abs(e.amount), 0);

  // Per-row inline picker state.
  const [tagDraft, setTagDraft] = useState<Record<string, { grantId: string; budgetHeadId: string }>>({});
  const [showTagSection, setShowTagSection] = useState(true);

  const handleTagSave = (entryId: string) => {
    const draft = tagDraft[entryId];
    if (!draft || !draft.grantId || !draft.budgetHeadId) {
      toast.error('Pick a grant and a budget head first.');
      return;
    }
    setJournalEntryGrantTag(entryId, draft);
    setTagDraft(prev => {
      const n = { ...prev };
      delete n[entryId];
      return n;
    });
    toast.success('Expense tagged.');
  };

  const handleExportByGrant = () => {
    const rows = ['Entry ID,Date,Amount,Description,Fund,Grant,Budget Head'];
    for (const e of expensesOnly) {
      if (!e.grantTag) continue;
      const safe = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      rows.push([
        e.id,
        e.date,
        Math.abs(e.amount),
        safe(e.description),
        safe(e.fund ?? ''),
        safe(cardLabel(e.grantTag.grantId)),
        safe(headLabel(e.grantTag.budgetHeadId)),
      ].join(','));
    }
    if (rows.length === 1) {
      toast.error('No tagged expenses to export yet.');
      return;
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `expenses_by_grant_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    toast.success(`Exported ${rows.length - 1} tagged expenses.`);
  };

  const handleGenerateUC = () => {
    const run = async () => {
      try {
        const res = await apiFetch('/finance/uc.pdf');
        if (!res.ok) throw new Error('uc');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'utilization_certificate_draft.pdf';
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        toast.error('Failed to generate UC (backend not reachable).');
      }
    };
    run();
  };

  const openCreateGrant = () => {
    setEditingGrantId(null);
    setGrantForm({ name: '', total: 1000000, spent: 0, status: 'On Track' });
    setShowGrantModal(true);
  };

  const openEditGrant = (g: any) => {
    setEditingGrantId(g.id);
    setGrantForm({ name: g.name, total: Number(g.total) || 0, spent: Number(g.spent) || 0, status: g.status || 'On Track' });
    setShowGrantModal(true);
  };

  const saveGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: grantForm.name,
        total: Number(grantForm.total),
        spent: Number(grantForm.spent),
        variance: Number(grantForm.total) - Number(grantForm.spent),
        status: grantForm.status,
      };
      const res = await apiFetch(editingGrantId ? `/finance/grants/${encodeURIComponent(editingGrantId)}` : '/finance/grants', {
        method: editingGrantId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save grant');
      toast.success(editingGrantId ? 'Grant updated.' : 'Grant created.');
      setShowGrantModal(false);
      await loadGrants();
    } catch {
      toast.error('Failed to save grant.');
    }
  };

  const deleteGrant = async (id: string) => {
    if (!confirm('Delete this grant?')) return;
    try {
      const res = await apiFetch(`/finance/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      toast.success('Grant deleted.');
      await loadGrants();
    } catch {
      toast.error('Failed to delete grant.');
    }
  };

  return (
    <div className="finance-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Finance & FCRA</h1>
          <p className="page-subtitle">Fund accounting, automated compliance, and Tally Prime sync.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" onClick={handleTallyXMLExport}>
            <Download size={16} /> Tally XML Export
          </button>
          <button className="btn btn-secondary" onClick={handleGenerateUC}>
            <FileText size={16} /> Generate UC (CSR-1)
          </button>
          <button className="btn btn-secondary" onClick={handleExportByGrant} title="Export every tagged expense with its grant + budget head">
            <Download size={16} /> Expenses by grant
          </button>
          <button className="btn btn-primary" onClick={() => setShowEntryModal(true)}>
            <Plus size={16} /> New Journal Entry
          </button>
        </div>
      </div>

      {/* Tally Sync Banner */}
      <div className="tally-sync-banner">
        <div className="tally-info">
          <div className="tally-logo">T</div>
          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>Tally Prime Sync Active</h3>
            <div className="sync-status">
              <div className="sync-dot"></div>
              {syncing ? 'Syncing...' : `Last synced: ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Not yet'} • Tap Force Sync`}
            </div>
          </div>
        </div>
        <button className="btn btn-secondary" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }} onClick={handleTallySync} disabled={syncing}>
          <RefreshCw size={16} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Syncing...' : 'Force Sync'}
        </button>
      </div>

      {/* Bank Auto-Ingestion (Account Aggregator) */}
      {!aaBannerDismissed && (
        <div className="card" style={{ marginBottom: '2rem', border: '1px solid #e2e8f0', background: 'linear-gradient(to right, #f8fafc, #ffffff)', position: 'relative' }}>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              try {
                localStorage.setItem('gj_finance_aa_banner_dismiss', '1');
              } catch {
                // ignore
              }
              setAaBannerDismissed(true);
            }}
            style={{ position: 'absolute', right: '0.75rem', top: '0.75rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 4 }}
          >
            <X size={18} />
          </button>
          <div style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div className="flex items-center gap-4">
              <div style={{ width: '40px', height: '40px', background: '#3b82f6', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                <Globe size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Bank Auto-Ingestion (AA Framework)</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  One-time consent (~60s) removes manual statement entry. Connect your operating / FCRA account when ready.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div style={{ textAlign: 'right', marginRight: '1rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>Status</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Not configured</div>
              </div>
              <button className="btn btn-secondary" onClick={async () => {
                try {
                  const res = await apiFetch('/finance/aa/consents/refresh', { method: 'POST' });
                  if (!res.ok) throw new Error('aa');
                  toast.success('Consents refreshed.', { icon: '🔐' });
                } catch {
                  toast.error('Failed to refresh consents.');
                }
              }}>
                Manage Consents
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent classification exception queue */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 className="card-title">FCRA classification review</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0.25rem 0 0' }}>
              Surface donations where the agent is unsure (below your confidence threshold).
            </p>
          </div>
          <label className="flex items-center gap-2" style={{ fontSize: '0.875rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={exceptionMode} onChange={e => setExceptionMode(e.target.checked)} />
            Exception queue
          </label>
        </div>
        {exceptionMode && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="flex flex-wrap gap-3 items-center" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                Min confidence (keep below)
                <select
                  className="input-field"
                  style={{ marginLeft: 8, display: 'inline-block', width: 'auto', minWidth: 88, padding: '0.25rem 0.5rem' }}
                  value={minConf}
                  onChange={e => setMinConf(Number(e.target.value))}
                >
                  <option value={0.8}>0.80</option>
                  <option value={0.85}>0.85</option>
                  <option value={0.9}>0.90</option>
                  <option value={0.95}>0.95</option>
                </select>
              </label>
              <button className="btn btn-secondary" type="button" style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }} onClick={() => loadExceptionTx()} disabled={exLoading}>
                {exLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {exLoading && exTx.length === 0 ? (
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>Loading…</div>
            ) : exTx.length === 0 ? (
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>No exceptions for this threshold.</div>
            ) : (
              <div
                ref={exScrollRef}
                className="table-scroll-wrap"
                style={{
                  maxHeight: 'min(55vh, 480px)',
                  overflow: 'auto',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(80px,0.9fr) minmax(64px,0.7fr) minmax(110px,1.1fr) minmax(70px,0.9fr) 52px minmax(110px,1fr) 88px 110px',
                    gap: '0.5rem',
                    padding: '0.6rem 0.75rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    color: 'var(--color-text-tertiary)',
                    borderBottom: '1px solid var(--color-border-light)',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--color-bg-card)',
                    zIndex: 1,
                  }}
                >
                  <span>Donor</span>
                  <span>Amount</span>
                  <span>Campaign</span>
                  <span>Agent</span>
                  <span>Conf.</span>
                  <span>Reclassify</span>
                  <span>Approve</span>
                  <span>Bookkeeper</span>
                </div>
                <div style={{ height: exVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {exVirtualizer.getVirtualItems().map(vr => {
                    const t = exTx[vr.index];
                    return (
                      <div
                        key={t.id}
                        data-index={vr.index}
                        ref={exVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vr.start}px)`,
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(80px,0.9fr) minmax(64px,0.7fr) minmax(110px,1.1fr) minmax(70px,0.9fr) 52px minmax(110px,1fr) 88px 110px',
                            gap: '0.5rem',
                            padding: '0.5rem 0.75rem',
                            alignItems: 'center',
                            fontSize: '0.82rem',
                            borderBottom: '1px solid var(--color-border-light)',
                            opacity: exSentToBk[String(t.id)] ? 0.65 : 1,
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.donorName || '—'}</span>
                          <span>₹{Number(t.amount || 0).toLocaleString()}</span>
                          <span style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.campaignTitle || '—'}</span>
                          <span style={{ fontSize: '0.78rem' }}>{t.agent_category || '—'}</span>
                          <span>{Math.round((Number(t.agent_confidence) || 0) * 100)}%</span>
                          <select
                            aria-label={`Reclassify transaction ${t.id}`}
                            className="input-field"
                            style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem', width: '100%' }}
                            value={exPending[String(t.id)] ?? (t.agent_category || 'Domestic')}
                            onChange={e => setExPending(prev => ({ ...prev, [String(t.id)]: e.target.value }))}
                            disabled={!!exBusy[String(t.id)]}
                          >
                            {FCRA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                            onClick={() => approveExceptionRow(t)}
                            disabled={!!exBusy[String(t.id)]}
                          >
                            {exBusy[String(t.id)] ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                            onClick={() => sendExceptionToBookkeeper(t)}
                            disabled={!!exBusy[String(t.id)] || !!exSentToBk[String(t.id)]}
                            title="Send this row to the bookkeeper for a second look"
                          >
                            {exSentToBk[String(t.id)] ? 'Sent ✓' : exBusy[String(t.id)] ? '…' : 'Send to BK'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pre-tagged donation stream — correct rows need no action */}
      {classifiedStream.length > 0 && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <div className="card-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 className="card-title">Donation stream (Finance Agent tag)</h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0.25rem 0 0' }}>
                Each row shows the agent's FCRA-style classification. Skim high-confidence rows; focus corrections below.
              </p>
            </div>
            <label className="flex items-center gap-2" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={streamExceptionOnly}
                onChange={e => setStreamExceptionOnly(e.target.checked)}
              />
              Only &lt;90% confidence
            </label>
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div
              ref={classifiedScrollRef}
              className="table-scroll-wrap"
              style={{
                maxHeight: 'min(65vh, 560px)',
                overflow: 'auto',
                border: '1px solid var(--color-border-light)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(72px,0.95fr) minmax(96px,1.1fr) minmax(72px,0.85fr) minmax(88px,1fr) 52px',
                  gap: '0.5rem',
                  padding: '0.6rem 0.75rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  color: 'var(--color-text-tertiary)',
                  borderBottom: '1px solid var(--color-border-light)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--color-bg-card)',
                  zIndex: 1,
                }}
              >
                <span>Date</span>
                <span>Donor</span>
                <span>Amount</span>
                <span>Tag</span>
                <span>Conf.</span>
              </div>
              {visibleClassifiedStream.length === 0 ? (
                <div style={{ padding: '1rem 0.75rem', fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                  No rows match this filter.
                </div>
              ) : (
                <div style={{ height: classifiedVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {classifiedVirtualizer.getVirtualItems().map(vr => {
                    const t = visibleClassifiedStream[vr.index];
                    const conf = Number(t.agent_confidence) || 0;
                    const high = conf >= 0.9;
                    return (
                      <div
                        key={t.id}
                        data-index={vr.index}
                        ref={classifiedVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vr.start}px)`,
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(72px,0.95fr) minmax(96px,1.1fr) minmax(72px,0.85fr) minmax(88px,1fr) 52px',
                            gap: '0.5rem',
                            padding: '0.45rem 0.75rem',
                            alignItems: 'center',
                            fontSize: '0.82rem',
                            opacity: high ? 0.92 : 1,
                            borderBottom: '1px solid var(--color-border-light)',
                          }}
                        >
                          <span style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{t.date || '—'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.donorName || '—'}</span>
                          <span>₹{Number(t.amount || 0).toLocaleString()}</span>
                          <span>
                            <span className="badge badge-outline" style={{ fontSize: '0.72rem' }}>
                              {t.agent_category || '—'}
                            </span>
                          </span>
                          <span style={{ color: high ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 600 }}>
                            {Math.round(conf * 100)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fund Balances */}
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Fund Balances</h2>
      <div className="finance-grid">
        <div className="finance-card" style={{ gridColumn: 'span 3' }}>
          <div className="fund-label"><span>Balances</span></div>
          <div className="fund-amount">—</div>
          <div className="fund-meta">
            <span style={{ color: 'var(--color-text-tertiary)' }}>Connect bank feeds (AA) to show real-time balances.</span>
          </div>
        </div>
        <div className="finance-card fcra-card fcra-gauge-card" style={{ gridColumn: 'span 3', borderColor: fcraStatus.color + '55', background: fcraStatus.bg }}>
          <div className="fcra-card-header">
            <div className="fund-label" style={{ color: '#7C3AED' }}><span>FCRA Admin Overhead Monitor</span></div>
            <span className="fcra-status-pill" style={{ background: fcraStatus.color }}>
              {fcraStatus.label}
            </span>
          </div>
          <div className="fcra-gauge-body">
            <div className="fcra-gauge-row">
              <div className="fcra-gauge-big-pct" style={{ color: fcraStatus.color }}>
                {fcraTotal > 0 ? `${fcraRealPct.toFixed(1)}%` : '—'}
              </div>
              <div className="fcra-gauge-meta">
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>of total FCRA funds used as admin overhead</div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>Statutory cap under FCRA 2010: 20%</div>
              </div>
            </div>
            <div className="fcra-gauge-bar-wrap">
              <div className="fcra-gauge-track">
                <div
                  className="fcra-gauge-fill"
                  style={{
                    width: `${fcraTotal > 0 ? Math.min((fcraRealPct / 20) * 100, 100) : 0}%`,
                    background: fcraStatus.color,
                    transition: 'width 0.6s ease, background 0.4s ease',
                  }}
                />
                <div className="fcra-gauge-marker" style={{ left: '60%' }} title="Caution threshold: 12%" />
                <div className="fcra-gauge-marker" style={{ left: '80%' }} title="Warning threshold: 16%" />
              </div>
              <div className="fcra-gauge-legend">
                <span style={{ color: '#16A34A' }}>Safe &lt;12%</span>
                <span style={{ color: '#D97706' }}>Caution 12–16%</span>
                <span style={{ color: '#EA580C' }}>Warning 16–20%</span>
                <span style={{ color: '#DC2626' }}>Critical ≥20%</span>
              </div>
            </div>
            {fcraTotal > 0 ? (
              <div className="fcra-gauge-detail">
                <div className="fcra-detail-row">
                  <span>Admin spent</span>
                  <strong>₹{fcraAdminSpent.toLocaleString('en-IN')}</strong>
                </div>
                <div className="fcra-detail-row">
                  <span>Remaining headroom</span>
                  <strong style={{ color: fcraStatus.color }}>
                    ₹{Math.max(0, fcraAdminLimit - fcraAdminSpent).toLocaleString('en-IN')}
                  </strong>
                </div>
                <div className="fcra-detail-row">
                  <span>20% cap (of ₹{fcraTotal.toLocaleString('en-IN')} total FCRA)</span>
                  <strong>₹{fcraAdminLimit.toLocaleString('en-IN')}</strong>
                </div>
              </div>
            ) : (
              <div className="fcra-gauge-empty">Add FCRA-tagged grants above to compute admin overhead in real time.</div>
            )}
          </div>
        </div>
      </div>

      {/* Grant Utilization */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title">Grant Budget & Utilization</h3>
          <div className="flex gap-2">
            <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={openCreateGrant}>
              <Plus size={14} /> Add Grant
            </button>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={loadGrants} disabled={grantsLoading}>
              <RefreshCw size={14} /> {grantsLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={handleExportReport}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div
          ref={grantsScrollRef}
          className="table-scroll-wrap"
          style={{
            maxHeight: 'min(55vh, 520px)',
            overflow: 'auto',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px,1.4fr) minmax(88px,0.9fr) minmax(140px,1.1fr) minmax(72px,0.75fr) minmax(72px,0.75fr) minmax(160px,1.2fr)',
              gap: '0.5rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.68rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: 'var(--color-text-tertiary)',
              borderBottom: '1px solid var(--color-border-light)',
              position: 'sticky',
              top: 0,
              background: 'var(--color-bg-card)',
              zIndex: 1,
            }}
          >
            <span>Grant</span>
            <span>Budget</span>
            <span>Utilization</span>
            <span>Variance</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {grants.length === 0 ? (
            <div style={{ padding: '1.25rem', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>No grants yet.</div>
          ) : (
            <div style={{ height: grantsVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {grantsVirtualizer.getVirtualItems().map(vr => {
                const grant = grants[vr.index];
                const progress = (grant.spent / grant.total) * 100;
                return (
                  <div
                    key={grant.id}
                    data-index={vr.index}
                    ref={grantsVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vr.start}px)`,
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(120px,1.4fr) minmax(88px,0.9fr) minmax(140px,1.1fr) minmax(72px,0.75fr) minmax(72px,0.75fr) minmax(160px,1.2fr)',
                        gap: '0.5rem',
                        padding: '0.55rem 0.75rem',
                        alignItems: 'center',
                        fontSize: '0.82rem',
                        borderBottom: '1px solid var(--color-border-light)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{grant.name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>{grant.id}</div>
                      </div>
                      <span style={{ fontWeight: 600 }}>₹{grant.total.toLocaleString()}</span>
                      <div className="progress-inline" style={{ minWidth: 0 }}>
                        <div className="progress-track">
                          <div
                            className="progress-val"
                            style={{
                              width: `${progress}%`,
                              background: progress > 90 ? 'var(--color-warning)' : 'var(--color-primary)',
                            }}
                          ></div>
                        </div>
                        <span style={{ fontSize: '0.72rem', width: '35px' }}>{Math.round(progress)}%</span>
                      </div>
                      <span
                        className={grant.variance > 0 ? 'variance-positive' : grant.variance < 0 ? 'variance-negative' : ''}
                        style={{ fontSize: '0.78rem' }}
                      >
                        {grant.variance === 0
                          ? '-'
                          : grant.variance > 0
                            ? `+₹${grant.variance.toLocaleString()}`
                            : `-₹${Math.abs(grant.variance).toLocaleString()}`}
                      </span>
                      <span>
                        <span
                          className={`badge ${grant.status === 'On Track' ? 'badge-success' : ''}`}
                          style={
                            grant.status === 'Over Budget'
                              ? { borderColor: 'var(--color-danger)', color: 'var(--color-danger)', border: '1px solid' }
                              : {}
                          }
                        >
                          {grant.status}
                        </span>
                      </span>
                      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                          disabled
                          title="Not available yet"
                        >
                          View P&L
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                          onClick={() => openEditGrant(grant)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.72rem',
                            color: 'var(--color-danger)',
                            borderColor: 'var(--color-danger)',
                          }}
                          onClick={() => deleteGrant(grant.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tag expenses to grant budget heads */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Tag size={18} color="var(--color-primary)" />
            <h3 className="card-title" style={{ margin: 0 }}>Tag expenses to grants</h3>
            {untaggedSignificant.length > 0 && (
              <span style={{
                background: '#FEE2E2', color: '#B91C1C', borderRadius: 99,
                padding: '2px 10px', fontSize: '0.72rem', fontWeight: 700,
              }}>
                {untaggedSignificant.length} need tagging
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}
            onClick={() => setShowTagSection(v => !v)}
          >
            {showTagSection ? 'Hide' : 'Show'}
          </button>
        </div>

        {showTagSection && (
          <div style={{ padding: '0.75rem 0' }}>
            {untaggedSignificant.length > 0 ? (
              <div style={{
                background: '#FEF3C7', border: '1px solid #FCD34D',
                borderRadius: 'var(--radius-md)', padding: '0.6rem 0.8rem',
                fontSize: '0.82rem', color: '#92400E', marginBottom: '0.75rem',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <AlertCircle size={14} />
                <span>
                  <strong>{untaggedSignificant.length}</strong> expenses ≥ ₹1,000
                  totalling <strong>₹{Math.round(untaggedTotal).toLocaleString('en-IN')}</strong>
                  {' '}aren't yet tagged to a grant — tag them so utilisation reports stay accurate.
                </span>
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>
                All significant expenses are tagged. Use this list to re-tag or correct any entry.
              </div>
            )}

            {csrCards.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)' }}>Add a grant first.</div>
            ) : grantBudgetHeads.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)' }}>
                No budget heads configured yet. Open a grant in <em>Grants → [grant] → Active</em> and add heads first.
              </div>
            ) : (
              <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg-main)', position: 'sticky', top: 0 }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem' }}>Description</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.6rem' }}>Amount</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem' }}>Grant</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem' }}>Budget head</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(untaggedSignificant.length > 0 ? untaggedSignificant : expensesOnly.slice(0, 25)).map(e => {
                      const existing = e.grantTag;
                      const draft    = tagDraft[e.id] ?? { grantId: existing?.grantId ?? '', budgetHeadId: existing?.budgetHeadId ?? '' };
                      const headsForGrant = grantBudgetHeads.filter(h => String(h.grantId) === String(draft.grantId));
                      const desc = `${e.description}${e.fund ? ` · ${e.fund}` : ''}`;
                      return (
                        <tr key={e.id} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                          <td style={{ padding: '0.4rem 0.6rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={desc}>
                            {desc}
                            {existing && <span style={{ marginLeft: 6, color: '#16A34A', fontSize: '0.7rem' }}>· tagged</span>}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 600 }}>
                            ₹{Math.round(Math.abs(e.amount)).toLocaleString('en-IN')}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <select
                              className="input-field"
                              style={{ padding: '0.25rem 0.4rem', fontSize: '0.78rem' }}
                              value={draft.grantId}
                              onChange={ev => setTagDraft(prev => ({ ...prev, [e.id]: { grantId: ev.target.value, budgetHeadId: '' } }))}
                            >
                              <option value="">Select grant…</option>
                              {csrCards.map(c => (
                                <option key={c.id} value={String(c.id)}>{c.company} — {c.project}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <select
                              className="input-field"
                              style={{ padding: '0.25rem 0.4rem', fontSize: '0.78rem' }}
                              disabled={!draft.grantId}
                              value={draft.budgetHeadId}
                              onChange={ev => setTagDraft(prev => ({ ...prev, [e.id]: { ...(prev[e.id] ?? draft), budgetHeadId: ev.target.value } }))}
                            >
                              <option value="">{headsForGrant.length === 0 ? 'No heads on this grant' : 'Select head…'}</option>
                              {headsForGrant.map(h => (
                                <option key={h.id} value={h.id}>{h.label}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                              onClick={() => handleTagSave(e.id)}
                            >Save</button>
                            {existing && (
                              <button
                                type="button"
                                onClick={() => { setJournalEntryGrantTag(e.id, null); toast.success('Tag cleared.'); }}
                                title="Clear tag"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 4, color: 'var(--color-text-tertiary)' }}
                              >
                                <X size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showEntryModal && (
        <ModalOverlay onBackdropClick={() => setShowEntryModal(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fin-entry-title"
          >
            <button type="button" onClick={() => setShowEntryModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="fin-entry-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>New Journal Entry</h2>
            <form onSubmit={handleJournalEntry} className="flex-col gap-4 flex">
              {/* Cross-module joins: donor + programme selectors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Donor (optional)</label>
                  <input
                    list="fin-donor-list"
                    className="input-field"
                    placeholder="Search donor…"
                    value={donorSearch}
                    onChange={ev => {
                      const val = ev.target.value;
                      setDonorSearch(val);
                      const match = donors.find(d => d.name.toLowerCase() === val.toLowerCase());
                      setEntry(prev => ({ ...prev, donorId: match ? match.id : '' }));
                    }}
                  />
                  <datalist id="fin-donor-list">
                    {donors.map(d => <option key={d.id} value={d.name} />)}
                  </datalist>
                  {entry.donorId && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-success)', marginTop: 2 }}>
                      Linked to CRM donor
                    </div>
                  )}
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Programme (optional)</label>
                  <select
                    className="input-field"
                    value={entry.programmeId}
                    onChange={ev => setEntry(prev => ({ ...prev, programmeId: ev.target.value }))}
                  >
                    <option value="">— None —</option>
                    {allProgrammes.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Description</label>
                <div style={{ position: 'relative' }}>
                  <input required type="text" className="input-field" placeholder="e.g. Staff salary disbursement" 
                    value={entry.description} 
                    onChange={async (e) => {
                      const val = e.target.value;
                      setEntry({ ...entry, description: val });
                      if (val.length > 5 && entry.fund === 'FCRA') {
                        setIsClassifying(true);
                        try {
                          const res = await apiFetch(`/workflows/classify-transaction?description=${encodeURIComponent(val)}`, { method: 'POST' });
                          if (res.ok) {
                            const data = await res.json();
                            setClassification(data);
                          }
                        } catch (err) {} finally { setIsClassifying(false); }
                      }
                    }} 
                  />
                  {entry.fund === 'FCRA' && (classification || isClassifying) && (
                    <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-card)', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)', fontSize: '0.7rem', zIndex: 5 }}>
                      {isClassifying ? 'Classifying...' : (
                        <>
                          <Bot size={12} color="var(--color-primary)" />
                          <span style={{ fontWeight: 600 }}>{classification?.category}</span>
                          <span style={{ color: (classification?.confidence || 0) > 0.8 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                            {Math.round((classification?.confidence || 0) * 100)}%
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Amount (₹)</label>
                  <input required type="number" className="input-field" min="1" value={entry.amount} onChange={e => setEntry({ ...entry, amount: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Type</label>
                  <select className="input-field" value={entry.type} onChange={e => setEntry({ ...entry, type: e.target.value as 'Expense'|'Income'|'Transfer', grantId: e.target.value === 'Expense' ? entry.grantId : '', budgetHeadId: e.target.value === 'Expense' ? entry.budgetHeadId : '' })}>
                    <option>Expense</option>
                    <option>Income</option>
                    <option>Transfer</option>
                  </select>
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Fund Classification</label>
                <select className="input-field" value={entry.fund} onChange={e => setEntry({ ...entry, fund: e.target.value })}>
                  <option>General</option>
                  <option>FCRA</option>
                  <option>CSR</option>
                  <option>Restricted Grant</option>
                </select>
              </div>
              {entry.type === 'Expense' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Tag to grant (optional)</label>
                    <select
                      className="input-field"
                      value={entry.grantId}
                      onChange={e => setEntry({ ...entry, grantId: e.target.value, budgetHeadId: '' })}
                    >
                      <option value="">— None —</option>
                      {csrCards.map(c => (
                        <option key={c.id} value={String(c.id)}>{c.company} — {c.project}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Budget head</label>
                    <select
                      className="input-field"
                      disabled={!entry.grantId}
                      value={entry.budgetHeadId}
                      onChange={e => setEntry({ ...entry, budgetHeadId: e.target.value })}
                    >
                      {(() => {
                        const heads = grantBudgetHeads.filter(h => String(h.grantId) === String(entry.grantId));
                        return (
                          <>
                            <option value="">{!entry.grantId ? 'Pick grant first' : heads.length === 0 ? 'No heads on this grant' : '— Select head —'}</option>
                            {heads.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
                          </>
                        );
                      })()}
                    </select>
                  </div>
                </div>
              )}
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Record Entry</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {showGrantModal && (
        <ModalOverlay onBackdropClick={() => setShowGrantModal(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fin-grant-title"
          >
            <button type="button" onClick={() => setShowGrantModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="fin-grant-title" style={{ marginBottom: '1.25rem', paddingRight: '2.5rem' }}>{editingGrantId ? 'Edit Grant' : 'Add Grant'}</h2>
            <form onSubmit={saveGrant} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Grant name</label>
                <input required className="input-field" value={grantForm.name} onChange={(e) => setGrantForm({ ...grantForm, name: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Total budget (₹)</label>
                  <input type="number" className="input-field" min={0} value={grantForm.total} onChange={(e) => setGrantForm({ ...grantForm, total: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Spent (₹)</label>
                  <input type="number" className="input-field" min={0} value={grantForm.spent} onChange={(e) => setGrantForm({ ...grantForm, spent: Number(e.target.value) })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Status</label>
                <select className="input-field" value={grantForm.status} onChange={(e) => setGrantForm({ ...grantForm, status: e.target.value })}>
                  <option value="On Track">On Track</option>
                  <option value="Over Budget">Over Budget</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary">
                {editingGrantId ? 'Save changes' : 'Create grant'}
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default Finance;
