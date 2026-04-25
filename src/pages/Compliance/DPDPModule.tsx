import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Shield, UserCheck, Trash2, AlertOctagon, FileText, Plus, X, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ConsentRecord {
  id: string; subject: string; type: string; email: string;
  purpose: string; given: boolean; date: string; withdrawn?: string;
}
interface ErasureRequest {
  id: string; name: string; email: string; reason: string;
  status: 'received' | 'in_review' | 'completed' | 'rejected';
  received: string; deadline: string; completed?: string;
}
interface BreachRecord {
  id: string; title: string; severity: 'low' | 'medium' | 'high' | 'critical';
  affectedRecords: number; discovered: string; notificationDue: string;
  notified: boolean; description: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  low:'#d1fae5', medium:'#fef3c7', high:'#fee2e2', critical:'#fce7f3',
};
const SEVERITY_TEXT: Record<string, string> = {
  low:'#065f46', medium:'#92400e', high:'#991b1b', critical:'#831843',
};
const STATUS_STYLE: Record<string, {bg:string;color:string}> = {
  received:    { bg:'#eff6ff', color:'#1e40af' },
  in_review:   { bg:'#fef3c7', color:'#92400e' },
  completed:   { bg:'#d1fae5', color:'#065f46' },
  rejected:    { bg:'#fee2e2', color:'#991b1b' },
};

const DPDP_TABS = [
  { id:'consent',   label:'Consent Registry',      icon:<UserCheck size={15}/> },
  { id:'erasure',   label:'Erasure Requests',       icon:<Trash2 size={15}/> },
  { id:'breach',    label:'Breach Log',             icon:<AlertOctagon size={15}/> },
  { id:'notice',    label:'Data Fiduciary Notice',  icon:<FileText size={15}/> },
];

const DPDPModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState('consent');
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [erasures, setErasures] = useState<ErasureRequest[]>([]);
  const [breaches, setBreaches] = useState<BreachRecord[]>([]);
  const [showErasureModal, setShowErasureModal] = useState(false);
  const [showBreachModal, setShowBreachModal] = useState(false);
  const [erasureForm, setErasureForm] = useState({ name:'', email:'', reason:'' });
  const [breachForm, setBreachForm] = useState({ title:'', severity:'medium' as BreachRecord['severity'], affectedRecords:0, description:'' });
  const [noticeMd, setNoticeMd] = useState<string>('');
  const [noticeVersion, setNoticeVersion] = useState<number | null>(null);
  const [noticeLoading, setNoticeLoading] = useState(false);

  const consentScrollRef = useRef<HTMLDivElement>(null);
  const consentVirtualizer = useVirtualizer({
    count: consents.length,
    getScrollElement: () => consentScrollRef.current,
    estimateSize: () => 58,
    overscan: 14,
  });

  const erasureScrollRef = useRef<HTMLDivElement>(null);
  const erasureVirtualizer = useVirtualizer({
    count: erasures.length,
    getScrollElement: () => erasureScrollRef.current,
    estimateSize: () => 112,
    overscan: 8,
  });

  const breachScrollRef = useRef<HTMLDivElement>(null);
  const breachVirtualizer = useVirtualizer({
    count: breaches.length,
    getScrollElement: () => breachScrollRef.current,
    estimateSize: () => 168,
    overscan: 6,
  });

  const refresh = async () => {
    try {
      const [cRes, eRes, bRes] = await Promise.all([
        apiFetch('/compliance/consents'),
        apiFetch('/compliance/erasures'),
        apiFetch('/compliance/breaches'),
      ]);
      if (cRes.ok) {
        const data = await cRes.json();
        setConsents(Array.isArray(data.consents) ? data.consents : []);
      }
      if (eRes.ok) {
        const data = await eRes.json();
        setErasures(Array.isArray(data.requests) ? data.requests : []);
      }
      if (bRes.ok) {
        const data = await bRes.json();
        setBreaches(Array.isArray(data.breaches) ? data.breaches : []);
      }
    } catch {
      // keep empty
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleWithdrawConsent = async (id: string) => {
    try {
      const res = await apiFetch('/compliance/consent/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent_id: id })
      });
      if (res.ok) {
        await refresh();
        toast('Consent withdrawn. Subject will not receive further communications.', { icon:'📋', duration:4000 });
      }
    } catch (e) { toast.error("Failed to withdraw consent."); }
  };

  const handleAddErasure = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/compliance/erasure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(erasureForm)
      });
      const data = await res.json();
      if (res.ok) {
        await refresh();
        setErasureForm({ name:'', email:'', reason:'' });
        setShowErasureModal(false);
        toast.success(data.message || 'Erasure request logged. Must be completed within 30 days (DPDP §12).', { duration:5000 });
      }
    } catch (e) { toast.error("Failed to log erasure request."); }
  };

  const handleCompleteErasure = async (id: string) => {
    try {
      const res = await apiFetch(`/compliance/erasure/${encodeURIComponent(id)}/complete`, { method: 'POST' });
      if (!res.ok) throw new Error('complete');
      await refresh();
      toast.success('Erasure completed and logged.', { icon:'✅' });
    } catch {
      toast.error('Failed to mark complete.');
    }
  };

  const handleAddBreach = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/compliance/breach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: breachForm.title,
          severity: breachForm.severity,
          affected_records: breachForm.affectedRecords,
          description: breachForm.description
        })
      });
      const data = await res.json();
      if (res.ok) {
        await refresh();
        setBreachForm({ title:'', severity:'medium', affectedRecords:0, description:'' });
        setShowBreachModal(false);
        toast('⚠️ ' + (data.message || 'Breach logged. You must notify the DPB within 72 hours (DPDP §8).'), { duration:6000 });
      }
    } catch (e) { toast.error("Failed to log breach."); }
  };

  const handleNotifyDPB = async (id: string) => {
    try {
      const res = await apiFetch(`/compliance/breaches/${encodeURIComponent(id)}/notify`, { method: 'POST' });
      if (!res.ok) throw new Error('notify');
      await refresh();
      toast.success('DPB notification sent and logged.', { icon:'📨' });
    } catch {
      toast.error('Failed to notify DPB.');
    }
  };

  const card: React.CSSProperties = {
    background:'var(--color-bg-card)', border:'1px solid var(--color-border-light)',
    borderRadius:'var(--radius-lg)', padding:'1.5rem', marginBottom:'1.5rem',
  };

  return (
    <div style={{ marginTop:'2rem' }}>
      {/* DPDP Header Banner */}
      <div style={{ padding:'0.875rem 1.25rem', background:'linear-gradient(135deg,#eff6ff,#f0fdf4)', border:'1px solid #bfdbfe', borderRadius:'var(--radius-md)', marginBottom:'1.5rem', display:'flex', alignItems:'center', gap:'0.75rem' }}>
        <Shield size={20} color='#2563eb'/>
        <div>
          <span style={{ fontWeight:700, color:'#1e40af', fontSize:'0.875rem' }}>Digital Personal Data Protection Act 2023</span>
          <span style={{ color:'#3730a3', fontSize:'0.8rem', marginLeft:'0.75rem' }}>Enforcement active from 2025 · Max penalty ₹250 crore</span>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1.5rem', borderBottom:'2px solid var(--color-border-light)', paddingBottom:'0' }}>
        {DPDP_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.6rem 1rem', fontSize:'0.8rem', fontWeight:600,
              border:'none', background:'none', cursor:'pointer', borderBottom: activeTab===t.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab===t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', marginBottom:'-2px', transition:'color 0.2s' }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Consent Registry ──────────────────────────────────────────────── */}
      {activeTab==='consent' && (
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <h4 style={{ margin:0, fontWeight:700 }}>Consent Registry <span style={{ color:'var(--color-text-tertiary)', fontWeight:400, fontSize:'0.8rem' }}>({consents.length} records)</span></h4>
            <div style={{ fontSize:'0.75rem', color:'var(--color-text-secondary)' }}>
              ✅ {consents.filter(c=>c.given).length} active &nbsp;·&nbsp; ❌ {consents.filter(c=>!c.given).length} withdrawn
            </div>
          </div>
          <div
            ref={consentScrollRef}
            className="table-scroll-wrap"
            style={{
              maxHeight: 'min(52vh, 500px)',
              overflow: 'auto',
              border: '1px solid var(--color-border-light)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(100px,1.1fr) minmax(72px,0.75fr) minmax(100px,1.2fr) minmax(80px,0.85fr) minmax(88px,0.85fr) 72px',
                gap: '0.4rem',
                padding: '0.55rem 0.65rem',
                fontSize: '0.65rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                color: 'var(--color-text-secondary)',
                borderBottom: '1px solid var(--color-border-light)',
                position: 'sticky',
                top: 0,
                background: 'var(--color-bg-main)',
                zIndex: 1,
              }}
            >
              <span>Subject</span>
              <span>Type</span>
              <span>Purpose</span>
              <span>Status</span>
              <span>Date</span>
              <span>Act</span>
            </div>
            {consents.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
                No consent records yet.
              </div>
            ) : (
              <div style={{ height: consentVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                {consentVirtualizer.getVirtualItems().map(vr => {
                  const c = consents[vr.index];
                  return (
                    <div
                      key={c.id}
                      data-index={vr.index}
                      ref={consentVirtualizer.measureElement}
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
                          gridTemplateColumns: 'minmax(100px,1.1fr) minmax(72px,0.75fr) minmax(100px,1.2fr) minmax(80px,0.85fr) minmax(88px,0.85fr) 72px',
                          gap: '0.4rem',
                          padding: '0.5rem 0.65rem',
                          alignItems: 'center',
                          fontSize: '0.8rem',
                          borderBottom: '1px solid var(--color-border-light)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{c.subject}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{c.email}</div>
                        </div>
                        <span>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 6px',
                              borderRadius: 99,
                              background: 'var(--color-bg-main)',
                              border: '1px solid var(--color-border)',
                            }}
                          >
                            {c.type}
                          </span>
                        </span>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.purpose}
                        </span>
                        <span>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 6px',
                              borderRadius: 99,
                              background: c.given ? '#d1fae5' : '#fee2e2',
                              color: c.given ? '#065f46' : '#991b1b',
                              fontWeight: 600,
                            }}
                          >
                            {c.given ? 'Given' : 'Out'}
                          </span>
                        </span>
                        <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
                          {c.date}
                          {c.withdrawn && (
                            <div style={{ fontSize: '0.68rem', color: '#991b1b' }}>W: {c.withdrawn}</div>
                          )}
                        </div>
                        <span>
                          {c.given && (
                            <button
                              type="button"
                              onClick={() => handleWithdrawConsent(c.id)}
                              style={{
                                fontSize: '0.68rem',
                                padding: '3px 6px',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-sm)',
                                background: 'none',
                                cursor: 'pointer',
                                color: 'var(--color-text-secondary)',
                              }}
                            >
                              Withdraw
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Erasure Requests ──────────────────────────────────────────────── */}
      {activeTab==='erasure' && (
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <h4 style={{ margin:0, fontWeight:700 }}>Right to Erasure Requests <span style={{ color:'var(--color-text-tertiary)', fontWeight:400, fontSize:'0.8rem' }}>DPDP §12 · 30-day deadline</span></h4>
            <button onClick={()=>setShowErasureModal(true)} className="btn btn-primary" style={{ fontSize:'0.8rem', padding:'0.4rem 0.875rem', display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <Plus size={14}/> Log Request
            </button>
          </div>
          {erasures.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: '1.5rem' }}>No erasure requests logged.</div>
          ) : (
            <div
              ref={erasureScrollRef}
              style={{ maxHeight: 'min(52vh, 520px)', overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}
            >
              <div style={{ height: erasureVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                {erasureVirtualizer.getVirtualItems().map(vr => {
                  const r = erasures[vr.index];
                  const s = STATUS_STYLE[r.status];
                  const overdue = r.status !== 'completed' && r.status !== 'rejected' && new Date(r.deadline) < new Date();
                  return (
                    <div
                      key={r.id}
                      data-index={vr.index}
                      ref={erasureVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vr.start}px)`,
                        paddingBottom: '0.65rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '1rem',
                          border: overdue ? '1px solid #fca5a5' : '1px solid var(--color-border-light)',
                          borderRadius: 'var(--radius-md)',
                          background: overdue ? '#fff5f5' : 'var(--color-bg-card)',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1, paddingRight: '0.75rem' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                            {r.name}{' '}
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 400 }}>— {r.email}</span>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: '0.25rem 0' }}>{r.reason}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                            <span>Received: {r.received}</span>
                            <span style={{ color: overdue ? '#dc2626' : 'inherit' }}>
                              <Clock size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> Deadline: {r.deadline}
                              {overdue ? ' OVERDUE' : ''}
                            </span>
                            {r.completed && <span style={{ color: '#059669' }}>Completed: {r.completed}</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.color, fontWeight: 600 }}>
                            {r.status.replace('_', ' ')}
                          </span>
                          {(r.status === 'received' || r.status === 'in_review') && (
                            <button
                              type="button"
                              onClick={() => handleCompleteErasure(r.id)}
                              style={{
                                fontSize: '0.72rem',
                                padding: '4px 10px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid #059669',
                                background: 'none',
                                color: '#059669',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              Mark Complete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Breach Log ────────────────────────────────────────────────────── */}
      {activeTab==='breach' && (
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <h4 style={{ margin:0, fontWeight:700 }}>Security Breach Log <span style={{ color:'var(--color-text-tertiary)', fontWeight:400, fontSize:'0.8rem' }}>DPDP §8 · 72-hr DPB notification</span></h4>
            <button onClick={()=>setShowBreachModal(true)} className="btn btn-primary" style={{ fontSize:'0.8rem', padding:'0.4rem 0.875rem', display:'flex', alignItems:'center', gap:'0.4rem', background:'var(--color-danger)' }}>
              <AlertOctagon size={14}/> Log Breach
            </button>
          </div>
          {breaches.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: '2rem' }}>No breaches logged — great!</div>
          ) : (
            <div
              ref={breachScrollRef}
              style={{ maxHeight: 'min(55vh, 560px)', overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}
            >
              <div style={{ height: breachVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                {breachVirtualizer.getVirtualItems().map(vr => {
                  const b = breaches[vr.index];
                  const notifDue = new Date(b.notificationDue);
                  const overdue = !b.notified && notifDue < new Date();
                  return (
                    <div
                      key={b.id}
                      data-index={vr.index}
                      ref={breachVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vr.start}px)`,
                        paddingBottom: '0.65rem',
                      }}
                    >
                      <div
                        style={{
                          padding: '1rem',
                          border: `1px solid ${SEVERITY_COLORS[b.severity]}`,
                          borderLeft: `4px solid ${SEVERITY_TEXT[b.severity]}`,
                          borderRadius: 'var(--radius-md)',
                          background: overdue ? '#fff5f5' : 'var(--color-bg-card)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  padding: '2px 8px',
                                  borderRadius: 99,
                                  background: SEVERITY_COLORS[b.severity],
                                  color: SEVERITY_TEXT[b.severity],
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                }}
                              >
                                {b.severity}
                              </span>
                              <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>{b.title}</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{b.description}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                              <span>Discovered: {new Date(b.discovered).toLocaleString('en-IN')}</span>
                              <span>Affected: {b.affectedRecords.toLocaleString()} records</span>
                              <span style={{ color: overdue ? '#dc2626' : '#92400e' }}>
                                <Clock size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> DPB notify by:{' '}
                                {notifDue.toLocaleString('en-IN')}
                                {overdue ? ' OVERDUE' : ''}
                              </span>
                            </div>
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            {b.notified ? (
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  padding: '4px 10px',
                                  borderRadius: 99,
                                  background: '#d1fae5',
                                  color: '#065f46',
                                  fontWeight: 600,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <CheckCircle2 size={12} />
                                DPB Notified
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleNotifyDPB(b.id)}
                                style={{
                                  fontSize: '0.72rem',
                                  padding: '5px 12px',
                                  borderRadius: 'var(--radius-sm)',
                                  border: '1px solid #dc2626',
                                  background: '#dc2626',
                                  color: 'white',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                Notify DPB
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Data Fiduciary Notice ────────────────────────────────────────── */}
      {activeTab==='notice' && (
        <div style={card}>
          <h4 style={{ margin:'0 0 1rem', fontWeight:700 }}>Data Fiduciary Notice <span style={{ color:'var(--color-text-tertiary)', fontWeight:400, fontSize:'0.8rem' }}>DPDP §5 — must be displayed to all data principals</span></h4>
          <div style={{ background:'var(--color-bg-main)', border:'1px solid var(--color-border-light)', borderRadius:'var(--radius-md)', padding:'1rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
              <div style={{ fontSize:'0.75rem', color:'var(--color-text-tertiary)' }}>
                {noticeVersion ? `Version: ${noticeVersion}` : 'Version: —'}
              </div>
              <button
                className="btn btn-secondary"
                style={{ fontSize:'0.75rem', padding:'0.25rem 0.75rem' }}
                disabled={noticeLoading}
                onClick={async () => {
                  setNoticeLoading(true);
                  try {
                    const res = await apiFetch('/dpdp/notice');
                    if (!res.ok) throw new Error('load failed');
                    const data = await res.json();
                    setNoticeMd(data.notice_md || '');
                    setNoticeVersion(data.version || null);
                  } catch {
                    toast.error('Failed to load notice.');
                  } finally {
                    setNoticeLoading(false);
                  }
                }}
              >
                {noticeLoading ? 'Loading…' : 'Reload'}
              </button>
            </div>
            <textarea
              className="input-field"
              rows={10}
              style={{ width:'100%', fontFamily:'inherit' }}
              value={noticeMd}
              onChange={(e) => setNoticeMd(e.target.value)}
              placeholder="Write your DPDP notice here (markdown)."
            />
          </div>
          <div style={{ display:'flex', gap:'0.75rem', marginTop:'1rem' }}>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  const res = await apiFetch('/dpdp/notice.pdf');
                  if (!res.ok) throw new Error('pdf failed');
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `dpdp_notice_v${noticeVersion || 1}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  toast.error('Failed to download PDF.');
                }
              }}
            >
              Download PDF
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const res = await apiFetch('/dpdp/notice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notice_md: noticeMd }),
                  });
                  if (!res.ok) throw new Error('save failed');
                  const data = await res.json();
                  setNoticeVersion(data.version || noticeVersion);
                  toast.success(`Notice saved as version ${data.version}.`);
                } catch {
                  toast.error('Failed to save notice.');
                }
              }}
            >
              Save New Version
            </button>
          </div>
        </div>
      )}

      {/* ── Erasure Modal ─────────────────────────────────────────────────── */}
      {showErasureModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'blur(4px)' }}>
          <div className="card" style={{ width:440, padding:'1.5rem', position:'relative' }}>
            <button onClick={()=>setShowErasureModal(false)} style={{ position:'absolute', right:'1rem', top:'1rem' }} className="action-btn"><X size={18}/></button>
            <h3 style={{ marginBottom:'1.25rem' }}>Log Erasure Request (DPDP §12)</h3>
            <form onSubmit={handleAddErasure} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom:0 }}><label className="input-label">Full Name</label>
                <input required className="input-field" value={erasureForm.name} onChange={e=>setErasureForm({...erasureForm,name:e.target.value})} placeholder="Data subject's name"/></div>
              <div className="input-group" style={{ marginBottom:0 }}><label className="input-label">Email</label>
                <input required type="email" className="input-field" value={erasureForm.email} onChange={e=>setErasureForm({...erasureForm,email:e.target.value})} placeholder="data@subject.com"/></div>
              <div className="input-group" style={{ marginBottom:0 }}><label className="input-label">Reason for Erasure</label>
                <textarea className="input-field" rows={3} value={erasureForm.reason} onChange={e=>setErasureForm({...erasureForm,reason:e.target.value})} placeholder="As stated by the data principal..."/></div>
              <button type="submit" className="btn btn-primary" style={{ width:'100%' }}>Log Request (30-day clock starts now)</button>
            </form>
          </div>
        </div>
      )}

      {/* ── Breach Modal ──────────────────────────────────────────────────── */}
      {showBreachModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'blur(4px)' }}>
          <div className="card" style={{ width:480, padding:'1.5rem', position:'relative' }}>
            <button onClick={()=>setShowBreachModal(false)} style={{ position:'absolute', right:'1rem', top:'1rem' }} className="action-btn"><X size={18}/></button>
            <h3 style={{ marginBottom:'1.25rem' }}>Log Security Breach (DPDP §8)</h3>
            <div style={{ padding:'0.75rem', background:'#fff7ed', borderRadius:'var(--radius-sm)', border:'1px solid #fed7aa', marginBottom:'1rem', fontSize:'0.8rem', color:'#92400e' }}>
              <AlertTriangle size={14} style={{ display:'inline', verticalAlign:'middle', marginRight:6 }}/>
              You must notify the Data Protection Board within <strong>72 hours</strong> of discovery.
            </div>
            <form onSubmit={handleAddBreach} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom:0 }}><label className="input-label">Breach Title</label>
                <input required className="input-field" value={breachForm.title} onChange={e=>setBreachForm({...breachForm,title:e.target.value})} placeholder="Brief description of the incident"/></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <div className="input-group" style={{ marginBottom:0 }}><label className="input-label">Severity</label>
                  <select className="input-field" value={breachForm.severity} onChange={e=>setBreachForm({...breachForm,severity:e.target.value as any})}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                  </select></div>
                <div className="input-group" style={{ marginBottom:0 }}><label className="input-label">Affected Records</label>
                  <input type="number" className="input-field" value={breachForm.affectedRecords} onChange={e=>setBreachForm({...breachForm,affectedRecords:parseInt(e.target.value)||0})}/></div>
              </div>
              <div className="input-group" style={{ marginBottom:0 }}><label className="input-label">Description & Remediation</label>
                <textarea className="input-field" rows={3} value={breachForm.description} onChange={e=>setBreachForm({...breachForm,description:e.target.value})} placeholder="What happened, what data was affected, what steps were taken..."/></div>
              <button type="submit" className="btn btn-primary" style={{ width:'100%', background:'var(--color-danger)' }}>Log Breach (72-hr timer starts)</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DPDPModule;
