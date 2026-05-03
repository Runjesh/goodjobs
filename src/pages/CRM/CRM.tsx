import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search, Filter, MessageCircle, Mail, Phone, MapPin,
  IndianRupee, Clock, CheckCircle, X, UserPlus, Edit, Trash2,
  Download, Upload, Users, Send, ChevronDown, ChevronUp, Zap, Loader2, Mic, Bot,
  AlertTriangle, ArrowRight
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import { deriveNextAction } from '../../utils/donorNextAction';
import { parseCsvToRecords } from '../../utils/csvParse';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import StageBadge from '../../components/Donor/StageBadge';
import TouchpointTimeline from '../../components/Donor/TouchpointTimeline';
import {
  computeStage,
  nextDueMilestone,
  urgencyScore,
  markMilestoneDone,
  STAGE_FILTER_OPTIONS,
  STAGE_META,
  type LifecycleStage,
} from '../../utils/donorLifecycle';
import './CRM.css';

const WA_TEMPLATES = [
  { id: 'thank', label: 'Thank You', body: 'Namaste {name}! 🙏 Thank you for your generous donation of ₹{amount}. Your support directly helps {cause}. Your 80G certificate has been sent to your email.' },
  { id: 'reactivate', label: 'Re-engagement', body: 'Namaste {name}! We miss you. It\'s been a while since your last gift. Even ₹500 makes a difference — reply if you\'d like an update or a giving link.' },
  { id: 'impact', label: 'Impact Update', body: 'Dear {name}, your donations have helped 450 girls get digital literacy training this year 🎓 See the full impact report: [link]. Thank you for being part of this journey!' },
  { id: 'event', label: 'Event Invite', body: 'Dear {name}, you\'re invited to our Annual Gala on Dec 15th in Mumbai 🌟 As a valued donor, your seat is reserved. RSVP: [link]' },
];

const CSV_TEMPLATE = 'name,type,pan,location,email,phone,employer\nAnita Sharma,Recurring,ABCDE1234F,"Mumbai, Maharashtra",a@x.com,9876500000,Acme\nRaj Kumar,Major Donor,XYZAB5678G,"Delhi, NCR",,,';

const CRM: React.FC = () => {
  const { donors, transactions, addDonor, updateDonor, deleteDonor } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusFromUrl = searchParams.get('focus') || '';
  const [activeDonorId, setActiveDonorId] = useState<string>(focusFromUrl || String(donors[0]?.id || ''));

  // Sync from ?focus=ID — when arriving via Command Palette deep link.
  useEffect(() => {
    if (!focusFromUrl) return;
    if (donors.some(d => String(d.id) === focusFromUrl)) {
      setActiveDonorId(focusFromUrl);
      setViewMode('list');
      // Strip the param so subsequent navigation isn't sticky.
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }
  }, [focusFromUrl, donors, searchParams, setSearchParams]);
  const [viewMode, setViewMode] = useState<'list' | 'heatmap'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddContact, setShowAddContact] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [showCSVImport, setShowCSVImport] = useState(false);
  const [composerChannel, setComposerChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [selectedTemplate, setSelectedTemplate] = useState(WA_TEMPLATES[0]);
  const [customMessage, setCustomMessage] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [newContact, setNewContact] = useState({
    name: '',
    type: 'Recurring',
    pan: '',
    location: '',
    email: '',
    phone: '',
    employer: '',
    notes: '',
    preferredChannel: 'whatsapp',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [propensity, setPropensity] = useState<{score: number, recommendation: string, insights?: any} | null>(null);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [sentiment, setSentiment] = useState<{sentiment: string, score: number} | null>(null);
  const [propensityLoading, setPropensityLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [showEditContact, setShowEditContact] = useState(false);
  const [editContact, setEditContact] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!activeDonorId || viewMode === 'heatmap') return;
    
    const fetchPropensity = async () => {
      setPropensityLoading(true);
      try {
        const res = await apiFetch(`/analytics/donor-propensity/${activeDonorId}`);
        if (res.ok) {
          const data = await res.json();
          setPropensity({ score: data.propensity_score, recommendation: data.recommendation, insights: data.insights });
        }
      } catch (err) {
        console.error("Failed to fetch propensity:", err);
      } finally {
        setPropensityLoading(false);
      }
    };

    const fetchAiInsights = async () => {
      setAiLoading(true);
      try {
        const headers = { 'Content-Type': 'application/json' };
        
        // Fetch Summary
        const sumRes = await apiFetch('/gen-ai/summarize', {
          method: 'POST',
          headers,
          body: JSON.stringify([
            { sender: 'Donor', text: 'I really like the work you are doing for girls education.' },
            { sender: 'GoodJobs', text: 'Thank you Anjali! Your support makes it possible.' },
            { sender: 'Donor', text: 'When is the next site visit? I would like to join.' }
          ])
        });
        
        // Fetch Sentiment
        const sentRes = await apiFetch(`/gen-ai/sentiment?text=${encodeURIComponent("I am very happy with the progress reports.")}`, {
          method: 'POST',
          headers
        });

        if (sumRes.ok) {
          const sumData = await sumRes.json();
          setAiSummary(sumData.summary);
        }
        if (sentRes.ok) {
          const sentData = await sentRes.json();
          setSentiment({ sentiment: sentData.sentiment, score: sentData.score });
        }
      } catch (err) {
        console.error("Failed to fetch AI insights:", err);
      } finally {
        setAiLoading(false);
      }
    };

    fetchPropensity();
    fetchAiInsights();
  }, [activeDonorId, viewMode]);

  // Lifecycle: stage filter for Nurture Queue + tick to refresh after Approve & Send.
  const [stageFilter, setStageFilter] = useState<LifecycleStage | 'all'>('all');
  const [lifecycleTick, setLifecycleTick] = useState(0);

  const donorStages = useMemo(() => {
    void lifecycleTick;
    const map = new Map<string, LifecycleStage>();
    for (const d of donors) map.set(String(d.id), computeStage(d));
    return map;
  }, [donors, lifecycleTick]);

  const nurtureQueue = useMemo(() => {
    void lifecycleTick;
    const isDormantView = activeFilter === 'Dormant';
    const candidates = donors
      .map(d => {
        const stage = donorStages.get(String(d.id)) ?? 'unknown';
        const next  = nextDueMilestone(d);
        return { donor: d, stage, next, score: urgencyScore(d) };
      })
      .filter(x => {
        if (isDormantView) return x.stage === 'lapsed';
        if (stageFilter !== 'all') return x.stage === stageFilter;
        // Default: show donors that need a touchpoint OR are at risk.
        return (x.next && (x.next.state === 'due' || x.next.state === 'overdue'))
            || x.stage === 'lapse_risk' || x.stage === 'lapsed';
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, isDormantView ? 12 : 6);
    return candidates;
  }, [donors, donorStages, stageFilter, activeFilter, lifecycleTick]);

  // Tracks in-flight Approve & Send calls so we don't double-submit and so
  // the UI can disable buttons while a request is pending.  Key = `${donorId}:${milestoneId}`.
  const [pendingNurture, setPendingNurture] = useState<Set<string>>(new Set());

  const handleNurtureAction = useCallback(async (
    donorId: string,
    milestoneId: 'thankyou' | 'impact' | 'fullimpact' | 'renewal',
  ): Promise<boolean> => {
    const key = `${donorId}:${milestoneId}`;
    if (pendingNurture.has(key)) return false;
    setPendingNurture(prev => { const n = new Set(prev); n.add(key); return n; });
    try {
      const template = milestoneId === 'renewal'  ? WA_TEMPLATES.find(t => t.id === 'reactivate')
                     : milestoneId === 'thankyou' ? WA_TEMPLATES.find(t => t.id === 'thank')
                     :                              WA_TEMPLATES.find(t => t.id === 'impact');
      let success = false;
      try {
        const res = await apiFetch('/crm/outreach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'draft',
            channel: 'whatsapp',
            donor_ids: [donorId],
            template_id: template?.id,
            message: (template?.body || '').toString(),
          }),
        });
        success = res.ok;
      } catch {
        success = false;
      }
      // DEV fallback: with no backend the API will fail; treat as success in
      // dev so demo flows still work end-to-end.
      if (!success && import.meta.env.DEV) success = true;

      if (success) {
        // Only mark the milestone as completed AFTER the outreach actually
        // succeeded.  Failures leave the milestone in its overdue/due state
        // so it stays in the queue until a real send happens.
        markMilestoneDone(donorId, milestoneId);
        setLifecycleTick(t => t + 1);
        toast.success('Touchpoint approved & draft queued.');
        return true;
      }
      toast.error('Send failed — touchpoint not marked. Please retry.');
      return false;
    } finally {
      setPendingNurture(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }, [pendingNurture]);

  const activeDonor = useMemo(() => donors.find(d => String(d.id) === String(activeDonorId)) || donors[0], [donors, activeDonorId]);
  const donorTransactions = useMemo(() => transactions.filter(t => t.donorId === activeDonor?.id), [transactions, activeDonor]);

  const filteredDonors = useMemo(() => {
    void lifecycleTick;
    return donors.filter(d => {
      const q = searchQuery.toLowerCase();
      const meta = (d.meta || {}) as Record<string, unknown>;
      const emp = String(meta.employer || '').toLowerCase();
      const matchesSearch = d.name.toLowerCase().includes(q) ||
        d.pan.toLowerCase().includes(q) ||
        (d.email || '').toLowerCase().includes(q) ||
        (d.phone || '').toLowerCase().includes(q) ||
        emp.includes(q);
      const stage = donorStages.get(String(d.id)) ?? 'unknown';
      const matchesFilter = activeFilter === 'All' ||
        (activeFilter === 'Major' && d.type === 'Major Donor') ||
        (activeFilter === 'Recurring' && d.type === 'Recurring') ||
        (activeFilter === 'Acquisition' && stage === 'acquisition') ||
        (activeFilter === 'Stewardship' && stage === 'stewardship') ||
        (activeFilter === 'Renewal'     && stage === 'renewal') ||
        (activeFilter === 'Lapse Risk'  && stage === 'lapse_risk') ||
        (activeFilter === 'Dormant'     && stage === 'lapsed');
      return matchesSearch && matchesFilter;
    });
  }, [donors, searchQuery, activeFilter, donorStages, lifecycleTick]);

  const donorListRef = useRef<HTMLDivElement>(null);
  const donorVirtualizer = useVirtualizer({
    count: filteredDonors.length,
    getScrollElement: () => donorListRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  const scrollDonorListTop = useCallback(() => {
    donorVirtualizer.scrollToOffset(0);
  }, [donorVirtualizer]);

  useEffect(() => {
    scrollDonorListTop();
  }, [searchQuery, activeFilter, scrollDonorListTop]);

  const donorTxTimelineRef = useRef<HTMLDivElement>(null);
  const donorTxVirtualizer = useVirtualizer({
    count: donorTransactions.length,
    getScrollElement: () => donorTxTimelineRef.current,
    estimateSize: () => 92,
    overscan: 8,
  });

  const scrollTimelineTop = useCallback(() => {
    donorTxVirtualizer.scrollToOffset(0);
  }, [donorTxVirtualizer]);

  useEffect(() => {
    scrollTimelineTop();
  }, [activeDonorId, scrollTimelineTop]);

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/crm/donors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newContact.name,
          type: newContact.type,
          pan: newContact.pan,
          location: newContact.location,
          tags: ['New'],
          email: newContact.email.trim() || null,
          phone: newContact.phone.trim() || null,
          meta: {
            ...(newContact.employer.trim() ? { employer: newContact.employer.trim() } : {}),
            ...(newContact.notes.trim() ? { notes: newContact.notes.trim() } : {}),
            ...(newContact.preferredChannel ? { preferred_channel: newContact.preferredChannel } : {}),
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.donor?.id) {
          useStore.getState().addDonorWithId(data.donor);
        }
        toast.success(`${newContact.name} added to CRM!`);
      } else {
        toast.error('Failed to add donor (backend rejected).');
        return;
      }
    } catch {
      toast.error('Failed to add donor (backend not reachable).');
      return;
    }
    setShowAddContact(false);
    setNewContact({
      name: '',
      type: 'Recurring',
      pan: '',
      location: '',
      email: '',
      phone: '',
      employer: '',
      notes: '',
      preferredChannel: 'whatsapp',
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`/crm/donors/${editContact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editContact.name,
          type: editContact.type,
          pan: editContact.pan,
          location: editContact.location,
          tags: editContact.tags || [],
          email: (editContact.email || '').trim() || null,
          phone: (editContact.phone || '').trim() || null,
          meta:
            editContact.meta && typeof editContact.meta === 'object' && !Array.isArray(editContact.meta)
              ? (editContact.meta as Record<string, unknown>)
              : {},
        }),
      });
      if (res.ok) {
        updateDonor(editContact.id, editContact);
        toast.success(`Profile updated!`);
        setShowEditContact(false);
      } else {
        toast.error('Failed to update donor.');
      }
    } catch {
      toast.error('Network error updating donor.');
    }
  };

  const handleDeleteDonor = async () => {
    if (!activeDonorId) return;
    try {
      const res = await apiFetch(`/crm/donors/${activeDonorId}`, { method: 'DELETE' });
      if (res.ok) {
        deleteDonor(activeDonorId);
        toast.success(`Donor deleted!`);
        setActiveDonorId('');
        setShowDeleteConfirm(false);
      } else {
        toast.error('Failed to delete donor.');
      }
    } catch {
      toast.error('Network error deleting donor.');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDonors.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDonors.map(d => d.id)));
    }
  };

  const [emailNotConnected, setEmailNotConnected] = useState(false);
  const [composerSending, setComposerSending] = useState(false);
  /** Per-recipient failure list from the most recent send — surfaced as an
   *  expandable list below the composer when present, and persisted until
   *  the user closes/reopens the composer. */
  const [lastSendFailures, setLastSendFailures] = useState<string[]>([]);
  const [lastSendSkipped, setLastSendSkipped] = useState<string[]>([]);

  const handleSendComposer = async () => {
    const donorIds = bulkMode ? Array.from(selectedIds) : (activeDonor?.id ? [activeDonor.id] : []);
    if (donorIds.length === 0) { toast.error('Select at least one donor.'); return; }

    const donorMap = new Map(donors.map(d => [String(d.id), d]));
    const message = (customMessage || selectedTemplate.body || '').toString();
    setComposerSending(true);
    setEmailNotConnected(false);
    setLastSendFailures([]);
    setLastSendSkipped([]);

    try {
      // Email branches to the dedicated email endpoint; if missing, surface a
      // clear "not connected" state instead of silently piggy-backing on WhatsApp.
      if (composerChannel === 'email') {
        const missingEmail = donorIds.filter(id => !donorMap.get(String(id))?.email);
        const sendableIds = donorIds.filter(id => !!donorMap.get(String(id))?.email);
        if (sendableIds.length === 0) {
          toast.error('None of the selected donors have an email address on file.');
          return;
        }
        let res: Response;
        try {
          res = await apiFetch('/crm/outreach/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              donor_ids: sendableIds,
              template_id: selectedTemplate?.id,
              message,
            }),
          });
        } catch {
          setEmailNotConnected(true);
          return;
        }
        if (res.status === 404 || res.status === 405 || res.status === 501) {
          setEmailNotConnected(true);
          return;
        }
        if (!res.ok) {
          toast.error('Email send failed.');
          return;
        }
        // Per-recipient feedback: parse {results:[{donor_id, ok, error?}]} when
        // the backend returns it; otherwise infer all-success.
        let sent = sendableIds.length;
        let failed: string[] = [];
        try {
          const data = await res.json();
          if (Array.isArray(data?.results)) {
            sent = data.results.filter((r: any) => r.ok).length;
            failed = data.results
              .filter((r: any) => !r.ok)
              .map((r: any) => donorMap.get(String(r.donor_id))?.name || String(r.donor_id));
          }
        } catch { /* keep defaults */ }
        const skipped = missingEmail.map(id => donorMap.get(String(id))?.name || String(id));
        setLastSendFailures(failed);
        setLastSendSkipped(skipped);
        const failedSummary = failed.length ? ` · ${failed.length} failed` : '';
        const skippedSummary = skipped.length ? ` · ${skipped.length} skipped (no email)` : '';
        toast.success(`Sent ${sent}/${donorIds.length}${failedSummary}${skippedSummary}`, { icon: '📧', duration: 6000 });
        // Keep composer open if anything failed/skipped so the user sees the
        // expandable list; close cleanly when everything succeeded.
        if (failed.length === 0 && skipped.length === 0) {
          setShowComposer(false);
          setSelectedIds(new Set());
          setBulkMode(false);
        }
        return;
      }

      // WhatsApp path (unchanged transport).
      const res = await apiFetch('/crm/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'send',
          channel: composerChannel,
          donor_ids: donorIds,
          template_id: selectedTemplate?.id,
          message,
        }),
      });
      if (!res.ok) throw new Error('send');
      let sent = donorIds.length;
      let failed: string[] = [];
      try {
        const data = await res.json();
        if (Array.isArray(data?.results)) {
          sent = data.results.filter((r: any) => r.ok).length;
          failed = data.results
            .filter((r: any) => !r.ok)
            .map((r: any) => donorMap.get(String(r.donor_id))?.name || String(r.donor_id));
        }
      } catch { /* keep defaults */ }
      setLastSendFailures(failed);
      const failedSummary = failed.length ? ` · ${failed.length} failed` : '';
      toast.success(`Sent ${sent}/${donorIds.length}${failedSummary}`, { icon: '📲', duration: 6000 });
      if (failed.length === 0) {
        setShowComposer(false);
        setSelectedIds(new Set());
        setBulkMode(false);
      }
    } catch {
      toast.error('Failed to send (backend not reachable).');
    } finally {
      setComposerSending(false);
    }
  };

  const switchComposerToWhatsApp = () => {
    setComposerChannel('whatsapp');
    setEmailNotConnected(false);
  };

  const openBulkCompose = (channel: 'whatsapp' | 'email') => {
    if (selectedIds.size === 0) { toast.error('Select at least one donor first.'); return; }
    setComposerChannel(channel);
    setBulkMode(true);
    setEmailNotConnected(false);
    setLastSendFailures([]);
    setLastSendSkipped([]);
    setShowComposer(true);
  };

  const openSingleCompose = (channel: 'whatsapp' | 'email', templateId?: string) => {
    setComposerChannel(channel);
    setBulkMode(false);
    if (templateId) {
      const t = WA_TEMPLATES.find(x => x.id === templateId);
      if (t) {
        setSelectedTemplate(t);
        setCustomMessage(t.body);
      }
    }
    setEmailNotConnected(false);
    setLastSendFailures([]);
    setLastSendSkipped([]);
    setShowComposer(true);
  };

  const handleExportSelected = () => {
    const toExport = selectedIds.size > 0 ? donors.filter(d => selectedIds.has(d.id)) : donors;
    const csv = ['Name,Type,PAN,Location,Email,Phone,Employer,Total Given,Last Gift',
      ...toExport.map(d => {
        const m = (d.meta || {}) as Record<string, unknown>;
        const emp = String(m.employer || '').replace(/"/g, '""');
        return `${d.name},${d.type},${d.pan},"${d.location}",${d.email || ''},${d.phone || ''},"${emp}",${d.totalGiven},${d.lastGift}`;
      })
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'donors_export.csv'; a.click();
    toast.success(`Exported ${toExport.length} donor records!`);
  };

  const handleDownload80G = async (donorId: string, txId: string) => {
    try {
      const res = await apiFetch(`/crm/donors/${donorId}/80g/${txId}.pdf`);
      if (!res.ok) throw new Error('80g');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `80G_Receipt_${txId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('80G Certificate downloaded!');
    } catch {
      toast.error('Failed to download 80G certificate.');
    }
  };

  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvPreview(parseCsvToRecords(text));
    };
    reader.readAsText(file);
  };

  const handleCSVImport = async () => {
    if (!csvPreview.length) return;
    const donors = csvPreview
      .map((row: any) => {
        const employer = (row.employer || '').trim();
        return {
          name: (row.name || '').trim(),
          type: ((row.type || 'Recurring').trim() || 'Recurring'),
          pan: (row.pan || '').trim(),
          location: (row.location || '').trim(),
          email: (row.email || '').trim() || undefined,
          phone: (row.phone || '').trim() || undefined,
          tags: ['Imported'],
          ...(employer ? { meta: { employer } } : {}),
        };
      })
      .filter((d: { name: string }) => d.name);
    if (!donors.length) {
      toast.error('No valid rows — CSV needs a name column.');
      return;
    }
    try {
      const res = await apiFetch('/crm/donors/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donors }),
      });
      if (!res.ok) throw new Error('bulk');
      const data = await res.json();
      const n = typeof data.imported === 'number' ? data.imported : donors.length;
      const listRes = await apiFetch('/crm/donors');
      if (listRes.ok) {
        const listData = await listRes.json();
        if (Array.isArray(listData.donors)) useStore.getState().setDonors(listData.donors);
      }
      toast.success(`Imported ${n} donors.`);
      setCsvPreview([]);
      setShowCSVImport(false);
    } catch {
      toast.error('Failed to import (backend not reachable).');
    }
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'donor_import_template.csv'; a.click();
    toast('CSV template downloaded!', { icon: '📥' });
  };

  return (
    <div className="crm-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Donor CRM</h1>
          <p className="page-subtitle">360° view of your donors with native WhatsApp integration.</p>
        </div>
        <div className="crm-header-actions">
          <div className="flex gap-2" style={{ background: 'var(--color-bg-main)', padding: '0.25rem', borderRadius: 'var(--radius-md)', marginRight: '0.5rem' }}>
            <button className={`btn-icon-only ${viewMode === 'list' ? 'bg-white shadow-sm' : ''}`} style={{ padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)', border: 'none', background: viewMode === 'list' ? 'white' : 'transparent', color: viewMode === 'list' ? 'var(--color-primary)' : 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' }} onClick={() => setViewMode('list')}>List</button>
            <button className={`btn-icon-only ${viewMode === 'heatmap' ? 'bg-white shadow-sm' : ''}`} style={{ padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)', border: 'none', background: viewMode === 'heatmap' ? 'white' : 'transparent', color: viewMode === 'heatmap' ? 'var(--color-primary)' : 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' }} onClick={() => setViewMode('heatmap')}>Heatmap</button>
          </div>
          <button className="btn btn-secondary" onClick={() => setShowCSVImport(true)}>
            <Upload size={16} /> Import CSV
          </button>
          <button className="btn btn-secondary" onClick={handleExportSelected}>
            <Download size={16} /> Export {selectedIds.size > 0 ? `(${selectedIds.size})` : 'All'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddContact(true)}>
            <UserPlus size={16} /> New Contact
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <div className="flex items-center gap-3">
            <div className="bulk-count">{selectedIds.size} selected</div>
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              {donors.filter(d => selectedIds.has(d.id)).map(d => d.name).slice(0, 3).join(', ')}
              {selectedIds.size > 3 && ` +${selectedIds.size - 3} more`}
            </span>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary bulk-btn" onClick={() => openBulkCompose('whatsapp')}>
              <MessageCircle size={15} /> Bulk WhatsApp
            </button>
            <button className="btn btn-secondary bulk-btn" onClick={() => openBulkCompose('email')}>
              <Mail size={15} /> Bulk Email
            </button>
            <button className="btn btn-secondary bulk-btn" onClick={handleExportSelected}>
              <Download size={15} /> Export
            </button>
            <button className="btn btn-secondary bulk-btn" style={{ color: 'var(--color-text-tertiary)' }} onClick={() => setSelectedIds(new Set())}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      <div className="donor-list-container">
        {/* Sidebar */}
        <div className="donor-sidebar">
          <div className="sidebar-filters">
            <div className="search-wrapper" style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-text-tertiary)' }} />
              <input type="text" className="search-donors" placeholder="Search by name, PAN..."
                style={{ paddingLeft: '2rem' }} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <div className="filter-tags">
              {['All', 'Major', 'Recurring', 'Acquisition', 'Stewardship', 'Renewal', 'Lapse Risk', 'Dormant'].map(tag => (
                <span key={tag} className={`filter-tag ${activeFilter === tag ? 'active' : ''}`} onClick={() => setActiveFilter(tag)}>{tag}</span>
              ))}
            </div>
            <div className="flex items-center gap-2" style={{ paddingTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', cursor: 'pointer' }} onClick={toggleSelectAll}>
              <input type="checkbox" readOnly checked={selectedIds.size === filteredDonors.length && filteredDonors.length > 0} style={{ cursor: 'pointer' }} />
              Select all ({filteredDonors.length})
            </div>
          </div>
          {/* Nurture Queue Section */}
          <div className="nurture-panel">
            <div className="nurture-panel-header">
              {activeFilter === 'Dormant'
                ? <AlertTriangle size={14} style={{ color: STAGE_META.lapsed.color }} />
                : <Zap size={14} className="text-primary" />}
              <span className="nurture-panel-title">
                {activeFilter === 'Dormant' ? 'Dormant Re-engagement' : 'Daily Nurture Queue'}
              </span>
              <span className="nurture-panel-count">{nurtureQueue.length}</span>
            </div>

            {activeFilter !== 'Dormant' && (
              <div className="nurture-stage-chips">
                {STAGE_FILTER_OPTIONS.filter(o => o.id !== 'lapsed').map(opt => (
                  <button
                    key={opt.id}
                    className={`nurture-stage-chip${stageFilter === opt.id ? ' nurture-stage-chip--active' : ''}`}
                    onClick={() => setStageFilter(opt.id)}
                    type="button"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {nurtureQueue.length === 0 ? (
              <div className="nurture-empty">
                {activeFilter === 'Dormant'
                  ? 'No dormant donors yet — your renewal cadence is on track.'
                  : 'No touchpoints due in this window. 🎉'}
              </div>
            ) : (
              nurtureQueue.map(({ donor: d, stage, next }) => {
                // Only milestones in `due`, `overdue`, or a lapsed re-engagement
                // should mark a touchpoint complete on click.  Upcoming
                // milestones are not yet actionable — clicking just opens the
                // donor profile so the user can review or schedule manually.
                const isActionable =
                  stage === 'lapsed' ||
                  next?.state === 'overdue' ||
                  next?.state === 'due';
                const ctaLabel = stage === 'lapsed'
                  ? 'Re-engage'
                  : next?.state === 'overdue' ? 'Send overdue update'
                  : next?.state === 'due'     ? 'Approve & Send'
                  : next ? `Open · ${next.label}` : 'Open profile';
                const milestoneId = (next?.id ?? (stage === 'lapsed' ? 'renewal' : 'impact')) as 'thankyou' | 'impact' | 'fullimpact' | 'renewal';
                const pendingKey = `${String(d.id)}:${milestoneId}`;
                return (
                  <div
                    key={String(d.id)}
                    className={`nurture-card${stage === 'lapse_risk' ? ' nurture-card--risk' : ''}`}
                    onClick={() => setActiveDonorId(String(d.id))}
                  >
                    <div className="nurture-card-row">
                      <span className="nurture-card-name">{d.name}</span>
                      <StageBadge stage={stage} size="xs" />
                    </div>
                    <div className="nurture-card-reason">
                      {next ? `${next.label} · ${next.state === 'overdue' ? 'Overdue' : next.state === 'due' ? 'Due now' : 'Upcoming'}`
                            : stage === 'lapsed' ? 'No gift in 12+ months' : 'Stage update'}
                    </div>
                    <button
                      className="nurture-card-action"
                      disabled={isActionable && pendingNurture.has(pendingKey)}
                      aria-busy={isActionable && pendingNurture.has(pendingKey)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isActionable) {
                          void handleNurtureAction(String(d.id), milestoneId);
                        } else {
                          setActiveDonorId(String(d.id));
                        }
                      }}
                    >
                      {isActionable && pendingNurture.has(pendingKey) ? 'Sending…' : ctaLabel} <ArrowRight size={11} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div ref={donorListRef} className="donor-list">
            {filteredDonors.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>No donors found.</div>
            ) : (
              <div
                style={{
                  height: donorVirtualizer.getTotalSize(),
                  width: '100%',
                  position: 'relative',
                }}
              >
                {donorVirtualizer.getVirtualItems().map(vi => {
                  const donor = filteredDonors[vi.index];
                  return (
                    <div
                      key={donor.id}
                      data-index={vi.index}
                      ref={donorVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vi.start}px)`,
                      }}
                    >
                      <div
                        className={`donor-item ${String(activeDonorId) === String(donor.id) ? 'active' : ''} ${selectedIds.has(String(donor.id)) ? 'selected' : ''}`}
                        onClick={() => setActiveDonorId(String(donor.id))}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(String(donor.id))}
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleSelect(String(donor.id))}
                          style={{ flexShrink: 0 }}
                        />
                        <div className="donor-avatar">{donor.initial}</div>
                        <div className="donor-info">
                          <div className="donor-name">{donor.name}</div>
                          <div className="donor-meta donor-meta--row">
                            <span>{donor.type}</span>
                            <StageBadge stage={donorStages.get(String(donor.id)) ?? 'unknown'} size="xs" />
                          </div>
                          {(() => {
                            const na = deriveNextAction(donor);
                            return (
                              <div className={`donor-next-action donor-next-action--${na.band}`} title="Suggested next action">
                                <Zap size={10} /> {na.label}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Heatmap View */}
        {viewMode === 'heatmap' && (
          <div className="donor-detail" style={{ padding: '2rem', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-xl)' }}>
            <div className="flex justify-between items-center mb-4">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Churn Risk Heatmap</h2>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1"><div style={{ width: 12, height: 12, background: 'var(--color-success)', borderRadius: 2 }}/> Safe</span>
                <span className="flex items-center gap-1"><div style={{ width: 12, height: 12, background: 'var(--color-warning)', borderRadius: 2 }}/> At Risk</span>
                <span className="flex items-center gap-1"><div style={{ width: 12, height: 12, background: 'var(--color-danger)', borderRadius: 2 }}/> Lapsing</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
              {filteredDonors.map(donor => {
                let riskColor = 'var(--color-success)';
                if (donor.type === 'Lapsing') riskColor = 'var(--color-danger)';
                else if (donor.lastGift < '2023-01') riskColor = 'var(--color-warning)';
                
                return (
                  <div key={`heat-${donor.id}`} 
                    style={{ background: riskColor, color: 'white', padding: '1rem', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer', transition: 'transform 0.2s', boxShadow: 'var(--shadow-sm)' }}
                    onClick={() => { setViewMode('list'); setActiveDonorId(donor.id); }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{donor.name.split(' ')[0]}</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.9 }}>RFM: {(donor as any).rfmScore || '78'}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>AI Recovery Action</h4>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>You have {filteredDonors.filter(d => d.type === 'Lapsing').length} donors in the high-risk red zone. Click a cell to view their profile, or use the bulk action bar to send a re-engagement WhatsApp sequence.</p>
            </div>
          </div>
        )}

        {/* Detail panel */}
        {viewMode === 'list' && activeDonor && (
          <div className="donor-detail">
            <div className="detail-header">
              <div className="profile-main">
                <div className="profile-avatar">{activeDonor.initial}</div>
                <div className="profile-info">
                  <h2>{activeDonor.name}</h2>
                  <div style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', flexWrap: 'wrap' }}>
                    <span className="flex items-center gap-1"><MapPin size={14} /> {activeDonor.location}</span>
                    <span>PAN: {activeDonor.pan}</span>
                    {activeDonor.email ? <span className="flex items-center gap-1"><Mail size={14} /> {activeDonor.email}</span> : null}
                    {activeDonor.phone ? <span className="flex items-center gap-1"><Phone size={14} /> {activeDonor.phone}</span> : null}
                  </div>
                  {(() => {
                    const m = (activeDonor.meta || {}) as Record<string, unknown>;
                    const sub = [m.employer && `Employer: ${m.employer}`, m.notes && String(m.notes)].filter(Boolean).join(' · ');
                    return sub ? <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', marginTop: '0.35rem' }}>{sub}</p> : null;
                  })()}
                  <div className="profile-tags">
                    <span className="badge badge-success">{activeDonor.type}</span>
                    <StageBadge stage={donorStages.get(String(activeDonor.id)) ?? 'unknown'} size="md" />
                    {activeDonor.tags.map(tag => <span key={tag} className="badge badge-outline">{tag}</span>)}
                    
                    {/* Propensity Score Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-main)', padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', marginLeft: '0.5rem' }}>
                      {propensityLoading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} color="var(--color-warning)" />}
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                        {propensityLoading ? 'Calculating...' : `Propensity: ${propensity?.score || '--'}%`}
                      </span>
                    </div>
                  </div>
                  {/* Suggested next action — derived from propensity band when available. */}
                  {(() => {
                    const na = deriveNextAction(activeDonor, propensity?.score);
                    const channel = na.templateId === 'reactivate' || na.templateId === 'thank' ? 'whatsapp' : 'whatsapp';
                    return (
                      <button
                        type="button"
                        className={`donor-next-action-cta donor-next-action-cta--${na.band}`}
                        onClick={() => openSingleCompose(channel as 'whatsapp', na.templateId)}
                      >
                        <Zap size={13} />
                        <span><strong>Suggested next action:</strong> {na.label}</span>
                        <ArrowRight size={13} />
                      </button>
                    );
                  })()}
                </div>
              </div>
              <div className="contact-actions">
                <button className="btn btn-whatsapp" title="WhatsApp" onClick={() => openSingleCompose('whatsapp')}>
                  <MessageCircle size={16} /> WhatsApp
                </button>
                <button className="btn btn-secondary" title="Email" onClick={() => openSingleCompose('email')}>
                  <Mail size={16} />
                </button>
                <button
                  className="btn btn-secondary"
                  title="Log a call attempt"
                  onClick={async () => {
                    if (!activeDonor?.id) return;
                    try {
                      const res = await apiFetch('/crm/outreach', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          mode: 'voice_event',
                          channel: 'phone',
                          donor_ids: [activeDonor.id],
                          message: `Call attempt logged for ${activeDonor.name}.`,
                        }),
                      });
                      if (!res.ok) throw new Error('call');
                      toast.success('Call attempt logged.', { icon: '📞' });
                    } catch {
                      toast.error('Failed to log call.');
                    }
                  }}
                >
                  <Phone size={16} />
                </button>
                <button
                  className="btn btn-secondary"
                  title="Edit Profile"
                  onClick={() => {
                    setEditContact({
                      ...activeDonor,
                      meta: { ...(typeof activeDonor.meta === 'object' && activeDonor.meta && !Array.isArray(activeDonor.meta) ? activeDonor.meta as object : {}) },
                    });
                    setShowEditContact(true);
                  }}
                >
                  <Edit size={16} />
                </button>
                <button
                  className="btn btn-secondary"
                  title="Delete Donor"
                  style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="detail-body">
              <div className="timeline-section">
                <div style={{ marginBottom: '1.25rem' }}>
                  <TouchpointTimeline
                    donor={activeDonor}
                    onApprove={async (mid) => {
                      const ok = await handleNurtureAction(String(activeDonor.id), mid);
                      return ok;
                    }}
                  />
                </div>
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.125rem' }}>Activity Timeline</h3>
                {donorTransactions.length === 0 ? null : (
                  <div
                    ref={donorTxTimelineRef}
                    style={{ maxHeight: 'min(45vh, 360px)', overflow: 'auto', marginBottom: '0.75rem' }}
                  >
                    <div style={{ height: donorTxVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                      {donorTxVirtualizer.getVirtualItems().map(vi => {
                        const tx = donorTransactions[vi.index];
                        return (
                          <div
                            key={tx.id}
                            data-index={vi.index}
                            ref={donorTxVirtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${vi.start}px)`,
                            }}
                          >
                            <div className="timeline-item">
                              <div className="timeline-icon" style={{ borderColor: 'var(--color-primary)' }}>
                                <IndianRupee size={10} color="var(--color-primary)" />
                              </div>
                              <div className="timeline-content">
                                <div className="timeline-date">
                                  {tx.date} • {tx.method}
                                </div>
                                <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                                  Donation: ₹{tx.amount.toLocaleString()}
                                </div>
                                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                                  Campaign: {tx.campaignTitle}
                                </p>
                                <button
                                  className="btn btn-secondary"
                                  style={{ marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                                  onClick={() => handleDownload80G(activeDonor.id, tx.id)}
                                >
                                  <Download size={12} /> Download 80G
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="timeline-item">
                  <div className="timeline-icon" style={{ borderColor: 'var(--color-warning)' }}>
                    <Clock size={10} color="var(--color-warning)" />
                  </div>
                  <div className="timeline-content">
                    <div className="timeline-date">Profile Created</div>
                    <div style={{ fontWeight: 500 }}>Donor Profile Initialized</div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>System generated 360° profile. AI monitoring active.</p>
                  </div>
                </div>
              </div>
              <div className="stats-section">
                <div className="stat-block">
                  <div className="stat-label">Total Lifetime Value</div>
                  <div className="stat-value">₹{activeDonor.totalGiven.toLocaleString()}</div>
                </div>
                <div className="stat-block">
                  <div className="stat-label">Donor Score (RFM)</div>
                  <div className="stat-value" style={{ color: 'var(--color-success)' }}>
                    {activeDonor.totalGiven > 100000 ? '92' : '75'}/100
                  </div>
                </div>
                {activeDonor.type === 'Recurring' && (
                  <div className="stat-block">
                    <div className="stat-label">UPI AutoPay</div>
                    <div className="flex items-center gap-2" style={{ marginTop: '0.5rem' }}>
                      <CheckCircle size={16} color="var(--color-success)" />
                      <span style={{ fontWeight: 500 }}>Active Mandate</span>
                    </div>
                  </div>
                )}
                <div className="stat-block">
                  <div className="stat-label">AI Insight Summary</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: '0.5rem', lineHeight: 1.4, padding: '0.75rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    {aiLoading ? (
                      <div className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Analyzing history...</div>
                    ) : (
                      aiSummary || 'No recent interactions to summarize.'
                    )}
                  </div>
                </div>
                {sentiment && (
                  <div className="stat-block">
                    <div className="stat-label">Donor Sentiment</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>{sentiment.sentiment === 'Positive' ? '😊' : sentiment.sentiment === 'Neutral' ? '😐' : '😟'}</span>
                      <div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: sentiment.sentiment === 'Positive' ? 'var(--color-success)' : 'var(--color-text-primary)' }}>{sentiment.sentiment}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Confidence Score: {Math.round(sentiment.score * 100)}%</div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="stat-block">
                  <div className="stat-label">ML Recommendation</div>
                  <div style={{ fontSize: '0.8rem', color: propensity?.score && propensity.score > 70 ? 'var(--color-success)' : 'var(--color-text-secondary)', marginTop: '0.5rem', fontWeight: 500 }}>
                    {propensityLoading ? 'Calculating recommendation...' : (propensity?.recommendation || 'No recommendation available.')}
                  </div>
                </div>

                <div className="stat-block" style={{ gridColumn: 'span 1' }}>
                  <div className="stat-label flex justify-between items-center">
                    Relationship Notes
                    <button className="text-primary flex items-center gap-1" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }} 
                      onClick={async () => {
                        try {
                          const donorId = activeDonor?.id ? String(activeDonor.id) : '';
                          const res = await apiFetch('/crm/outreach', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              mode: 'voice_event',
                              channel: 'whatsapp',
                              donor_ids: donorId ? [donorId] : [],
                              message: 'Voice note capture requested from UI.',
                            }),
                          });
                          if (!res.ok) throw new Error('voice');
                          toast.success('Voice note request logged.', { icon: '🎙️' });
                        } catch {
                          toast.error('Failed to log voice note request.');
                        }
                      }}>
                      <Mic size={14} /> Voice Note
                    </button>
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: '0.5rem', fontStyle: 'italic', padding: '0.5rem', borderLeft: '2px solid var(--color-border)' }}>
                    "Interested in the new school project. Mentioned she might bring her husband for the site visit next month."
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Message Composer Modal ───────────────────────────────── */}
      {showComposer && (
        <ModalOverlay onBackdropClick={() => setShowComposer(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-composer-title"
          >
            <button type="button" onClick={() => setShowComposer(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close composer"><X size={20} /></button>
            <h2 id="crm-composer-title" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', paddingRight: '2.5rem' }}>
              {composerChannel === 'whatsapp' ? <MessageCircle size={22} color="#16a34a" /> : <Mail size={22} color="var(--color-primary)" />}
              {composerChannel === 'whatsapp' ? 'WhatsApp' : 'Email'} Composer
            </h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
              {bulkMode ? `Sending to ${selectedIds.size} selected donors` : `Sending to: ${activeDonor?.name}`}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label className="input-label">Message Template</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {WA_TEMPLATES.map(t => (
                  <button key={t.id} className={`btn btn-secondary`} style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem', ...(selectedTemplate.id === t.id ? { background: 'var(--color-primary-light)', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : {}) }}
                    onClick={() => { setSelectedTemplate(t); setCustomMessage(t.body); }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Message (edit to personalise)</label>
              <textarea className="input-field" rows={6} style={{ resize: 'vertical', fontFamily: 'inherit' }}
                value={customMessage || selectedTemplate.body}
                onChange={e => setCustomMessage(e.target.value)} />
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                Tokens: {'{name}'} = donor name • {'{amount}'} = last gift • {'{cause}'} = campaign name
              </div>
            </div>

            {composerChannel === 'email' && (
              <div className="input-group" style={{ marginBottom: '1rem' }}>
                <label className="input-label">Subject Line</label>
                <input type="text" className="input-field" placeholder="e.g. Your impact this month 🙏" />
              </div>
            )}

            {(lastSendFailures.length > 0 || lastSendSkipped.length > 0) && (
              <details className="composer-failures" open>
                <summary>
                  <AlertTriangle size={14} />
                  {lastSendFailures.length > 0 && <span>{lastSendFailures.length} failed</span>}
                  {lastSendFailures.length > 0 && lastSendSkipped.length > 0 && <span> · </span>}
                  {lastSendSkipped.length > 0 && <span>{lastSendSkipped.length} skipped (no email)</span>}
                  <span className="composer-failures-hint">click to expand</span>
                </summary>
                {lastSendFailures.length > 0 && (
                  <div className="composer-failures-section">
                    <div className="composer-failures-label">Delivery failed</div>
                    <ul>{lastSendFailures.map(name => <li key={`f-${name}`}>{name}</li>)}</ul>
                  </div>
                )}
                {lastSendSkipped.length > 0 && (
                  <div className="composer-failures-section">
                    <div className="composer-failures-label">Skipped — no email on file</div>
                    <ul>{lastSendSkipped.map(name => <li key={`s-${name}`}>{name}</li>)}</ul>
                  </div>
                )}
              </details>
            )}

            {emailNotConnected && (
              <div className="email-not-connected" role="alert">
                <AlertTriangle size={16} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Email backend not connected</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    Your account doesn't have a transactional email service wired up yet. You can switch this draft to WhatsApp, or save it for later.
                  </div>
                </div>
                <button type="button" className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }} onClick={switchComposerToWhatsApp}>
                  Switch to WhatsApp
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={async () => {
                const donorIds = bulkMode ? Array.from(selectedIds) : (activeDonor?.id ? [activeDonor.id] : []);
                if (donorIds.length === 0) { toast.error('Select at least one donor.'); return; }
                try {
                  const res = await apiFetch('/crm/outreach', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      mode: 'draft',
                      channel: composerChannel,
                      donor_ids: donorIds,
                      template_id: selectedTemplate?.id,
                      message: (customMessage || selectedTemplate.body || '').toString(),
                    }),
                  });
                  if (!res.ok) throw new Error('draft');
                  toast.success('Draft saved.', { icon: '💾' });
                } catch {
                  toast.error('Failed to save draft.');
                }
              }}>
                Save Draft
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSendComposer} disabled={composerSending || emailNotConnected}>
                {composerSending
                  ? <><Loader2 size={16} className="animate-spin" /> Sending…</>
                  : <><Send size={16} /> Send {bulkMode ? `to ${selectedIds.size} donors` : `to ${activeDonor?.name}`}</>}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── CSV Import Modal ─────────────────────────────────────── */}
      {showCSVImport && (
        <ModalOverlay onBackdropClick={() => { setShowCSVImport(false); setCsvPreview([]); }}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-csv-title"
          >
            <button type="button" onClick={() => { setShowCSVImport(false); setCsvPreview([]); }} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close import"><X size={20} /></button>
            <h2 id="crm-csv-title" style={{ marginBottom: '0.5rem', paddingRight: '2.5rem' }}>Import Donors from CSV</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
              Bulk import donor records from Excel or any CSV file.
            </p>

            <div style={{ border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '2rem', textAlign: 'center', marginBottom: '1rem' }}>
              <Upload size={28} color="var(--color-text-tertiary)" style={{ margin: '0 auto 0.75rem' }} />
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Drop CSV file here or click to browse</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', marginBottom: '1rem' }}>
                Required columns: name, type, pan, location
              </div>
              <div className="flex gap-2 justify-center">
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => fileInputRef.current?.click()}>
                  Browse File
                </button>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleDownloadTemplate}>
                  <Download size={14} /> Download Template
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVFile} />
            </div>

            {csvPreview.length > 0 && (
              <>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  Preview (first {Math.min(15, csvPreview.length)} of {csvPreview.length} rows)
                </div>
                <div className="table-scroll-wrap" style={{ marginBottom: '1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
                  <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-main)' }}>
                        {['Name', 'Type', 'PAN', 'Location', 'Email', 'Phone', 'Employer'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.slice(0, 15).map((row, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.name}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.type}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>{row.pan}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.location}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.email}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.phone}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.employer}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleCSVImport}>
                  <Users size={16} /> Import all {csvPreview.length} donors
                </button>
              </>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* ── Add Contact Modal ───────────────────────────────────── */}
      {showAddContact && (
        <ModalOverlay onBackdropClick={() => setShowAddContact(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-add-title"
          >
            <button type="button" onClick={() => setShowAddContact(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="crm-add-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>Add New Contact</h2>
            <form onSubmit={handleAddContact} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required type="text" className="input-field" value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Donor Type</label>
                <select className="input-field" value={newContact.type} onChange={e => setNewContact({ ...newContact, type: e.target.value })}>
                  {['Major Donor', 'Recurring', 'Event Attendee', 'CSR Partner', 'Lapsing'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Email</label>
                  <input type="email" className="input-field" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Phone</label>
                  <input type="text" className="input-field" value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">PAN Number</label>
                <input type="text" className="input-field" value={newContact.pan} onChange={e => setNewContact({ ...newContact, pan: e.target.value.toUpperCase() })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Location</label>
                <input required type="text" className="input-field" value={newContact.location} onChange={e => setNewContact({ ...newContact, location: e.target.value })} placeholder="e.g. Mumbai, Maharashtra" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Employer / org (optional)</label>
                <input type="text" className="input-field" value={newContact.employer} onChange={e => setNewContact({ ...newContact, employer: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Preferred channel</label>
                <select className="input-field" value={newContact.preferredChannel} onChange={e => setNewContact({ ...newContact, preferredChannel: e.target.value })}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Notes</label>
                <textarea className="input-field" rows={2} value={newContact.notes} onChange={e => setNewContact({ ...newContact, notes: e.target.value })} placeholder="Consent, referrals, nurture notes…" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Save Contact</button>
            </form>
          </div>
        </ModalOverlay>
      )}
      {/* ── Edit Contact Modal ───────────────────────────────────── */}
      {showEditContact && editContact && (
        <ModalOverlay onBackdropClick={() => setShowEditContact(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-edit-title"
          >
            <button type="button" onClick={() => setShowEditContact(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="crm-edit-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>Edit Contact</h2>
            <form onSubmit={handleEditSubmit} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required type="text" className="input-field" value={editContact.name} onChange={e => setEditContact({ ...editContact, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Donor Type</label>
                <select className="input-field" value={editContact.type} onChange={e => setEditContact({ ...editContact, type: e.target.value })}>
                  {['Major Donor', 'Recurring', 'Event Attendee', 'CSR Partner', 'Lapsing'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Email</label>
                  <input type="email" className="input-field" value={editContact.email || ''} onChange={e => setEditContact({ ...editContact, email: e.target.value })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Phone</label>
                  <input type="text" className="input-field" value={editContact.phone || ''} onChange={e => setEditContact({ ...editContact, phone: e.target.value })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">PAN Number</label>
                <input type="text" className="input-field" value={editContact.pan || ''} onChange={e => setEditContact({ ...editContact, pan: e.target.value.toUpperCase() })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Location</label>
                <input required type="text" className="input-field" value={editContact.location || ''} onChange={e => setEditContact({ ...editContact, location: e.target.value })} placeholder="e.g. Mumbai, Maharashtra" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Employer / org</label>
                <input
                  type="text"
                  className="input-field"
                  value={String((editContact.meta as Record<string, unknown>)?.employer || '')}
                  onChange={e => setEditContact({
                    ...editContact,
                    meta: { ...(typeof editContact.meta === 'object' && editContact.meta ? editContact.meta as object : {}), employer: e.target.value },
                  })}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Preferred channel</label>
                <select
                  className="input-field"
                  value={String((editContact.meta as Record<string, unknown>)?.preferred_channel || 'whatsapp')}
                  onChange={e => setEditContact({
                    ...editContact,
                    meta: { ...(typeof editContact.meta === 'object' && editContact.meta ? editContact.meta as object : {}), preferred_channel: e.target.value },
                  })}
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Notes</label>
                <textarea
                  className="input-field"
                  rows={2}
                  value={String((editContact.meta as Record<string, unknown>)?.notes || '')}
                  onChange={e => setEditContact({
                    ...editContact,
                    meta: { ...(typeof editContact.meta === 'object' && editContact.meta ? editContact.meta as object : {}), notes: e.target.value },
                  })}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Update Contact</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ── Delete Confirm Modal ───────────────────────────────────── */}
      {showDeleteConfirm && (
        <ModalOverlay onBackdropClick={() => setShowDeleteConfirm(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="crm-delete-title"
            style={{ textAlign: 'center' }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--color-danger)', color: 'white', padding: '1rem', borderRadius: '50%' }}>
                <Trash2 size={32} />
              </div>
            </div>
            <h2 id="crm-delete-title" style={{ marginBottom: '0.5rem' }}>Delete Donor?</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to delete <strong>{activeDonor?.name}</strong>? This action cannot be undone and will remove them from all campaigns.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleDeleteDonor} style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)', flex: 1 }}>Delete</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default CRM;
