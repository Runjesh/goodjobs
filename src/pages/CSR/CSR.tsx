import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Search, Plus, Clock, X, Folder, Upload, FileText, Trash2, Download, Bot, Sparkles, Loader2, Edit, ArrowUpRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import PermissionGate from '../../components/Auth/PermissionGate';
import { useFocusFromUrl } from '../../hooks/useFocusFromUrl';
import AtRiskGrantsBanner from '../../components/Compliance/AtRiskGrantsBanner';
import toast from 'react-hot-toast';
import './CSR.css';
import { apiFetch } from '../../api/client';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import GrantFundingSummary from '../../components/CSR/GrantFundingSummary';

const columns = [
  { id: 'prospecting', title: 'Prospecting', class: 'col-prospecting' },
  { id: 'pitch', title: 'Pitch Sent', class: 'col-pitch' },
  { id: 'diligence', title: 'Due Diligence', class: 'col-diligence' },
  { id: 'mou', title: 'MoU Signed', class: 'col-mou' },
  { id: 'live', title: 'Project Live', class: 'col-live' }
];

function formatActivityHint(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function idleDaysFromIso(iso?: string): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

type CsrExtraForm = {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  sector: string;
  companyCin: string;
  projectDurationMonths: string;
  reportingCadence: string;
  expectedOutcomes: string;
  csrScheduleVii: boolean;
  coFundingPercent: string;
  internalNotes: string;
};

const CSR_EXTRA_EMPTY: CsrExtraForm = {
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  sector: '',
  companyCin: '',
  projectDurationMonths: '',
  reportingCadence: 'quarterly',
  expectedOutcomes: '',
  csrScheduleVii: false,
  coFundingPercent: '',
  internalNotes: '',
};

function packCsrDetails(e: CsrExtraForm): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (e.contactName.trim()) o.contact_name = e.contactName.trim();
  if (e.contactEmail.trim()) o.contact_email = e.contactEmail.trim();
  if (e.contactPhone.trim()) o.contact_phone = e.contactPhone.trim();
  if (e.sector.trim()) o.sector = e.sector.trim();
  if (e.companyCin.trim()) o.company_cin = e.companyCin.trim().toUpperCase();
  if (e.projectDurationMonths.trim()) {
    const n = parseInt(e.projectDurationMonths, 10);
    if (!Number.isNaN(n)) o.project_duration_months = n;
  }
  if (e.reportingCadence) o.reporting_cadence = e.reportingCadence;
  if (e.expectedOutcomes.trim()) o.expected_outcomes = e.expectedOutcomes.trim();
  o.csr_schedule_vii_applicable = e.csrScheduleVii;
  if (e.coFundingPercent.trim()) {
    const n = parseFloat(e.coFundingPercent);
    if (!Number.isNaN(n)) o.co_funding_percent = n;
  }
  if (e.internalNotes.trim()) o.internal_notes = e.internalNotes.trim();
  return o;
}

function unpackCsrDetails(details?: Record<string, unknown> | null): CsrExtraForm {
  const d = details || {};
  return {
    contactName: String(d.contact_name ?? ''),
    contactEmail: String(d.contact_email ?? ''),
    contactPhone: String(d.contact_phone ?? ''),
    sector: String(d.sector ?? ''),
    companyCin: String(d.company_cin ?? ''),
    projectDurationMonths: d.project_duration_months != null ? String(d.project_duration_months) : '',
    reportingCadence: String(d.reporting_cadence ?? 'quarterly'),
    expectedOutcomes: String(d.expected_outcomes ?? ''),
    csrScheduleVii: Boolean(d.csr_schedule_vii_applicable),
    coFundingPercent: d.co_funding_percent != null ? String(d.co_funding_percent) : '',
    internalNotes: String(d.internal_notes ?? ''),
  };
}

const CSR: React.FC = () => {
  useFocusFromUrl('card');
  const navigate = useNavigate();
  const { csrCards, moveCSRCard, addCSRCard, updateCSRCard, deleteCSRCard, ngoDetails } = useStore();
  const { can } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [dragId, setDragId] = useState<number | string | null>(null);
  const [form, setForm] = useState({ company: '', amount: 1000000, project: '', tags: '', col: 'prospecting', agent: 'AD' });
  const [extraForm, setExtraForm] = useState<CsrExtraForm>({ ...CSR_EXTRA_EMPTY });
  const [editExtra, setEditExtra] = useState<CsrExtraForm>({ ...CSR_EXTRA_EMPTY });
  const [docRoom, setDocRoom] = useState<{ cardId: number | string; company: string } | null>(null);
  const [cardDocs, setCardDocs] = useState<Record<string, any[]>>({});
  const [docUploading, setDocUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any | null>(null);
  const [showProspectDb, setShowProspectDb] = useState(false);
  const [dbQuery, setDbQuery] = useState('');
  const [dbLoading, setDbLoading] = useState(false);
  const [dbResults, setDbResults] = useState<any[]>([]);

  const [showEditCard, setShowEditCard] = useState(false);
  const [editCard, setEditCard] = useState<any>(null);
  const [showDeleteCardConfirm, setShowDeleteCardConfirm] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<any>(null);

  const handleDragStart = (id: number | string) => setDragId(id);

  const handleDrop = async (col: string) => {
    if (dragId !== null) {
      const card = csrCards.find(c => String(c.id) === String(dragId));
      if (card && card.col !== col) {
        moveCSRCard(dragId, col);
        try {
          await apiFetch(`/csr/cards/${encodeURIComponent(String(dragId))}/move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ col }),
          });
        } catch {
          // best-effort; UI already updated
        }
        toast.success(`Moved "${card.company}" to ${columns.find(c => c.id === col)?.title}`);
      }
      setDragId(null);
    }
  };

  const handleAddProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
    try {
      const res = await apiFetch('/csr/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: form.company,
          amount: Number(form.amount),
          project: form.project,
          tags,
          agent: form.agent || 'AD',
          col: form.col,
          date: 'Just added',
          details: packCsrDetails(extraForm),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.card?.id) {
          useStore.getState().addCSRCardWithId(data.card);
        }
        // refresh canonical list to avoid drift
        const r = await apiFetch('/csr/cards');
        if (r.ok) {
          const rd = await r.json();
          if (Array.isArray(rd.cards)) useStore.getState().setCsrCards(rd.cards);
        }
        toast.success(`New proposal for ${form.company} added to pipeline!`);
        setForm({ company: '', amount: 1000000, project: '', tags: '', col: 'prospecting', agent: 'AD' });
        setExtraForm({ ...CSR_EXTRA_EMPTY });
        setShowModal(false);
        return;
      }
    } catch {
      toast.error('Failed to add proposal.');
      return;
    }
    toast.error('Failed to add proposal.');
  };

  const handleEditCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCard.company.trim()) return;
    const tags = typeof editCard.tags === 'string' ? editCard.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : editCard.tags;
    try {
      const res = await apiFetch(`/csr/cards/${editCard.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: editCard.company,
          amount: editCard.amount,
          project: editCard.project,
          tags,
          agent: editCard.agent || 'AD',
          col: editCard.col,
          date: editCard.date || 'Just added',
          details: packCsrDetails(editExtra),
        }),
      });
      if (res.ok) {
        updateCSRCard(editCard.id, { ...editCard, tags, details: packCsrDetails(editExtra) });
        toast.success(`Proposal updated!`);
        setShowEditCard(false);
      } else {
        toast.error('Failed to update proposal.');
      }
    } catch {
      toast.error('Network error updating proposal.');
    }
  };

  const handleDeleteCard = async () => {
    if (!cardToDelete) return;
    try {
      const res = await apiFetch(`/csr/cards/${cardToDelete.id}`, { method: 'DELETE' });
      if (res.ok) {
        deleteCSRCard(cardToDelete.id);
        toast.success(`Proposal deleted!`);
        setShowDeleteCardConfirm(false);
        setCardToDelete(null);
      } else {
        toast.error('Failed to delete proposal.');
      }
    } catch {
      toast.error('Network error deleting proposal.');
    }
  };

  const runProspectAgent = async () => {
    if (!form.company.trim()) {
      toast.error('Enter a corporate name first.');
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await apiFetch('/trigger/csr-prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.company,
          sector: 'Corporate',
          annual_revenue_cr: Math.max(1, Math.round(Number(form.amount) / 10000000)),
          focus_area: form.project || 'Education',
          ngo_programs: [form.project].filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error('CSR agent failed');
      const data = await res.json();
      setAiResult(data);
      toast.success('CSR Prospect Agent completed. Review outputs below.', { icon: '🤖', duration: 4000 });
    } catch {
      toast.error('CSR Prospect Agent failed (backend not reachable or error).');
    } finally {
      setAiLoading(false);
    }
  };

  const searchProspectDb = async () => {
    setDbLoading(true);
    try {
      const res = await apiFetch(`/csr/prospect-db/search?q=${encodeURIComponent(dbQuery)}`);
      if (!res.ok) throw new Error('search failed');
      const data = await res.json();
      setDbResults(Array.isArray(data.results) ? data.results : []);
    } catch {
      toast.error('Prospect DB search failed.');
    } finally {
      setDbLoading(false);
    }
  };

  const handleDocUpload = (cardId: number | string) => {
    setDocRoom({ cardId, company: (csrCards.find(c => c.id === cardId)?.company || 'CSR') as any });
    setTimeout(() => fileRef.current?.click(), 0);
  };

  const handleDocDelete = (cardId: number | string, docId: string) => {
    const run = async () => {
      try {
        const res = await apiFetch(`/csr/cards/${encodeURIComponent(String(cardId))}/documents/${encodeURIComponent(String(docId))}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete');
        const r = await apiFetch(`/csr/cards/${encodeURIComponent(String(cardId))}/documents`);
        if (r.ok) {
          const data = await r.json();
          setCardDocs(prev => ({ ...prev, [String(cardId)]: Array.isArray(data.documents) ? data.documents : [] }));
        }
        toast('Document removed.', { duration: 1500 });
      } catch {
        toast.error('Failed to remove document.');
      }
    };
    run();
  };

  const refreshCardDocs = async (cardId: number | string) => {
    try {
      const res = await apiFetch(`/csr/cards/${encodeURIComponent(String(cardId))}/documents`);
      if (!res.ok) return;
      const data = await res.json();
      setCardDocs(prev => ({ ...prev, [String(cardId)]: Array.isArray(data.documents) ? data.documents : [] }));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!docRoom) return;
    refreshCardDocs(docRoom.cardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docRoom?.cardId]);

  // Pre-seed the prospect DB search with the org's cause area when no
  // explicit query has been entered and the modal is first opened.
  useEffect(() => {
    if (showProspectDb && !dbQuery && ngoDetails.causeArea) {
      setDbQuery(ngoDetails.causeArea);
    }
    // Only run when the modal opens — not on every dbQuery change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProspectDb]);

  const onPickDocFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !docRoom) return;
    setDocUploading(true);
    try {
      // 1) Presign upload to S3
      const presignRes = await apiFetch('/storage/presigned-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: `csr/${docRoom.cardId}`,
          filename: f.name,
          content_type: f.type || 'application/pdf',
        }),
      });
      if (!presignRes.ok) throw new Error('presign');
      const presign = await presignRes.json();

      // 2) PUT to S3
      const putRes = await fetch(presign.url, {
        method: 'PUT',
        headers: { 'Content-Type': f.type || 'application/pdf' },
        body: f,
      });
      if (!putRes.ok) throw new Error('put');

      // 3) Persist metadata
      const metaRes = await apiFetch(`/csr/cards/${encodeURIComponent(String(docRoom.cardId))}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.name,
          doc_type: 'Misc',
          size_bytes: f.size,
          s3_key: presign.key,
        }),
      });
      if (!metaRes.ok) throw new Error('meta');
      toast.success('Document uploaded.', { icon: '📁' });
      await refreshCardDocs(docRoom.cardId);
    } catch {
      toast.error('Upload failed. Check backend/S3 settings.');
    } finally {
      setDocUploading(false);
    }
  };

  const downloadProjectUc = async (company: string, project: string) => {
    try {
      const q = new URLSearchParams();
      if (company) q.set('company', company);
      if (project) q.set('project', project);
      const qs = q.toString();
      const res = await apiFetch(`/finance/uc.pdf${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('uc');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'utilization_certificate_draft.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('UC draft downloaded.');
    } catch {
      toast.error('Failed to download UC.');
    }
  };

  const downloadDoc = async (doc: any) => {
    try {
      const key = doc?.s3_key || doc?.s3Key;
      if (!key) throw new Error('missing key');
      const res = await apiFetch('/storage/presigned-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, filename: doc.name }),
      });
      if (!res.ok) throw new Error('presign');
      const data = await res.json();
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Failed to download file.');
    }
  };

  const totalPipeline = csrCards.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const signed = csrCards.filter(c => c.col === 'mou' || c.col === 'live').reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const reportsDueCount = csrCards.filter(
    c => c.col === 'live' && idleDaysFromIso(c.last_activity_at || c.updated_at) >= 21
  ).length;

  return (
    <div className="csr-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">CSR Pipeline</h1>
          <p className="page-subtitle">Track corporate prospects, manage proposals, and ensure CSR-1 compliance.</p>
        </div>
        <div className="flex gap-4">
          <button
            className="btn btn-secondary"
            onClick={() => { setShowProspectDb(true); setTimeout(() => searchProspectDb(), 0); }}
          >
            <Search size={16} /> Prospect DB
          </button>
          <button className="btn btn-secondary" onClick={runProspectAgent} disabled={aiLoading} style={{ border: '1px solid #8b5cf6', color: '#8b5cf6' }}>
            {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
            {aiLoading ? 'Researching…' : 'AI Prospect Research'}
          </button>
          <PermissionGate module="csr" action="canEdit">
            <button
              className="btn btn-primary"
              onClick={() => {
                setExtraForm({ ...CSR_EXTRA_EMPTY });
                setShowModal(true);
              }}
            >
              <Plus size={16} /> New Proposal
            </button>
          </PermissionGate>
        </div>
      </div>

      {/* Prospect DB Modal */}
      {showProspectDb && (
        <ModalOverlay onBackdropClick={() => setShowProspectDb(false)}>
          <div
            className="modal-card modal-card--xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="csr-prospect-db-title"
            style={{ maxWidth: '720px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
          >
            <div className="card-header flex justify-between items-center" style={{ padding: '1.25rem 1.5rem' }}>
              <h3 id="csr-prospect-db-title" className="card-title flex items-center gap-2"><Search size={18} /> Prospect DB</h3>
              <button type="button" className="action-btn" onClick={() => setShowProspectDb(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <div style={{ padding: '0 1.5rem 1rem' }}>
              <div className="flex gap-2">
                <input
                  className="input-field"
                  style={{ flex: 1 }}
                  placeholder="Search company or focus areas (e.g. education, Mumbai)"
                  value={dbQuery}
                  onChange={(e) => setDbQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchProspectDb(); }}
                />
                <button className="btn btn-primary" onClick={searchProspectDb} disabled={dbLoading}>
                  {dbLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  Search
                </button>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                {dbResults.length} result(s)
              </div>
            </div>
            <div style={{ padding: '0 1.5rem 1.5rem', overflowY: 'auto', flex: 1 }}>
              {dbResults.length === 0 && !dbLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-tertiary)' }}>
                  No results. Try a different query.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {dbResults.map((c) => (
                    <div key={c.id} style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '1rem', background: 'white' }}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div style={{ fontWeight: 700 }}>{c.company_name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{c.sector} • {c.hq_city}</div>
                        </div>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
                          onClick={() => {
                            setForm(prev => ({
                              ...prev,
                              company: c.company_name,
                              amount: Math.round((c.csr_obligation_cr || 10) * 10000000),
                              project: (c.focus_areas?.[0] || prev.project),
                            }));
                            setExtraForm(prev => ({ ...prev, sector: c.sector || prev.sector }));
                            toast.success('Prefilled proposal form from Prospect DB.');
                            setShowProspectDb(false);
                          }}
                        >
                          Use
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                        <div><strong>CSR Obligation:</strong> ₹{c.csr_obligation_cr?.toLocaleString?.() ?? c.csr_obligation_cr} Cr</div>
                        <div><strong>Focus areas:</strong> {(c.focus_areas || []).join(', ')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* AI Output Panel */}
      {aiResult && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid #8b5cf6' }}>
          <div className="card-header flex justify-between items-center">
            <h3 className="card-title flex items-center gap-2"><Sparkles size={18} color="#8b5cf6" /> AI Prospect Output</h3>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => setAiResult(null)}>
              <X size={14} /> Clear
            </button>
          </div>
          <div className="card-body" style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--color-bg-main)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)' }}>COMPANY</div>
                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{aiResult.company_name || form.company}</div>
              </div>
              <div style={{ background: 'var(--color-bg-main)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)' }}>ALIGNMENT SCORE</div>
                <div style={{ fontWeight: 700, color: '#8b5cf6' }}>{aiResult.alignment_score ?? '—'}</div>
              </div>
            </div>
            <div style={{ background: 'var(--color-bg-main)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: '0.25rem' }}>RAW OUTPUT</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
{JSON.stringify(aiResult, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Compliance → grant cascade: surface at-risk grants at the top of
          the CSR pipeline so reps see expiring docs before opening a card. */}
      <AtRiskGrantsBanner />

      <div className="csr-stats-row">
        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#3b82f6' }}><Building2 size={24} /></div>
          <div className="stat-info"><h4>Active Prospects</h4><div className="stat-val">{csrCards.length}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#f59e0b' }}><Building2 size={24} /></div>
          <div className="stat-info"><h4>Pipeline Value</h4><div className="stat-val">₹{(totalPipeline / 10000000).toFixed(1)}Cr</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#8b5cf6' }}><Building2 size={24} /></div>
          <div className="stat-info"><h4>Signed (YTD)</h4><div className="stat-val">₹{(signed / 10000000).toFixed(1)}Cr</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#10b981' }}><Clock size={24} /></div>
          <div className="stat-info"><h4>Reports Due</h4><div className="stat-val">{reportsDueCount}</div></div>
        </div>
      </div>

      <div className="csr-kanban">
        {columns.map(col => {
          const colCards = csrCards.filter(c => c.col === col.id);
          const colTotal = colCards.reduce((s, c) => s + c.amount, 0);
          return (
            <div key={col.id} className={`kanban-column ${col.class}`}
              onDragOver={e => e.preventDefault()} onDrop={() => handleDrop(col.id)}>
              <div className="kanban-column-header">
                <div>
                  <div style={{ marginBottom: '0.25rem' }}>{col.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                    ₹{(colTotal / 100000).toFixed(1)}L
                  </div>
                </div>
                <span className="column-count">{colCards.length}</span>
              </div>
              <div className="kanban-cards">
                {colCards.map(card => {
                  const touchHint = formatActivityHint(card.last_activity_at || card.updated_at);
                  return (
                  <div key={String(card.id)} className="kanban-card" data-focus-id={String(card.id)} draggable
                    onDragStart={() => handleDragStart(card.id)}
                    style={{ opacity: dragId !== null && String(dragId) === String(card.id) ? 0.5 : 1 }}>
                    <div className="csr-card-header">
                      <div
                        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                        onClick={() => navigate(`/grants/${encodeURIComponent(String(card.id))}`)}
                        title="Open grant detail"
                      >
                        <div className="csr-company">{card.company}</div>
                        <div className="csr-amount">₹{(card.amount / 100000).toFixed(1)}L</div>
                      </div>
                      <div className="flex gap-1" style={{ marginLeft: '0.5rem', alignItems: 'flex-start' }}>
                        <button
                          className="btn-icon-only"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditExtra(unpackCsrDetails(card.details as Record<string, unknown> | undefined));
                            setEditCard({ ...card, tags: card.tags.join(', ') });
                            setShowEditCard(true);
                          }}
                        >
                          <Edit size={13} color="var(--color-text-secondary)" />
                        </button>
                        <button className="btn-icon-only" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }} onClick={(e) => { e.stopPropagation(); setCardToDelete(card); setShowDeleteCardConfirm(true); }}>
                          <Trash2 size={13} color="var(--color-danger)" />
                        </button>
                      </div>
                    </div>
                    <div
                      className="csr-project"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/grants/${encodeURIComponent(String(card.id))}`)}
                    >
                      {card.project}
                    </div>
                    <GrantFundingSummary grantId={String(card.id)} />
                    {(() => {
                      const d = card.details as Record<string, unknown> | undefined;
                      const bits = [d?.sector, d?.contact_name].filter(Boolean) as string[];
                      if (!bits.length) return null;
                      return <div className="csr-card-meta">{bits.join(' · ')}</div>;
                    })()}
                    <div className="csr-tags">
                      {card.tags.map(tag => <span key={tag} className="csr-tag">{tag}</span>)}
                    </div>
                    {(card.win_probability != null || touchHint) && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 2, lineHeight: 1.3 }}>
                        {card.win_probability != null ? <span>Win {card.win_probability}%</span> : null}
                        {card.win_probability != null && touchHint ? ' · ' : null}
                        {touchHint ? <span>Last touch {touchHint}</span> : null}
                      </div>
                    )}
                    <div className="csr-footer">
                      <div className="csr-agent"><div className="csr-avatar">{card.agent}</div></div>
                      <div className="flex items-center gap-2">
                        {card.col === 'live' && (
                          <button
                            className="csr-doc-btn"
                            title="Download UC draft (project context)"
                            onClick={() => downloadProjectUc(card.company, card.project)}
                          >
                            <FileText size={13} /> UC
                          </button>
                        )}
                        <button className="csr-doc-btn" title="Open Document Room"
                          onClick={(e) => { e.stopPropagation(); setDocRoom({ cardId: card.id, company: card.company }); }}>
                          <Folder size={13} /> Docs ({(cardDocs[String(card.id)] || []).length})
                        </button>
                        <button
                          className="csr-doc-btn"
                          title="Open grant detail"
                          onClick={(e) => { e.stopPropagation(); navigate(`/grants/${encodeURIComponent(String(card.id))}`); }}
                          style={{ background: '#ccfbf1', color: '#0F766E', borderColor: '#5eead4' }}
                        >
                          <ArrowUpRight size={13} /> Open
                        </button>
                        <span className="flex items-center gap-1" style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                          <Clock size={11} /> {card.date}
                        </span>
                      </div>
                    </div>
                  </div>
                  );
                })}
                {colCards.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-tertiary)', fontSize: '0.875rem', border: '2px dashed var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Proposal Modal */}
      {showModal && (
        <ModalOverlay onBackdropClick={() => setShowModal(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="csr-new-proposal-title"
            style={{ maxWidth: '560px', maxHeight: 'min(90vh, 820px)' }}
          >
            <button type="button" onClick={() => setShowModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="csr-new-proposal-title" style={{ marginBottom: '0.25rem', paddingRight: '2.5rem' }}>New CSR Proposal</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '1.25rem' }}>
              Capture Schedule VII–aligned fields so diligence, MoU, and impact reporting stay consistent.
            </p>
            <form onSubmit={handleAddProposal} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Corporate Name</label>
                <input required type="text" className="input-field" placeholder="e.g. Tata Trusts" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Sector</label>
                  <input type="text" className="input-field" placeholder="e.g. IT / Banking / FMCG" value={extraForm.sector} onChange={e => setExtraForm({ ...extraForm, sector: e.target.value })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">CIN (optional)</label>
                  <input type="text" className="input-field" placeholder="L17110MH1995PLC" value={extraForm.companyCin} onChange={e => setExtraForm({ ...extraForm, companyCin: e.target.value })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Project / programme title</label>
                <input required type="text" className="input-field" placeholder="e.g. Digital Literacy Phase 3 — Nashik block" value={form.project} onChange={e => setForm({ ...form, project: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Proposed grant (₹)</label>
                  <input required type="number" className="input-field" value={form.amount} min="100000" onChange={e => setForm({ ...form, amount: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Duration (months)</label>
                  <input type="number" className="input-field" placeholder="e.g. 24" min="1" value={extraForm.projectDurationMonths} onChange={e => setExtraForm({ ...extraForm, projectDurationMonths: e.target.value })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Expected outcomes (for proposal / board)</label>
                <textarea className="input-field" rows={3} placeholder="e.g. 2,000 adolescents certified; 40% female; baseline/endline with third-party sample" value={extraForm.expectedOutcomes} onChange={e => setExtraForm({ ...extraForm, expectedOutcomes: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Reporting cadence</label>
                  <select className="input-field" value={extraForm.reportingCadence} onChange={e => setExtraForm({ ...extraForm, reportingCadence: e.target.value })}>
                    <option value="monthly">Monthly narrative + utilisation</option>
                    <option value="quarterly">Quarterly (CSR committee)</option>
                    <option value="bi_annual">Bi-annual</option>
                    <option value="annual">Annual + audit pack</option>
                    <option value="ad_hoc">Ad hoc (milestone-based)</option>
                  </select>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Co-funding / match % (optional)</label>
                  <input type="number" className="input-field" placeholder="e.g. 10" min="0" max="100" step="0.5" value={extraForm.coFundingPercent} onChange={e => setExtraForm({ ...extraForm, coFundingPercent: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: '0.125rem' }}>
                <input type="checkbox" id="csrVii" checked={extraForm.csrScheduleVii} onChange={e => setExtraForm({ ...extraForm, csrScheduleVii: e.target.checked })} />
                <label htmlFor="csrVii" style={{ fontSize: '0.875rem' }}>Maps to Companies Act Schedule VII theme (document in diligence)</label>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Tags (comma separated)</label>
                <input type="text" className="input-field" placeholder="e.g. Education, Tech, Maharashtra" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Pipeline stage</label>
                  <select className="input-field" value={form.col} onChange={e => setForm({ ...form, col: e.target.value })}>
                    {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Relationship owner</label>
                  <select className="input-field" value={form.agent} onChange={e => setForm({ ...form, agent: e.target.value })}>
                    <option value="AD">AD — Ayush</option>
                    <option value="RS">RS — Riya</option>
                    <option value="PM">PM — Priya M</option>
                  </select>
                </div>
              </div>

              <div className="csr-form-section">
                <div className="csr-form-section-title">Corporate contact &amp; notes</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">CSR / foundation contact name</label>
                    <input type="text" className="input-field" placeholder="e.g. Meera Iyer" value={extraForm.contactName} onChange={e => setExtraForm({ ...extraForm, contactName: e.target.value })} />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Contact phone</label>
                    <input type="tel" className="input-field" placeholder="+91 …" value={extraForm.contactPhone} onChange={e => setExtraForm({ ...extraForm, contactPhone: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Contact email</label>
                  <input type="email" className="input-field" placeholder="csr@company.com" value={extraForm.contactEmail} onChange={e => setExtraForm({ ...extraForm, contactEmail: e.target.value })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Internal notes (not shown on exports)</label>
                  <textarea className="input-field" rows={2} placeholder="Meeting notes, committee dates, risk flags…" value={extraForm.internalNotes} onChange={e => setExtraForm({ ...extraForm, internalNotes: e.target.value })} />
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Add to Pipeline</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* Document Room Modal */}
      {docRoom && (
        <ModalOverlay onBackdropClick={() => !docUploading && setDocRoom(null)}>
          <div
            className="modal-card modal-card--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="csr-doc-room-title"
            style={{ maxWidth: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
          >
            <div className="card-header flex justify-between items-center" style={{ padding: '1.25rem 1.5rem' }}>
              <h3 id="csr-doc-room-title" className="card-title flex items-center gap-2">
                <Folder size={20} color="#f59e0b" /> {docRoom.company} — Document Room
              </h3>
              <button type="button" className="action-btn" onClick={() => setDocRoom(null)} disabled={docUploading} aria-label="Close"><X size={20} /></button>
            </div>
            <div style={{ padding: '0 1.5rem 1.5rem', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
                Files here are real and stored in your backend vault (S3 when configured).
              </div>

              {(cardDocs[String(docRoom.cardId)] || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)' }}>
                  <Folder size={40} style={{ opacity: 0.3, margin: '0 auto 1rem' }} />
                  <div>No documents yet. Upload the first file above.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(cardDocs[String(docRoom.cardId)] || []).map(doc => (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.875rem 1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-card)' }}>
                      <FileText size={20} color="var(--color-primary)" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                          {(doc.doc_type || doc.type || 'Document')} • {(doc.size_bytes ? `${Math.max(1, Math.round(doc.size_bytes / 1024))} KB` : doc.size || '')}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button className="action-btn" onClick={() => downloadDoc(doc)}><Download size={15} /></button>
                        <button className="action-btn" style={{ color: 'var(--color-danger)' }} onClick={() => handleDocDelete(docRoom.cardId, doc.id)}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => handleDocUpload(docRoom.cardId)} disabled={docUploading}>
                {docUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {docUploading ? 'Uploading…' : 'Upload File'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <input
        ref={fileRef}
        type="file"
        style={{ display: 'none' }}
        accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onChange={onPickDocFile}
      />

      {/* ── Edit Proposal Modal ───────────────────────────────────── */}
      {showEditCard && editCard && (
        <ModalOverlay onBackdropClick={() => setShowEditCard(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="csr-edit-proposal-title"
            style={{ maxWidth: '560px', maxHeight: 'min(90vh, 820px)' }}
          >
            <button type="button" onClick={() => setShowEditCard(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="csr-edit-proposal-title" style={{ marginBottom: '1rem', paddingRight: '2.5rem' }}>Edit CSR Proposal</h2>
            <form onSubmit={handleEditCard} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Corporate Name</label>
                <input required type="text" className="input-field" value={editCard.company} onChange={e => setEditCard({ ...editCard, company: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Sector</label>
                  <input type="text" className="input-field" value={editExtra.sector} onChange={e => setEditExtra({ ...editExtra, sector: e.target.value })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">CIN</label>
                  <input type="text" className="input-field" value={editExtra.companyCin} onChange={e => setEditExtra({ ...editExtra, companyCin: e.target.value })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Project / programme title</label>
                <input required type="text" className="input-field" value={editCard.project} onChange={e => setEditCard({ ...editCard, project: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Proposed grant (₹)</label>
                  <input required type="number" className="input-field" value={editCard.amount} min="100000" onChange={e => setEditCard({ ...editCard, amount: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Duration (months)</label>
                  <input type="number" className="input-field" min="1" value={editExtra.projectDurationMonths} onChange={e => setEditExtra({ ...editExtra, projectDurationMonths: e.target.value })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Expected outcomes</label>
                <textarea className="input-field" rows={3} value={editExtra.expectedOutcomes} onChange={e => setEditExtra({ ...editExtra, expectedOutcomes: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Reporting cadence</label>
                  <select className="input-field" value={editExtra.reportingCadence} onChange={e => setEditExtra({ ...editExtra, reportingCadence: e.target.value })}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="bi_annual">Bi-annual</option>
                    <option value="annual">Annual</option>
                    <option value="ad_hoc">Ad hoc</option>
                  </select>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Co-funding %</label>
                  <input type="number" className="input-field" min="0" max="100" step="0.5" value={editExtra.coFundingPercent} onChange={e => setEditExtra({ ...editExtra, coFundingPercent: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="csrViiEdit" checked={editExtra.csrScheduleVii} onChange={e => setEditExtra({ ...editExtra, csrScheduleVii: e.target.checked })} />
                <label htmlFor="csrViiEdit" style={{ fontSize: '0.875rem' }}>Schedule VII theme alignment</label>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Tags (comma separated)</label>
                <input type="text" className="input-field" value={editCard.tags} onChange={e => setEditCard({ ...editCard, tags: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Pipeline stage</label>
                  <select className="input-field" value={editCard.col} onChange={e => setEditCard({ ...editCard, col: e.target.value })}>
                    {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Relationship owner</label>
                  <select className="input-field" value={editCard.agent || 'AD'} onChange={e => setEditCard({ ...editCard, agent: e.target.value })}>
                    <option value="AD">AD — Ayush</option>
                    <option value="RS">RS — Riya</option>
                    <option value="PM">PM — Priya M</option>
                  </select>
                </div>
              </div>
              <div className="csr-form-section">
                <div className="csr-form-section-title">Corporate contact &amp; notes</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Contact name</label>
                    <input type="text" className="input-field" value={editExtra.contactName} onChange={e => setEditExtra({ ...editExtra, contactName: e.target.value })} />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Phone</label>
                    <input type="tel" className="input-field" value={editExtra.contactPhone} onChange={e => setEditExtra({ ...editExtra, contactPhone: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Email</label>
                  <input type="email" className="input-field" value={editExtra.contactEmail} onChange={e => setEditExtra({ ...editExtra, contactEmail: e.target.value })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Internal notes</label>
                  <textarea className="input-field" rows={2} value={editExtra.internalNotes} onChange={e => setEditExtra({ ...editExtra, internalNotes: e.target.value })} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Update Proposal</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ── Delete Confirm Modal ───────────────────────────────────── */}
      {showDeleteCardConfirm && (
        <ModalOverlay onBackdropClick={() => setShowDeleteCardConfirm(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="csr-del-proposal-title"
            style={{ textAlign: 'center' }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--color-danger)', color: 'white', padding: '1rem', borderRadius: '50%' }}>
                <Trash2 size={32} />
              </div>
            </div>
            <h2 id="csr-del-proposal-title" style={{ marginBottom: '0.5rem' }}>Delete Proposal?</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to delete the proposal for <strong>{cardToDelete?.company}</strong>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowDeleteCardConfirm(false)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleDeleteCard} style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)', flex: 1 }}>Delete</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default CSR;
