import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ShieldCheck, Upload, Calendar, Users, X, CheckCircle2, AlertTriangle, Download, Plus, Shield, Trash2, RefreshCw, CheckSquare } from 'lucide-react';
import { useStore, type ComplianceDocument } from '../../store/useStore';
import RecordTasksPanel from '../../components/Common/RecordTasksPanel';
import { isVisibleToday } from '../../utils/tasks';
import toast from 'react-hot-toast';
import DPDPModule from './DPDPModule';
import './Compliance.css';
import { apiFetch } from '../../api/client';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import { useFocusFromUrl } from '../../hooks/useFocusFromUrl';
import {
  buildComplianceReminders,
  persistComplianceReminders,
  pickUntoastedReminders,
} from '../../utils/complianceReminders';

const PAGE_TABS = [
  { id: 'vault',  label: '📁 Registration Vault' },
  { id: 'dpdp',   label: '🛡️ DPDP Act 2023' },
];

type Filing = { id: number; name: string; due: string; assignee: string; status: string };

type BoardMember = { id: string; name: string; role: string; din: string; tenure?: string };

const Compliance: React.FC = () => {
  const { complianceDocs, setComplianceDocs } = useStore();
  const ngoDetails = useStore(s => s.ngoDetails);
  const [pageTab, setPageTab] = useState('vault');
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({
    name: '',
    type: 'Tax Exemption',
    status: 'Valid' as 'Valid' | 'Expiring Soon' | 'Expired',
    expiry: '',
    issuing_authority: '',
    registration_ref: '',
    review_notes: '',
  });
  const [vaultFiles, setVaultFiles] = useState<{ key: string; filename: string; size: number; last_modified: string }[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [showBoardModal, setShowBoardModal] = useState(false);
  const [boardForm, setBoardForm] = useState({ name: '', role: 'Trustee', din: '', tenure: '' });
  const [filings, setFilings] = useState<Filing[]>([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [tasksDoc, setTasksDoc] = useState<ComplianceDocument | null>(null);
  const allTasks = useStore(s => s.tasks);

  const regDocScrollRef = useRef<HTMLDivElement>(null);
  const regDocVirtualizer = useVirtualizer({
    count: complianceDocs.length,
    getScrollElement: () => regDocScrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  // Read `?focus=<docId>` (e.g. from a "Renew first" CTA in Agent HQ /
  // GrantDetail / Funding) and scroll/highlight the matching row.
  useFocusFromUrl('focus', {
    resolveIndex: (id) => {
      const idx = complianceDocs.findIndex(d => d.id === id);
      return idx >= 0 ? idx : null;
    },
    onScrollToIndex: (idx) => regDocVirtualizer.scrollToIndex(idx, { align: 'center' }),
  });

  const vaultTableScrollRef = useRef<HTMLDivElement>(null);
  const vaultRowVirtualizer = useVirtualizer({
    count: vaultFiles.length,
    getScrollElement: () => vaultTableScrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  const mapApiComplianceDoc = (d: Record<string, unknown>): ComplianceDocument => {
    const st = String(d.status ?? 'Valid');
    const status: ComplianceDocument['status'] =
      st === 'Expired' || st === 'Expiring Soon' ? st : 'Valid';
    const det = d.details;
    return {
      id: String(d.id ?? ''),
      name: String(d.name ?? ''),
      type: String(d.doc_type ?? ''),
      status,
      expiry: String(d.expiry_date ?? ''),
      uploadedAt: String(d.created_at ?? '').slice(0, 10),
      details:
        typeof det === 'object' && det !== null && !Array.isArray(det)
          ? (det as Record<string, unknown>)
          : undefined,
    };
  };

  const refreshRegistrationDocs = async () => {
    try {
      const res = await apiFetch('/compliance/documents');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.documents)) {
        setComplianceDocs(data.documents.map((x: Record<string, unknown>) => mapApiComplianceDoc(x)));
      }
    } catch {
      /* non-fatal */
    }
  };

  const refreshVault = async () => {
    setVaultLoading(true);
    try {
      const res = await apiFetch('/storage/files?folder=compliance');
      if (!res.ok) throw new Error('Failed to list vault files');
      const data = await res.json();
      setVaultFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      toast.error('Failed to load vault files.');
    } finally {
      setVaultLoading(false);
    }
  };

  useEffect(() => {
    if (pageTab !== 'vault') return;
    refreshVault();
    refreshRegistrationDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab]);

  const refreshBoard = async () => {
    setBoardLoading(true);
    try {
      const res = await apiFetch('/governance/board-members');
      if (!res.ok) throw new Error('board list failed');
      const data = await res.json();
      setBoardMembers(Array.isArray(data.members) ? data.members : []);
    } catch {
      toast.error('Failed to load board members.');
    } finally {
      setBoardLoading(false);
    }
  };

  useEffect(() => {
    if (pageTab !== 'vault') return;
    refreshBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab]);

  const refreshFilings = async () => {
    setFilingsLoading(true);
    try {
      const res = await apiFetch('/compliance/filings');
      if (!res.ok) throw new Error('filings');
      const data = await res.json();
      setFilings(Array.isArray(data.filings) ? data.filings : []);
    } catch {
      setFilings([]);
    } finally {
      setFilingsLoading(false);
    }
  };

  useEffect(() => {
    if (pageTab !== 'vault') return;
    refreshFilings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab]);

  const handleAddBoardMember = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/governance/board-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: boardForm.name,
          role: boardForm.role,
          din: boardForm.din,
          tenure: boardForm.tenure || undefined,
        }),
      });
      if (!res.ok) throw new Error('create failed');
      toast.success('Board member added.');
      setShowBoardModal(false);
      setBoardForm({ name: '', role: 'Trustee', din: '', tenure: '' });
      await refreshBoard();
    } catch {
      toast.error('Failed to add board member.');
    }
  };

  const handleDeleteBoardMember = async (id: string) => {
    try {
      const res = await apiFetch(`/governance/board-members/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      toast.success('Board member removed.');
      await refreshBoard();
    } catch {
      toast.error('Failed to remove board member.');
    }
  };

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please select a PDF file to upload.');
      return;
    }

    setUploading(true);
    try {
      const presignRes = await apiFetch('/storage/presigned-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: 'compliance',
          filename: selectedFile.name,
          content_type: selectedFile.type || 'application/pdf',
        }),
      });
      if (!presignRes.ok) throw new Error('presign failed');
      const presign = await presignRes.json();

      const putRes = await fetch(presign.url, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type || 'application/pdf' },
        body: selectedFile,
      });
      if (!putRes.ok) throw new Error('upload failed');

      // Persist metadata for unified Inbox/reporting (required so UI isn't fake)
      const metaRes = await apiFetch('/compliance/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: docForm.name || selectedFile.name,
          doc_type: docForm.type,
          status: docForm.status,
          expiry_date: docForm.expiry || null,
          s3_key: presign.key,
          details: {
            ...(docForm.issuing_authority.trim() ? { issuing_authority: docForm.issuing_authority.trim() } : {}),
            ...(docForm.registration_ref.trim() ? { registration_ref: docForm.registration_ref.trim() } : {}),
            ...(docForm.review_notes.trim() ? { review_notes: docForm.review_notes.trim() } : {}),
          },
        }),
      });
      if (!metaRes.ok) throw new Error('metadata failed');

      toast.success('Uploaded to Compliance Vault.');
      setDocForm({
        name: '',
        type: 'Tax Exemption',
        status: 'Valid',
        expiry: '',
        issuing_authority: '',
        registration_ref: '',
        review_notes: '',
      });
      setSelectedFile(null);
      setShowDocModal(false);
      await refreshVault();
      await refreshRegistrationDocs();
    } catch {
      toast.error('Upload failed. Check backend/S3 settings.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: { key: string; filename: string }) => {
    try {
      const res = await apiFetch('/storage/presigned-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: file.key, filename: file.filename }),
      });
      if (!res.ok) throw new Error('presign download failed');
      const data = await res.json();
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Failed to download file.');
    }
  };

  const handleDelete = async (key: string) => {
    try {
      const res = await apiFetch(`/storage/file?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      toast.success('File deleted.');
      await refreshVault();
    } catch {
      toast.error('Failed to delete file.');
    }
  };

  const handleFilingAction = async (filing: typeof filings[0]) => {
    try {
      const res = await apiFetch(`/compliance/filings/${encodeURIComponent(String(filing.id))}/package.pdf`);
      if (!res.ok) throw new Error('package');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `filing_package_${filing.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to prepare filing package.');
    }
  };

  const validDocs = complianceDocs.filter(d => d.status === 'Valid').length;
  const expiringSoon = complianceDocs.filter(d => d.status === 'Expiring Soon').length;

  // Recompute proactive reminders whenever filings or board change. We persist
  // to localStorage (so Today inbox can read them) and surface a one-time toast
  // per session for any newly-detected items.
  useEffect(() => {
    if (filingsLoading || boardLoading) return;
    const reminders = buildComplianceReminders(filings, boardMembers);
    persistComplianceReminders(reminders);
    const fresh = pickUntoastedReminders(reminders);
    for (const r of fresh.slice(0, 3)) {
      toast(r.text, {
        icon: r.level === 'urgent' ? '⚠️' : '🔔',
        duration: 5500,
      });
    }
  }, [filings, boardMembers, filingsLoading, boardLoading]);

  // Honour deep-links from the Today inbox: /compliance#filings or #board
  // scrolls and briefly highlights the relevant section. We re-run after
  // filings/board load so the target element actually exists in the DOM.
  useEffect(() => {
    if (pageTab !== 'vault') return;
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (hash !== 'filings' && hash !== 'board') return;
    const el = document.getElementById(hash);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.transition = 'box-shadow 0.4s ease';
    el.style.boxShadow = '0 0 0 3px var(--color-primary-light)';
    const t = window.setTimeout(() => { el.style.boxShadow = ''; }, 1800);
    return () => window.clearTimeout(t);
  }, [pageTab, filings.length, boardMembers.length]);

  return (
    <div className="compliance-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Compliance HQ</h1>
          <p className="page-subtitle">Statutory registrations, filings, board governance & DPDP Act 2023 compliance.</p>
          {/* NGO identity strip — reads from ngoDetails Zustand slice (single source of truth).
              Shown so document metadata, filing headers and health-report PDFs all reflect the
              same org identity without the user having to copy values from Settings. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            {ngoDetails.name && <span><strong style={{ color: 'var(--color-text)' }}>{ngoDetails.name}</strong></span>}
            {ngoDetails.reg_no && <span>Reg: <strong>{ngoDetails.reg_no}</strong></span>}
            {ngoDetails.pan && <span>PAN: <strong>{ngoDetails.pan}</strong></span>}
            {ngoDetails.fcra_reg && <span>FCRA: <strong>{ngoDetails.fcra_reg}</strong></span>}
            {ngoDetails.eighty_g_no && <span>80G: <strong>{ngoDetails.eighty_g_no}</strong></span>}
          </div>
        </div>
        <div className="flex gap-4">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              try {
                const res = await apiFetch('/compliance/health-report.pdf');
                if (!res.ok) throw new Error('report failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'compliance_health_report.pdf';
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error('Failed to download health report.');
              }
            }}
          >
            <Download size={16} /> Health Report
          </button>
          {pageTab === 'vault' && (
            <button className="btn btn-primary" onClick={() => setShowDocModal(true)}>
              <Upload size={16} /> Upload Document
            </button>
          )}
        </div>
      </div>

      {/* Page-level Tab Switcher */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--color-border-light)' }}>
        {PAGE_TABS.map(t => (
          <button key={t.id} onClick={() => setPageTab(t.id)}
            style={{ padding: '0.6rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: pageTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: pageTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', marginBottom: '-2px', transition: 'color 0.2s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* DPDP Module */}
      {pageTab === 'dpdp' && <DPDPModule />}

      {/* Registration Vault content — only shown on vault tab */}
      {pageTab === 'vault' && <>

      {/* Health Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="card" style={{ borderTop: '3px solid var(--color-success)', textAlign: 'center', padding: '1.5rem' }}>
          <CheckCircle2 size={28} color="var(--color-success)" style={{ margin: '0 auto 0.5rem' }} />
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{validDocs}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Documents Valid</div>
        </div>
        <div className="card" style={{ borderTop: '3px solid var(--color-warning)', textAlign: 'center', padding: '1.5rem' }}>
          <AlertTriangle size={28} color="var(--color-warning)" style={{ margin: '0 auto 0.5rem' }} />
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{expiringSoon}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Expiring Soon</div>
        </div>
        <div className="card" style={{ borderTop: '3px solid var(--color-primary)', textAlign: 'center', padding: '1.5rem' }}>
          <Calendar size={28} color="var(--color-primary)" style={{ margin: '0 auto 0.5rem' }} />
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{filings.length}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Upcoming Filings</div>
        </div>
      </div>

      {/* Document Vault */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title">📁 Registration Vault ({complianceDocs.length} documents)</h3>
          <div className="flex gap-2">
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }} onClick={refreshVault} disabled={vaultLoading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }} onClick={() => setShowDocModal(true)}>
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
        <div
          ref={regDocScrollRef}
          className="table-scroll-wrap"
          style={{
            maxHeight: 'min(50vh, 480px)',
            overflow: 'auto',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px,1.4fr) minmax(88px,1fr) minmax(88px,0.9fr) minmax(72px,0.75fr) minmax(100px,0.9fr)',
              gap: '0.5rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.68rem',
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
            <span>Document</span>
            <span>Type</span>
            <span>Status</span>
            <span>Expiry</span>
            <span>Action</span>
          </div>
          {complianceDocs.length === 0 ? (
            <div style={{ padding: '1.25rem', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>No registration documents.</div>
          ) : (
            <div style={{ height: regDocVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {regDocVirtualizer.getVirtualItems().map(vr => {
                const doc = complianceDocs[vr.index];
                return (
                  <div
                    key={doc.id}
                    data-index={vr.index}
                    data-focus-id={doc.id}
                    ref={regDocVirtualizer.measureElement}
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
                        gridTemplateColumns: 'minmax(120px,1.4fr) minmax(88px,1fr) minmax(88px,0.9fr) minmax(72px,0.75fr) minmax(100px,0.9fr)',
                        gap: '0.5rem',
                        padding: '0.65rem 0.75rem',
                        alignItems: 'center',
                        fontSize: '0.82rem',
                        borderBottom: '1px solid var(--color-border-light)',
                      }}
                    >
                      <span
                        style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={[
                          doc.name,
                          (doc.details?.registration_ref as string) && `Ref: ${doc.details?.registration_ref}`,
                          (doc.details?.issuing_authority as string) && `Authority: ${doc.details?.issuing_authority}`,
                        ].filter(Boolean).join(' · ')}
                      >
                        {doc.name}
                      </span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{doc.type}</span>
                      <span>
                        <span
                          className={`badge ${doc.status === 'Valid' ? 'badge-success' : ''}`}
                          style={
                            doc.status === 'Expiring Soon'
                              ? { background: '#fef3c7', color: '#92400e' }
                              : doc.status === 'Expired'
                                ? { background: '#fee2e2', color: '#991b1b' }
                                : {}
                          }
                        >
                          {doc.status}
                        </span>
                      </span>
                      <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.78rem' }}>{doc.expiry}</span>
                      <span style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {(() => {
                          const openTaskCount = allTasks.filter(t =>
                            t.relatedEntityType === 'compliance' &&
                            String(t.relatedEntityId) === String(doc.id) &&
                            isVisibleToday(t)
                          ).length;
                          return (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                              onClick={() => setTasksDoc(doc)}
                              title="Open tasks for this document"
                            >
                              <CheckSquare size={12} /> Tasks{openTaskCount ? ` (${openTaskCount})` : ''}
                            </button>
                          );
                        })()}
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                          disabled
                          title="Download from Cloud Vault below"
                        >
                          <Download size={14} /> Download
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cloud Vault (S3) */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title">☁️ Cloud Vault Files ({vaultFiles.length})</h3>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
            Stored per-NGO in S3 (or mock mode)
          </div>
        </div>
        <div
          ref={vaultTableScrollRef}
          className="table-scroll-wrap"
          style={{
            maxHeight: 'min(50vh, 480px)',
            overflow: 'auto',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px,1.5fr) minmax(72px,0.6fr) minmax(100px,1fr) minmax(160px,1.1fr)',
              gap: '0.5rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.68rem',
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
            <span>Filename</span>
            <span>Size</span>
            <span>Modified</span>
            <span>Actions</span>
          </div>
          {vaultLoading ? (
            <div style={{ padding: '1rem', color: 'var(--color-text-tertiary)' }}>Loading…</div>
          ) : vaultFiles.length === 0 ? (
            <div style={{ padding: '1rem', color: 'var(--color-text-tertiary)' }}>No files yet. Upload one above.</div>
          ) : (
            <div style={{ height: vaultRowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {vaultRowVirtualizer.getVirtualItems().map(vr => {
                const f = vaultFiles[vr.index];
                return (
                  <div
                    key={f.key}
                    data-index={vr.index}
                    ref={vaultRowVirtualizer.measureElement}
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
                        gridTemplateColumns: 'minmax(140px,1.5fr) minmax(72px,0.6fr) minmax(100px,1fr) minmax(160px,1.1fr)',
                        gap: '0.5rem',
                        padding: '0.65rem 0.75rem',
                        alignItems: 'center',
                        fontSize: '0.82rem',
                        borderBottom: '1px solid var(--color-border-light)',
                      }}
                    >
                      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.filename}</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                      <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.78rem' }}>{f.last_modified}</span>
                      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                          onClick={() => handleDownload(f)}
                        >
                          <Download size={14} /> Download
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.72rem',
                            color: 'var(--color-danger)',
                            borderColor: 'var(--color-danger)',
                          }}
                          onClick={() => handleDelete(f.key)}
                        >
                          <Trash2 size={14} /> Delete
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

      {/* Filing Calendar + Board */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div className="card" id="filings">
          <div className="card-header">
            <h3 className="card-title flex items-center gap-2"><Calendar size={18} /> Upcoming Filings</h3>
          </div>
          <div className="card-body">
            {filings.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 0', borderBottom: '1px solid var(--color-border-light)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{f.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Due: {f.due} • {f.assignee}</div>
                </div>
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleFilingAction(f)}>
                  Prepare
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="card" id="board">
          <div className="card-header">
            <h3 className="card-title flex items-center gap-2"><Users size={18} /> Board of Trustees</h3>
          </div>
          <div className="card-body">
            {boardLoading ? (
              <div style={{ padding: '1rem', color: 'var(--color-text-tertiary)' }}>Loading…</div>
            ) : boardMembers.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 0', borderBottom: '1px solid var(--color-border-light)' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                  {m.name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{m.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{m.role} • {m.din} • {m.tenure}</div>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                  onClick={() => handleDeleteBoardMember(m.id)}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="flex gap-2" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.875rem' }} onClick={refreshBoard} disabled={boardLoading}>
                Refresh
              </button>
              <button className="btn btn-primary" style={{ flex: 2, fontSize: '0.875rem' }} onClick={() => setShowBoardModal(true)}>
                <Plus size={14} /> Add Board Member
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Board Member Modal */}
      {showBoardModal && (
        <ModalOverlay onBackdropClick={() => setShowBoardModal(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="comp-board-title"
          >
            <button type="button" onClick={() => setShowBoardModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="comp-board-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>Add Board Member</h2>
            <form onSubmit={handleAddBoardMember} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required type="text" className="input-field" value={boardForm.name} onChange={e => setBoardForm({ ...boardForm, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Role</label>
                <select className="input-field" value={boardForm.role} onChange={e => setBoardForm({ ...boardForm, role: e.target.value })}>
                  {['Chairperson', 'Treasurer', 'Secretary', 'Trustee'].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">DIN</label>
                <input required type="text" className="input-field" placeholder="DIN00****99" value={boardForm.din} onChange={e => setBoardForm({ ...boardForm, din: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Tenure (optional)</label>
                <input type="text" className="input-field" placeholder="Since 2026" value={boardForm.tenure} onChange={e => setBoardForm({ ...boardForm, tenure: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Add Member</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {showDocModal && (
        <ModalOverlay onBackdropClick={() => !uploading && setShowDocModal(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="comp-doc-title"
          >
            <button type="button" disabled={uploading} onClick={() => setShowDocModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="comp-doc-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>Upload Compliance Document</h2>
            <form onSubmit={handleAddDoc} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Document Name</label>
                <input required type="text" className="input-field" placeholder="e.g. 80G Renewal Certificate" value={docForm.name} onChange={e => setDocForm({ ...docForm, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Document Type</label>
                <select className="input-field" value={docForm.type} onChange={e => setDocForm({ ...docForm, type: e.target.value })}>
                  {['Tax Exemption', 'Donor Deduction', 'Foreign Contribution', 'CSR Eligibility', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Expiry Date</label>
                <input required type="date" className="input-field" value={docForm.expiry} onChange={e => setDocForm({ ...docForm, expiry: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Status</label>
                <select className="input-field" value={docForm.status} onChange={e => setDocForm({ ...docForm, status: e.target.value as any })}>
                  <option>Valid</option>
                  <option>Expiring Soon</option>
                  <option>Expired</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Issuing authority (optional)</label>
                <input type="text" className="input-field" placeholder="e.g. Income Tax / MCA" value={docForm.issuing_authority} onChange={e => setDocForm({ ...docForm, issuing_authority: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Registration / certificate ref (optional)</label>
                <input type="text" className="input-field" value={docForm.registration_ref} onChange={e => setDocForm({ ...docForm, registration_ref: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Internal review notes (optional)</label>
                <textarea className="input-field" rows={2} value={docForm.review_notes} onChange={e => setDocForm({ ...docForm, review_notes: e.target.value })} />
              </div>
              <div style={{ border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
                <Upload size={20} style={{ margin: '0 auto 0.5rem' }} />
                <div style={{ marginBottom: '0.5rem' }}>
                  {selectedFile ? <strong>{selectedFile.name}</strong> : 'Select a PDF to upload'}
                </div>
                <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => fileInputRef.current?.click()}>
                  Choose File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload to Vault'}
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}
      </>}

      {tasksDoc && (
        <ModalOverlay onBackdropClick={() => setTasksDoc(null)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="comp-tasks-title"
            style={{ maxWidth: '560px' }}
          >
            <button
              type="button"
              onClick={() => setTasksDoc(null)}
              aria-label="Close"
              className="action-btn"
              style={{ position: 'absolute', right: '1rem', top: '1rem' }}
            >
              <X size={20} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', paddingRight: '2.5rem' }}>
              <CheckSquare size={18} color="var(--color-primary)" />
              <h2 id="comp-tasks-title" style={{ margin: 0, fontSize: '1.05rem' }}>Tasks · {tasksDoc.name}</h2>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>
              {tasksDoc.type} · expires {tasksDoc.expiry || '—'}
            </div>
            <RecordTasksPanel
              entityType="compliance"
              entityId={String(tasksDoc.id)}
              entityLabel={tasksDoc.name}
            />
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default Compliance;
