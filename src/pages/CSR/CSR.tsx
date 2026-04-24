import React, { useState } from 'react';
import { Building2, Search, Plus, Clock, X, Folder, Upload, FileText, Trash2, Download, Bot, Sparkles, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import './CSR.css';
import { apiFetch } from '../../api/client';

const columns = [
  { id: 'prospecting', title: 'Prospecting', class: 'col-prospecting' },
  { id: 'pitch', title: 'Pitch Sent', class: 'col-pitch' },
  { id: 'diligence', title: 'Due Diligence', class: 'col-diligence' },
  { id: 'mou', title: 'MoU Signed', class: 'col-mou' },
  { id: 'live', title: 'Project Live', class: 'col-live' }
];

// Per-card document rooms
const INITIAL_DOCS: Record<number, { id: string; name: string; type: string; size: string; uploaded: string }[]> = {
  1: [
    { id: 'd1', name: 'Reliance_CSR_Proposal_v2.pdf', type: 'Proposal', size: '2.4 MB', uploaded: 'Oct 10' },
    { id: 'd2', name: 'Due_Diligence_Checklist.docx', type: 'Due Diligence', size: '890 KB', uploaded: 'Oct 18' },
  ],
  2: [
    { id: 'd3', name: 'TCS_Pitch_Deck.pptx', type: 'Pitch', size: '5.1 MB', uploaded: 'Oct 12' },
  ],
  3: [
    { id: 'd4', name: 'HDFC_MoU_Draft.pdf', type: 'MoU', size: '1.2 MB', uploaded: 'Oct 20' },
    { id: 'd5', name: 'HDFC_Signed_MoU.pdf', type: 'MoU', size: '1.3 MB', uploaded: 'Oct 22' },
  ],
};

const CSR: React.FC = () => {
  const { csrCards, moveCSRCard, addCSRCard } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [form, setForm] = useState({ company: '', amount: 1000000, project: '', tags: '', col: 'prospecting' });
  const [docRoom, setDocRoom] = useState<{ cardId: number; company: string } | null>(null);
  const [cardDocs, setCardDocs] = useState(INITIAL_DOCS);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any | null>(null);
  const [showProspectDb, setShowProspectDb] = useState(false);
  const [dbQuery, setDbQuery] = useState('');
  const [dbLoading, setDbLoading] = useState(false);
  const [dbResults, setDbResults] = useState<any[]>([]);

  const handleDragStart = (id: number) => setDragId(id);

  const handleDrop = (col: string) => {
    if (dragId !== null) {
      const card = csrCards.find(c => c.id === dragId);
      if (card && card.col !== col) {
        moveCSRCard(dragId, col);
        toast.success(`Moved "${card.company}" to ${columns.find(c => c.id === col)?.title}`);
      }
      setDragId(null);
    }
  };

  const handleAddProposal = (e: React.FormEvent) => {
    e.preventDefault();
    addCSRCard({
      company: form.company,
      amount: Number(form.amount),
      project: form.project,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      agent: 'AD',
      col: form.col,
      date: 'Just added'
    });
    toast.success(`New proposal for ${form.company} added to pipeline!`);
    setForm({ company: '', amount: 1000000, project: '', tags: '', col: 'prospecting' });
    setShowModal(false);
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

  const handleDocUpload = (cardId: number) => {
    const newDoc = {
      id: 'd' + Date.now(),
      name: `Document_${new Date().toLocaleDateString('en-IN')}.pdf`,
      type: 'Misc',
      size: `${(Math.random() * 3 + 0.5).toFixed(1)} MB`,
      uploaded: 'Just now'
    };
    setCardDocs(prev => ({ ...prev, [cardId]: [...(prev[cardId] || []), newDoc] }));
    toast.success('Document uploaded to document room!', { icon: '📁' });
  };

  const handleDocDelete = (cardId: number, docId: string) => {
    setCardDocs(prev => ({ ...prev, [cardId]: (prev[cardId] || []).filter(d => d.id !== docId) }));
    toast('Document removed.', { duration: 1500 });
  };

  const totalPipeline = csrCards.reduce((s, c) => s + c.amount, 0);
  const signed = csrCards.filter(c => c.col === 'mou' || c.col === 'live').reduce((s, c) => s + c.amount, 0);

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
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> New Proposal
          </button>
        </div>
      </div>

      {/* Prospect DB Modal */}
      {showProspectDb && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '720px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div className="card-header flex justify-between items-center" style={{ padding: '1.25rem 1.5rem' }}>
              <h3 className="card-title flex items-center gap-2"><Search size={18} /> Prospect DB</h3>
              <button className="action-btn" onClick={() => setShowProspectDb(false)}><X size={20} /></button>
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
                            setForm(prev => ({ ...prev, company: c.company_name, amount: Math.round((c.csr_obligation_cr || 10) * 10000000), project: (c.focus_areas?.[0] || prev.project) }));
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
        </div>
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
          <div className="stat-info"><h4>Reports Due</h4><div className="stat-val">3</div></div>
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
                {colCards.map(card => (
                  <div key={card.id} className="kanban-card" draggable
                    onDragStart={() => handleDragStart(card.id)}
                    style={{ opacity: dragId === card.id ? 0.5 : 1 }}>
                    <div className="csr-card-header">
                      <div className="csr-company">{card.company}</div>
                      <div className="csr-amount">₹{(card.amount / 100000).toFixed(1)}L</div>
                    </div>
                    <div className="csr-project">{card.project}</div>
                    <div className="csr-tags">
                      {card.tags.map(tag => <span key={tag} className="csr-tag">{tag}</span>)}
                    </div>
                    <div className="csr-footer">
                      <div className="csr-agent"><div className="csr-avatar">{card.agent}</div></div>
                      <div className="flex items-center gap-2">
                        <button className="csr-doc-btn" title="Open Document Room"
                          onClick={() => setDocRoom({ cardId: card.id, company: card.company })}>
                          <Folder size={13} /> Docs ({(cardDocs[card.id] || []).length})
                        </button>
                        <span className="flex items-center gap-1" style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                          <Clock size={11} /> {card.date}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '460px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>New CSR Proposal</h2>
            <form onSubmit={handleAddProposal} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Corporate Name</label>
                <input required type="text" className="input-field" placeholder="e.g. Tata Trusts" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Project / Focus Area</label>
                <input required type="text" className="input-field" placeholder="e.g. Digital Literacy Phase 3" value={form.project} onChange={e => setForm({ ...form, project: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Proposed Grant Amount (₹)</label>
                <input required type="number" className="input-field" value={form.amount} min="100000" onChange={e => setForm({ ...form, amount: Number(e.target.value) })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Tags (comma separated)</label>
                <input type="text" className="input-field" placeholder="e.g. Education, Tech" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Pipeline Stage</label>
                <select className="input-field" value={form.col} onChange={e => setForm({ ...form, col: e.target.value })}>
                  {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Add to Pipeline</button>
            </form>
          </div>
        </div>
      )}

      {/* Document Room Modal */}
      {docRoom && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div className="card-header flex justify-between items-center" style={{ padding: '1.25rem 1.5rem' }}>
              <h3 className="card-title flex items-center gap-2">
                <Folder size={20} color="#f59e0b" /> {docRoom.company} — Document Room
              </h3>
              <button className="action-btn" onClick={() => setDocRoom(null)}><X size={20} /></button>
            </div>
            <div style={{ padding: '0 1.5rem 1.5rem', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {['Proposal', 'MoU', 'Due Diligence', 'Impact Report', 'Misc'].map(type => (
                  <button key={type} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                    onClick={() => {
                      const doc = { id: 'd' + Date.now(), name: `${docRoom.company}_${type}_${Date.now()}.pdf`, type, size: `${(Math.random() * 2 + 0.5).toFixed(1)} MB`, uploaded: 'Just now' };
                      setCardDocs(prev => ({ ...prev, [docRoom.cardId]: [...(prev[docRoom.cardId] || []), doc] }));
                      toast.success(`${type} document uploaded!`, { icon: '📁' });
                    }}>
                    + {type}
                  </button>
                ))}
              </div>

              {(cardDocs[docRoom.cardId] || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)' }}>
                  <Folder size={40} style={{ opacity: 0.3, margin: '0 auto 1rem' }} />
                  <div>No documents yet. Upload the first file above.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(cardDocs[docRoom.cardId] || []).map(doc => (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.875rem 1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', background: 'white' }}>
                      <FileText size={20} color="var(--color-primary)" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{doc.type} • {doc.size} • {doc.uploaded}</div>
                      </div>
                      <div className="flex gap-1">
                        <button className="action-btn" onClick={() => toast(`Downloading ${doc.name}...`, { icon: '⬇️' })}><Download size={15} /></button>
                        <button className="action-btn" style={{ color: 'var(--color-danger)' }} onClick={() => handleDocDelete(docRoom.cardId, doc.id)}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button className="btn btn-secondary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => handleDocUpload(docRoom.cardId)}>
                <Upload size={15} /> Upload File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CSR;
