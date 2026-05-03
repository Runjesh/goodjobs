import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Users, Smartphone, MapPin, CheckCircle2, UserCheck, ShieldCheck, Activity, Target, Download, Upload, X, ClipboardList, MessageCircle, Send, Bot, Loader2, Edit, Trash2, ListFilter, ClipboardCheck, Plus } from 'lucide-react';
import { useStore, initialBeneficiaries } from '../../store/useStore';
import { useFocusFromUrl } from '../../hooks/useFocusFromUrl';
import { useAuth } from '../../context/AuthContext';
import { isTrialExpired, canAddBeneficiary, STARTER_BENEFICIARY_CAP, type SubscriptionTier } from '../../utils/trial';
import { useTier } from '../../hooks/useTier';
import ContextualUpgradePrompt from '../../components/Billing/ContextualUpgradePrompt';
import toast from 'react-hot-toast';
import FormBuilder from '../../components/FormBuilder/FormBuilder';
import TheoryOfChangeBuilder from '../../components/Programs/TheoryOfChangeBuilder';
import '../../components/FormBuilder/FormBuilder.css';
import './Programs.css';
import { apiFetch } from '../../api/client';
import { parseCsvToRecords } from '../../utils/csvParse';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import EnrollBeneficiaryModal, { computeBeneficiaryCompleteness, type EnrollFormData } from './EnrollBeneficiaryModal';
import ProgramBudgetBar from '../../components/Programs/ProgramBudgetBar';
import ProgramEffortSummary from '../../components/Programs/ProgramEffortSummary';
import OutcomeForm from '../../components/Programs/OutcomeForm';
import ProgramGrantsPanel from '../../components/Programs/ProgramGrantsPanel';

const BEN_CSV_TEMPLATE = 'name,program,location,aadhaar,familySize,phone,email,gender,dob,referral_source,referral_detail,vulnerability,id_doc_type,id_doc_ref,notes\nSita Devi,Health,"Pune, MH",false,4,+9198***01,,female,1992-03-01,shg,Block 4 AWC,"woman_headed,pwd",aadhaar_masked,****8212,\nRavi K,Education,Delhi,true,3,,,male,,camp,,,election_id,ABC1234567,\n';

function extractFirstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m && m[1] ? m[1].trim() : undefined;
}

function parseBoolCell(v: string): boolean {
  const s = (v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

type BenExtraForm = {
  phone: string;
  email: string;
  gender: string;
  dob: string;
  referralSource: string;
  referralDetail: string;
  vulnerabilityTags: string;
  idDocType: string;
  idDocRef: string;
  notes: string;
  consentData: boolean;
};

const BEN_EXTRA_EMPTY: BenExtraForm = {
  phone: '',
  email: '',
  gender: '',
  dob: '',
  referralSource: '',
  referralDetail: '',
  vulnerabilityTags: '',
  idDocType: '',
  idDocRef: '',
  notes: '',
  consentData: true,
};

function packBenDetails(e: BenExtraForm): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (e.phone.trim()) o.phone = e.phone.trim();
  if (e.email.trim()) o.email = e.email.trim().toLowerCase();
  if (e.gender) o.gender = e.gender;
  if (e.dob.trim()) o.dob = e.dob.trim();
  if (e.referralSource) o.referral_source = e.referralSource;
  if (e.referralDetail.trim()) o.referral_detail = e.referralDetail.trim();
  if (e.vulnerabilityTags.trim()) {
    o.vulnerability_flags = e.vulnerabilityTags.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (e.idDocType) o.id_doc_type = e.idDocType;
  if (e.idDocRef.trim()) o.id_doc_ref = e.idDocRef.trim();
  if (e.notes.trim()) o.notes = e.notes.trim();
  o.consent_program_data = e.consentData;
  return o;
}

function unpackBenDetails(details?: Record<string, unknown> | null): BenExtraForm {
  const d = details || {};
  const vf = d.vulnerability_flags;
  const vulnStr = Array.isArray(vf) ? vf.join(', ') : String(vf || '');
  return {
    phone: String(d.phone ?? ''),
    email: String(d.email ?? ''),
    gender: String(d.gender ?? ''),
    dob: String(d.dob ?? ''),
    referralSource: String(d.referral_source ?? ''),
    referralDetail: String(d.referral_detail ?? ''),
    vulnerabilityTags: vulnStr,
    idDocType: String(d.id_doc_type ?? ''),
    idDocRef: String(d.id_doc_ref ?? ''),
    notes: String(d.notes ?? ''),
    consentData: d.consent_program_data !== false,
  };
}

function benDetailsFromCsvRow(row: Record<string, string>): Record<string, unknown> | undefined {
  const d: Record<string, unknown> = {};
  const g = (k: string) => (row[k] || '').trim();
  if (g('phone')) d.phone = g('phone');
  if (g('email')) d.email = g('email').toLowerCase();
  if (g('gender')) d.gender = g('gender');
  if (g('dob')) d.dob = g('dob');
  if (g('referral_source')) d.referral_source = g('referral_source');
  if (g('referral_detail')) d.referral_detail = g('referral_detail');
  if (g('vulnerability')) d.vulnerability_flags = g('vulnerability').split(',').map(s => s.trim()).filter(Boolean);
  if (g('id_doc_type')) d.id_doc_type = g('id_doc_type');
  if (g('id_doc_ref')) d.id_doc_ref = g('id_doc_ref');
  if (g('notes')) d.notes = g('notes');
  return Object.keys(d).length ? d : undefined;
}

function csvEscapeCell(v: string | number | boolean): string {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const DEFAULT_PROGRAMS = [
  'Education',
  'Healthcare Camp',
  'Women Livelihood Center',
  'Nutrition Programme',
  'Digital Literacy',
  'Skill Development',
  'Other',
];

const Programs: React.FC = () => {
  const { beneficiaries, addBeneficiary, updateBeneficiary, deleteBeneficiary } = useStore();
  const addMisReviewIntent = useStore(s => s.addMisReviewIntent);
  const [outcomeFor, setOutcomeFor] = useState<{ id: string; name: string; program: string } | null>(null);
  const { user } = useAuth();
  const { tier: effectiveTierVal, openUpgrade, inTrial } = useTier();
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);

  // ── Starter-tier limit gate ─────────────────────────────────────────────
  // We ONLY enforce limits when the org is genuinely on Starter:
  //   (a) explicit subscriptionTier === 'starter' (paid-down or post-trial), OR
  //   (b) the org has a trial state and that trial has expired.
  // Legacy/returning users with no trial AND no subscriptionTier are treated
  // as unlimited so this UI change doesn't retroactively gate them.
  const resolveTier = (): SubscriptionTier | null => {
    if (user?.subscriptionTier && user.subscriptionTier !== 'trial') return user.subscriptionTier;
    if (user?.trial && isTrialExpired(user.trial)) return 'starter';
    // useTier already collapses past-due → starter; respect it for paid users.
    if (effectiveTierVal === 'starter' && !inTrial) return 'starter';
    return null; // no enforcement
  };
  const enforceBeneficiaryCap = (additional = 1): boolean => {
    const tier = resolveTier();
    if (!tier) return true; // no trial + no chosen plan → don't gate
    if (canAddBeneficiary(tier, beneficiaries.length + (additional - 1))) return true;
    setUpgradePromptOpen(true);
    return false;
  };

  const customPrograms = useStore(s => s.customPrograms);
  const addCustomProgram = useStore(s => s.addCustomProgram);
  const derivedPrograms = Array.from(new Set(beneficiaries.map(b => b.program).filter(Boolean)));
  const mergedPrograms = Array.from(new Set([...derivedPrograms, ...customPrograms]));
  const programs = mergedPrograms.length > 0 ? mergedPrograms : DEFAULT_PROGRAMS;
  const [showAddProgramModal, setShowAddProgramModal] = useState(false);
  const [newProgramName, setNewProgramName] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'mis' | 'forms' | 'toc'>('mis');
  const [form, setForm] = useState({ name: '', program: '', location: '', aadhaar: false, familySize: 1 });
  const [benExtra, setBenExtra] = useState<BenExtraForm>({ ...BEN_EXTRA_EMPTY });
  const [editBenExtra, setEditBenExtra] = useState<BenExtraForm>({ ...BEN_EXTRA_EMPTY });
  const [showEditBen, setShowEditBen] = useState(false);
  const [editBen, setEditBen] = useState<any>(null);
  const [showDeleteBenConfirm, setShowDeleteBenConfirm] = useState(false);
  const [benToDelete, setBenToDelete] = useState<any>(null);
  const [showConversationalModal, setShowConversationalModal] = useState(false);
  const [conversationalInput, setConversationalInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [showBenImport, setShowBenImport] = useState(false);
  const [benCsvRows, setBenCsvRows] = useState<Record<string, string>[]>([]);
  const [benImporting, setBenImporting] = useState(false);
  const benFileRef = useRef<HTMLInputElement>(null);

  const [benSort, setBenSort] = useState<'attention' | 'alpha'>('attention');
  const [showLogService, setShowLogService] = useState(false);
  const [logServiceSearch, setLogServiceSearch] = useState('');
  const [logServiceType, setLogServiceType] = useState('service_visit');
  const [logServiceNotes, setLogServiceNotes] = useState('');

  const refreshBeneficiaries = async () => {
    try {
      const res = await apiFetch('/programs/beneficiaries');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.beneficiaries)) {
        useStore.getState().setBeneficiaries(data.beneficiaries);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshBeneficiaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // keep form program in sync once beneficiaries load
    if (!form.program && programs.length) setForm(prev => ({ ...prev, program: programs[0] }));
  }, [programs, form.program]);

  const packEnrollDetails = (f: EnrollFormData): Record<string, unknown> => {
    const d: Record<string, unknown> = {};
    if (f.dob) d.dob = f.dob;
    if (f.gender) d.gender = f.gender;
    if (f.phone.trim()) d.phone = f.phone.trim();
    if (f.email.trim()) d.email = f.email.trim().toLowerCase();
    if (f.village.trim()) d.village = f.village.trim();
    if (f.pinCode.trim()) d.pin_code = f.pinCode.trim();
    if (f.enrollmentDate) d.enrollment_date = f.enrollmentDate;
    if (f.referralSource) d.referral_source = f.referralSource;
    if (f.referralDetail.trim()) d.referral_detail = f.referralDetail.trim();
    if (f.vulnerabilityTags.length) d.vulnerability_flags = f.vulnerabilityTags;
    if (f.idDocType) d.id_doc_type = f.idDocType;
    if (f.idDocRef.trim()) d.id_doc_ref = f.idDocRef.trim();
    if (f.householdId) d.household_id = f.householdId;
    if (f.householdHead.trim()) d.household_head = f.householdHead.trim();
    if (f.monthlyIncome) d.monthly_income = f.monthlyIncome;
    d.consent_given = f.consentGiven;
    d.consent_language = f.consentLanguage;
    if (f.consentTimestamp) d.consent_timestamp = f.consentTimestamp;
    if (f.docAadhaar) d.doc_aadhaar = f.docAadhaar;
    if (f.docPhoto) d.doc_photo = f.docPhoto;
    if (f.docOther) d.doc_other = f.docOther;
    if (f.docsSkipped) d.docs_skipped = true;
    if (f.notes.trim()) d.notes = f.notes.trim();
    return d;
  };

  const handleSectionedEnroll = async (f: EnrollFormData) => {
    if (!enforceBeneficiaryCap()) { setShowModal(false); return; }
    const payload = {
      name: f.name.trim(),
      program: f.program,
      location: f.location.trim(),
      aadhaar: f.aadhaar,
      familySize: Number(f.familySize) || 1,
      details: packEnrollDetails(f),
    };
    try {
      const res = await apiFetch('/programs/beneficiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('create');
      await refreshBeneficiaries();
      toast.success(`${payload.name} enrolled in ${payload.program}!`);
    } catch {
      if (!enforceBeneficiaryCap()) { setShowModal(false); return; }
      addBeneficiary(payload);
      toast.success(`${payload.name} enrolled (saved locally — sync when backend is back).`);
    }
    setShowModal(false);
  };

  // Legacy handler retained for the edit-beneficiary modal which still uses the flat form.
  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enforceBeneficiaryCap()) { setShowModal(false); return; }
    try {
      const res = await apiFetch('/programs/beneficiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          program: form.program,
          location: form.location,
          aadhaar: form.aadhaar,
          familySize: Number(form.familySize),
          details: packBenDetails(benExtra),
        }),
      });
      if (!res.ok) throw new Error('create');
      await refreshBeneficiaries();
      toast.success(`${form.name} enrolled in ${form.program}!`);
      setForm({ name: '', program: programs[0] || '', location: '', aadhaar: false, familySize: 1 });
      setBenExtra({ ...BEN_EXTRA_EMPTY });
      setShowModal(false);
    } catch {
      if (!enforceBeneficiaryCap()) { setShowModal(false); return; }
      addBeneficiary({
        name: form.name,
        program: form.program,
        location: form.location,
        aadhaar: form.aadhaar,
        familySize: Number(form.familySize),
      });
      toast.success(`${form.name} enrolled (saved locally — sync when backend is back).`);
      setForm({ name: '', program: programs[0] || '', location: '', aadhaar: false, familySize: 1 });
      setBenExtra({ ...BEN_EXTRA_EMPTY });
      setShowModal(false);
    }
  };

  const handleEditBenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`/programs/beneficiaries/${editBen.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editBen.name,
          program: editBen.program,
          location: editBen.location,
          aadhaar: editBen.aadhaar,
          familySize: Number(editBen.familySize),
          details: packBenDetails(editBenExtra),
        }),
      });
      if (res.ok) {
        await refreshBeneficiaries();
        toast.success(`Beneficiary updated!`);
        setShowEditBen(false);
      } else {
        toast.error('Failed to update beneficiary.');
      }
    } catch {
      toast.error('Network error updating beneficiary.');
    }
  };

  const handleDeleteBen = async () => {
    if (!benToDelete) return;
    try {
      const res = await apiFetch(`/programs/beneficiaries/${benToDelete.id}`, { method: 'DELETE' });
      if (res.ok) {
        deleteBeneficiary(benToDelete.id);
        toast.success(`Beneficiary deleted!`);
        setShowDeleteBenConfirm(false);
        setBenToDelete(null);
      } else {
        toast.error('Failed to delete beneficiary.');
      }
    } catch {
      toast.error('Network error deleting beneficiary.');
    }
  };

  const handleExport = () => {
    const header = 'ID,Name,Program,Location,Aadhaar,Family Size,Phone,Referral,Gender';
    const csv = [
      header,
      ...beneficiaries.map((b) => {
        const d = b.details || {};
        return [
          csvEscapeCell(b.id),
          csvEscapeCell(b.name),
          csvEscapeCell(b.program),
          csvEscapeCell(b.location),
          csvEscapeCell(b.aadhaar),
          csvEscapeCell(b.familySize),
          csvEscapeCell(String(d['phone'] ?? '')),
          csvEscapeCell(String(d['referral_source'] ?? '')),
          csvEscapeCell(String(d['gender'] ?? '')),
        ].join(',');
      }),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'beneficiaries.csv'; a.click();
    toast.success('Beneficiary data exported to CSV!');
  };

  const handleBenCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setBenCsvRows(parseCsvToRecords(text));
    };
    reader.readAsText(file);
  };

  const runBenBulkImport = async () => {
    if (!benCsvRows.length) return;
    const beneficiariesPayload = benCsvRows
      .map(row => {
        const details = benDetailsFromCsvRow(row);
        return {
          name: (row.name || '').trim(),
          program: (row.program || '').trim(),
          location: (row.location || '').trim(),
          aadhaar: row.aadhaar !== undefined && row.aadhaar !== '' ? parseBoolCell(row.aadhaar) : false,
          familySize: Math.max(1, parseInt(row.familysize || row.family_size || '1', 10) || 1),
          ...(details ? { details } : {}),
        };
      })
      .filter(b => b.name);
    if (!beneficiariesPayload.length) {
      toast.error('No valid rows — need name, program, location columns.');
      return;
    }
    if (!enforceBeneficiaryCap(beneficiariesPayload.length)) return;
    setBenImporting(true);
    try {
      const res = await apiFetch('/programs/beneficiaries/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaries: beneficiariesPayload }),
      });
      if (!res.ok) throw new Error('bulk');
      const data = await res.json();
      const n = typeof data.imported === 'number' ? data.imported : beneficiariesPayload.length;
      await refreshBeneficiaries();
      toast.success(`Imported ${n} beneficiaries.`);
      setBenCsvRows([]);
      setShowBenImport(false);
    } catch {
      toast.error('Bulk import failed (backend not reachable).');
    } finally {
      setBenImporting(false);
    }
  };

  const aadhaarVerifiedPct = Math.round((beneficiaries.filter(b => b.aadhaar).length / Math.max(beneficiaries.length, 1)) * 100);

  const sortedBeneficiaries = useMemo(() => {
    const withScore = [...beneficiaries].map(b => {
      const d = b.details || {};
      let score = 0;
      if (!b.aadhaar) score += 2;
      if (!String(d['phone'] ?? '').trim()) score += 1;
      if (!String(d['referral_source'] ?? '').trim()) score += 1;
      return { b, score };
    });
    if (benSort === 'attention') {
      withScore.sort((x, y) => y.score - x.score);
    } else {
      withScore.sort((x, y) => x.b.name.localeCompare(y.b.name));
    }
    return withScore.map(x => x.b);
  }, [beneficiaries, benSort]);

  const benScrollRef = useRef<HTMLDivElement>(null);
  const benVirtualizer = useVirtualizer({
    count: sortedBeneficiaries.length,
    getScrollElement: () => benScrollRef.current,
    estimateSize: () => 108,
    overscan: 10,
  });

  // Virtualizer-aware deep-link: resolves ?beneficiary=ID to a row index and
  // scrolls the virtualizer to it so the row mounts before the focus hook
  // runs the DOM lookup + highlight.
  useFocusFromUrl('beneficiary', {
    resolveIndex: (id) => {
      const idx = sortedBeneficiaries.findIndex(b => String(b.id) === String(id));
      return idx >= 0 ? idx : null;
    },
    onScrollToIndex: (idx) => benVirtualizer.scrollToIndex(idx, { align: 'center' }),
  });

  return (
    <div className="programs-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Programs MIS</h1>
          <p className="page-subtitle">Track beneficiaries, measure outcomes, and monitor field operations.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" style={{ border: '1px solid #16a34a', color: '#16a34a' }} onClick={() => setShowConversationalModal(true)}>
            <MessageCircle size={16} /> Conversational MIS
          </button>
          <button className="btn btn-secondary" onClick={() => { setBenCsvRows([]); setShowBenImport(true); }}>
            <Upload size={16} /> Import CSV
          </button>
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download size={16} /> Export Data
          </button>
          <button className="btn btn-secondary" onClick={() => setActiveTab('forms')}>
            <ClipboardList size={16} /> Form Builder
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => { setNewProgramName(''); setShowAddProgramModal(true); }}
            style={{ border: '1px solid #0F766E', color: '#0F766E' }}
          >
            <Plus size={16} /> Add Program
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setBenExtra({ ...BEN_EXTRA_EMPTY });
              setShowModal(true);
            }}
          >
            <UserCheck size={16} /> Enroll Beneficiary
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: 0 }}>
        {[
          { id: 'mis', label: '📊 MIS Dashboard' }, 
          { id: 'forms', label: '📋 Form Builder' },
          { id: 'toc', label: '🎯 Theory of Change' }
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            style={{ padding: '0.625rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', background: 'none', border: 'none', borderBottom: activeTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', color: activeTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', cursor: 'pointer', marginBottom: '-1px' }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'forms' && <FormBuilder />}
      {activeTab === 'toc' && <TheoryOfChangeBuilder programs={programs} />}

      {activeTab === 'mis' && (<>
        <div className="flex items-center gap-3">
          <Smartphone size={24} />
          <div>
            <div style={{ fontWeight: 600 }}>Offline Mobile App Sync</div>
            <div style={{ fontSize: '0.875rem', opacity: 0.9 }}>Not configured.</div>
          </div>
        </div>
        <div className="badge" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
          <CheckCircle2 size={14} style={{ marginRight: '4px' }} /> MIS online
        </div>

      <div className="programs-stats-row">
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><Users size={16} color="var(--color-primary)" /> Total Beneficiaries</div></div>
          <div className="mis-card-value">{beneficiaries.length.toLocaleString()}</div>
        </div>
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><ShieldCheck size={16} color="var(--color-success)" /> Aadhaar Verified</div></div>
          <div className="mis-card-value">{aadhaarVerifiedPct}%</div>
        </div>
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><Activity size={16} color="var(--color-warning)" /> Active Programs</div></div>
          <div className="mis-card-value">{programs.length}</div>
        </div>
        <div className="mis-card">
          <div className="mis-card-header"><div className="mis-card-title"><MapPin size={16} color="var(--color-danger)" /> Field Visits (Month)</div></div>
          <div className="mis-card-value">0</div>
        </div>
      </div>

      <div className="programs-grid">
        <div className="flex-col gap-6 flex">
          <div className="card">
            <div className="card-header flex justify-between items-center">
              <h3 className="card-title">Enrollments ({beneficiaries.length})</h3>
              <div className="flex items-center gap-2">
                <div className="ben-sort-toggle">
                  <button
                    className={`ben-sort-btn ${benSort === 'attention' ? 'active' : ''}`}
                    onClick={() => setBenSort('attention')}
                    title="Needs attention first"
                  >
                    <ListFilter size={11} /> Attention
                  </button>
                  <button
                    className={`ben-sort-btn ${benSort === 'alpha' ? 'active' : ''}`}
                    onClick={() => setBenSort('alpha')}
                    title="Alphabetical"
                  >
                    A–Z
                  </button>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => {
                    setBenExtra({ ...BEN_EXTRA_EMPTY });
                    setShowModal(true);
                  }}
                >
                  + Enroll
                </button>
              </div>
            </div>
            <div className="card-body" style={{ paddingBottom: '0.75rem' }}>
              {beneficiaries.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem', padding: '0.5rem 0' }}>No beneficiaries yet — enroll or import CSV.</div>
              ) : (
                <div
                  ref={benScrollRef}
                  className="beneficiary-list beneficiary-list--virtual"
                  style={{ maxHeight: 'min(52vh, 420px)', overflow: 'auto', gap: 0 }}
                >
                  <div style={{ height: benVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                    {benVirtualizer.getVirtualItems().map(vi => {
                      const ben = sortedBeneficiaries[vi.index];
                      return (
                        <div
                          key={ben.id}
                          data-index={vi.index}
                          data-focus-id={ben.id}
                          ref={benVirtualizer.measureElement}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${vi.start}px)`,
                            paddingBottom: 'var(--space-4)',
                          }}
                        >
                          <div className="beneficiary-item" style={{ margin: 0 }}>
                            <div className="ben-avatar">{ben.name.charAt(0)}</div>
                            <div className="ben-info">
                              <div className="ben-name">
                                {ben.name}
                                {ben.aadhaar && <CheckCircle2 size={14} className="aadhaar-verified" />}
                              </div>
                              <div className="ben-meta">
                                {ben.program} • {ben.location} • Family of {ben.familySize}
                              </div>
                              {(() => {
                                const d = ben.details || {};
                                const bits = [d['referral_source'], d['phone']].filter((x): x is string => typeof x === 'string' && x.length > 0);
                                if (!bits.length) return null;
                                return (
                                  <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                    {bits.join(' · ')}
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="flex gap-2 items-center">
                              {(() => {
                                const pct = computeBeneficiaryCompleteness(ben);
                                const color = pct >= 80 ? '#16A34A' : pct >= 60 ? '#d97706' : '#DC2626';
                                const bg   = pct >= 80 ? '#f0fdf4' : pct >= 60 ? '#fffbeb' : '#fef2f2';
                                const bd   = pct >= 80 ? '#86efac' : pct >= 60 ? '#fde68a' : '#fecaca';
                                return (
                                  <span
                                    title={`Profile completeness: ${pct}%`}
                                    style={{
                                      fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
                                      borderRadius: '99px', background: bg, color, border: `1px solid ${bd}`,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {pct}%
                                  </span>
                                );
                              })()}
                              <span className="badge badge-outline" style={{ fontSize: '0.7rem' }}>
                                {ben.id}
                              </span>
                              <button
                                className="btn-icon-only"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                onClick={() => {
                                  setEditBenExtra(unpackBenDetails(ben.details));
                                  setEditBen(ben);
                                  setShowEditBen(true);
                                }}
                              >
                                <Edit size={14} color="var(--color-text-secondary)" />
                              </button>
                              <button className="btn-icon-only" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => { setBenToDelete(ben); setShowDeleteBenConfirm(true); }}>
                                <Trash2 size={14} color="var(--color-danger)" />
                              </button>
                              <button
                                className="btn-icon-only"
                                title="Record outcome"
                                aria-label={`Record outcome for ${ben.name}`}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                onClick={() => setOutcomeFor({ id: ben.id, name: ben.name, program: ben.program || 'General' })}
                              >
                                <Activity size={14} color="#7C3AED" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Programme budgets — surfaces the Programs ↔ Finance link
              the audit asked for. Staff can see at a glance whether each
              programme is on track, under-spending (clawback risk), or
              over budget, without leaving Programs. */}
          {derivedPrograms.length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <div className="card-header">
                <h3 className="card-title flex items-center gap-2">
                  <Activity size={18} color="var(--color-primary)" /> Programme budgets vs spend
                </h3>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {derivedPrograms.map(p => (
                  <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 2 }}>{p}</div>
                    <ProgramBudgetBar programName={p} allowEdit />
                    <ProgramEffortSummary programName={p} />
                    <ProgramGrantsPanel programName={p} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h3 className="card-title flex items-center gap-2"><Target size={18} color="var(--color-primary)" />Impact (SDG Alignment)</h3>
            </div>
            <div className="card-body">
              <div className="sdg-tags">
                <div className="sdg-tag sdg-1">1: No Poverty</div>
                <div className="sdg-tag sdg-3">3: Good Health</div>
                <div className="sdg-tag sdg-4">4: Quality Education</div>
                <div className="sdg-tag sdg-5">5: Gender Equality</div>
              </div>
              <div style={{ marginTop: '1.5rem', background: 'var(--color-bg-main)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>KEY OUTCOME</div>
                <div style={{ fontWeight: 500, color: 'var(--color-text-tertiary)' }}>No outcome metrics recorded yet.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title">Geo-Tagged Field Activity</h3></div>
          <div className="card-body">
            <div style={{ height: '180px', background: 'linear-gradient(135deg, #e2e8f0, #f1f5f9)', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.875rem', border: '1px dashed var(--color-border)' }}>
              🗺️ Map not configured
            </div>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>Recent Check-ins</h4>
            <div className="field-visit-list">
              <div style={{ padding: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                No check-ins yet.
              </div>
            </div>
          </div>
        </div>
      </div>

      {outcomeFor && (
        <OutcomeForm
          beneficiaryId={outcomeFor.id}
          beneficiaryName={outcomeFor.name}
          programName={outcomeFor.program}
          onClose={() => setOutcomeFor(null)}
        />
      )}

      {activeTab === 'mis' && showModal && (
        <EnrollBeneficiaryModal
          programs={programs}
          existingBeneficiaries={beneficiaries.length > 0 ? beneficiaries : initialBeneficiaries}
          initialProgram={programs[0]}
          onClose={() => setShowModal(false)}
          onSubmit={handleSectionedEnroll}
        />
      )}
      {false && activeTab === 'mis' && showModal && (
        <ModalOverlay onBackdropClick={() => setShowModal(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prog-enroll-title"
            style={{ maxWidth: '540px', maxHeight: 'min(90vh, 780px)' }}
          >
            <button type="button" onClick={() => setShowModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="prog-enroll-title" style={{ marginBottom: '0.25rem', paddingRight: '2.5rem' }}>Enroll Beneficiary</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '1.25rem' }}>
              Core MIS fields plus referral, safeguards, and ID references (store masked / last digits only).
            </p>
            <form onSubmit={handleEnroll} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required type="text" className="input-field" placeholder="e.g. Meena Devi" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Program</label>
                <select className="input-field" value={form.program} onChange={e => setForm({ ...form, program: e.target.value })}>
                  {programs.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Location (District, State)</label>
                <input required type="text" className="input-field" placeholder="e.g. Nashik, MH" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Family size</label>
                  <input type="number" className="input-field" min="1" max="20" value={form.familySize} onChange={e => setForm({ ...form, familySize: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Gender (optional)</label>
                  <select className="input-field" value={benExtra.gender} onChange={e => setBenExtra({ ...benExtra, gender: e.target.value })}>
                    <option value="">—</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                    <option value="prefer_not">Prefer not to say</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="aadhaar" checked={form.aadhaar} onChange={e => setForm({ ...form, aadhaar: e.target.checked })} />
                <label htmlFor="aadhaar" style={{ fontSize: '0.875rem' }}>Aadhaar verified (consent on file)</label>
              </div>

              <div style={{ marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>Contact</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Phone</label>
                    <input type="tel" className="input-field" placeholder="+91 …" value={benExtra.phone} onChange={e => setBenExtra({ ...benExtra, phone: e.target.value })} />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Email</label>
                    <input type="email" className="input-field" value={benExtra.email} onChange={e => setBenExtra({ ...benExtra, email: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Date of birth</label>
                  <input type="date" className="input-field" value={benExtra.dob} onChange={e => setBenExtra({ ...benExtra, dob: e.target.value })} />
                </div>
              </div>

              <div style={{ marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>Referral &amp; safeguards</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Referral source</label>
                    <select className="input-field" value={benExtra.referralSource} onChange={e => setBenExtra({ ...benExtra, referralSource: e.target.value })}>
                      <option value="">—</option>
                      <option value="anganwadi">Anganwadi</option>
                      <option value="shg">SHG / community group</option>
                      <option value="camp">Outreach camp</option>
                      <option value="walk_in">Walk-in</option>
                      <option value="other_org">Partner NGO / govt</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Referral detail</label>
                    <input type="text" className="input-field" placeholder="AWC code, staff name…" value={benExtra.referralDetail} onChange={e => setBenExtra({ ...benExtra, referralDetail: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Vulnerability tags (comma separated)</label>
                  <input type="text" className="input-field" placeholder="e.g. woman_headed, pwd, sc_st, migrant" value={benExtra.vulnerabilityTags} onChange={e => setBenExtra({ ...benExtra, vulnerabilityTags: e.target.value })} />
                </div>
              </div>

              <div style={{ marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>ID reference (no full Aadhaar)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">ID type</label>
                    <select className="input-field" value={benExtra.idDocType} onChange={e => setBenExtra({ ...benExtra, idDocType: e.target.value })}>
                      <option value="">—</option>
                      <option value="aadhaar_masked">Aadhaar (masked)</option>
                      <option value="election_id">Election ID</option>
                      <option value="ration_card">Ration card</option>
                      <option value="birth_cert">Birth certificate</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">ID reference</label>
                    <input type="text" className="input-field" placeholder="Last 4 digits / doc no." value={benExtra.idDocRef} onChange={e => setBenExtra({ ...benExtra, idDocRef: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Case notes</label>
                  <textarea className="input-field" rows={2} placeholder="Internal programme notes" value={benExtra.notes} onChange={e => setBenExtra({ ...benExtra, notes: e.target.value })} />
                </div>
                <div className="flex items-center gap-2" style={{ marginTop: '0.5rem' }}>
                  <input type="checkbox" id="consentBen" checked={benExtra.consentData} onChange={e => setBenExtra({ ...benExtra, consentData: e.target.checked })} />
                  <label htmlFor="consentBen" style={{ fontSize: '0.875rem' }}>Beneficiary / guardian consented to data use for this programme</label>
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Enroll Beneficiary</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {activeTab === 'mis' && showBenImport && (
        <ModalOverlay onBackdropClick={() => { setShowBenImport(false); setBenCsvRows([]); }}>
          <div
            className="modal-card modal-card--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prog-import-ben-title"
            style={{ maxWidth: '520px' }}
          >
            <button type="button" onClick={() => { setShowBenImport(false); setBenCsvRows([]); }} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="prog-import-ben-title" style={{ marginBottom: '0.5rem', paddingRight: '2.5rem' }}>Import beneficiaries (CSV)</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              Required: <code style={{ fontSize: '0.8rem' }}>name, program, location</code>. Optional:{' '}
              <code style={{ fontSize: '0.75rem' }}>aadhaar, familySize, phone, email, gender, dob, referral_source, referral_detail, vulnerability, id_doc_type, id_doc_ref, notes</code>
            </p>
            <div className="flex gap-2" style={{ marginBottom: '1rem' }}>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => benFileRef.current?.click()}>
                <Upload size={14} /> Choose file
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem' }}
                onClick={() => {
                  const blob = new Blob([BEN_CSV_TEMPLATE], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'beneficiary_import_template.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={14} /> Template
              </button>
            </div>
            <input ref={benFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleBenCsvFile} />
            {benCsvRows.length > 0 && (() => {
              const storeBens = useStore.getState().beneficiaries;
              const existing = storeBens.length > 0 ? storeBens : initialBeneficiaries;
              const previewRows = benCsvRows.slice(0, 8);
              const dupFlags = previewRows.map(row => {
                const nameLo  = (row.name  || '').toLowerCase().trim();
                const phoneDig = (row.phone || '').replace(/\D/g, '');
                return existing.some((b: any) => {
                  const bName  = (b.name || '').toLowerCase().trim();
                  const bPhone = (b.phone || b.contact || '').replace(/\D/g, '');
                  if (nameLo  && bName  && nameLo  === bName)  return true;
                  if (phoneDig.length >= 7 && bPhone.length >= 7 && phoneDig.slice(-7) === bPhone.slice(-7)) return true;
                  return false;
                });
              });
              const dupCount = dupFlags.filter(Boolean).length;
              return (
                <>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {benCsvRows.length} row(s) — preview first {Math.min(8, benCsvRows.length)}
                    {dupCount > 0 && (
                      <span style={{ fontSize: '0.7rem', background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a', borderRadius: '99px', padding: '1px 8px', fontWeight: 600 }}>
                        ⚠ {dupCount} possible duplicate{dupCount > 1 ? 's' : ''} detected
                      </span>
                    )}
                    {dupCount === 0 && existing.length > 0 && (
                      <span style={{ fontSize: '0.7rem', background: '#f0fdf4', color: '#16A34A', border: '1px solid #86efac', borderRadius: '99px', padding: '1px 8px', fontWeight: 600 }}>
                        ✓ No duplicates found
                      </span>
                    )}
                  </div>
                  <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-bg-main)', position: 'sticky', top: 0, zIndex: 1 }}>
                          {['name', 'program', 'location', 'phone', 'status'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '0.35rem 0.5rem', whiteSpace: 'nowrap', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} style={{ borderTop: '1px solid var(--color-border-light)', background: dupFlags[i] ? '#fffbeb' : undefined }}>
                            <td style={{ padding: '0.35rem 0.5rem' }}>{row.name}</td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>{row.program}</td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>{row.location}</td>
                            <td style={{ padding: '0.35rem 0.5rem' }}>{row.phone}</td>
                            <td style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}>
                              {dupFlags[i] ? (
                                <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a', borderRadius: '4px', padding: '1px 6px', fontWeight: 600 }}>
                                  ⚠ Duplicate?
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.7rem', color: '#16A34A', fontWeight: 600 }}>✓ New</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {dupCount > 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#92400e', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#fffbeb', borderRadius: 'var(--radius-sm)', border: '1px solid #fde68a' }}>
                      ⚠ {dupCount} row{dupCount > 1 ? 's' : ''} may already exist (matched by name or phone). The import will still proceed — review highlighted rows after import.
                    </div>
                  )}
                  <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={benImporting} onClick={runBenBulkImport}>
                    {benImporting ? 'Importing…' : `Import all ${benCsvRows.length}${dupCount > 0 ? ` (${dupCount} flagged)` : ''}`}
                  </button>
                </>
              );
            })()}
          </div>
        </ModalOverlay>
      )}
      </>)}

      {/* Conversational MIS Modal */}
      {showAddProgramModal && (
        <ModalOverlay onBackdropClick={() => setShowAddProgramModal(false)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prog-add-title"
            style={{ maxWidth: '440px' }}
          >
            <button
              type="button"
              onClick={() => setShowAddProgramModal(false)}
              style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }}
              className="action-btn"
              aria-label="Close"
            >
              <X size={20} />
            </button>
            <div className="flex items-center gap-2 mb-4" style={{ paddingRight: '2.5rem' }}>
              <Target size={22} color="#0F766E" />
              <h2 id="prog-add-title" style={{ fontSize: '1.25rem', margin: 0 }}>Add Program</h2>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              Create a new programme so it appears in the enrolment dropdown,
              budget setup, and outcome tracking — even before any beneficiary
              has been added to it.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = newProgramName.trim();
                if (!trimmed) {
                  toast.error('Please enter a program name');
                  return;
                }
                const exists = programs.some(p => p.toLowerCase() === trimmed.toLowerCase());
                if (exists) {
                  toast.error('A program with that name already exists');
                  return;
                }
                addCustomProgram(trimmed);
                toast.success(`Added "${trimmed}"`);
                setShowAddProgramModal(false);
                setNewProgramName('');
              }}
              className="flex-col gap-4 flex"
            >
              <div className="input-group">
                <label className="input-label">Program name *</label>
                <input
                  className="input-field"
                  type="text"
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="e.g. Maternal Health Outreach"
                  value={newProgramName}
                  onChange={(e) => setNewProgramName(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                <Plus size={16} /> Create Program
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {showConversationalModal && (
        <ModalOverlay onBackdropClick={() => setShowConversationalModal(false)}>
          <div
            className="modal-card modal-card--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prog-conv-mis-title"
            style={{ maxWidth: '500px' }}
          >
            <button type="button" onClick={() => setShowConversationalModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <div className="flex items-center gap-2 mb-4" style={{ paddingRight: '2.5rem' }}>
              <MessageCircle size={22} color="#16a34a" />
              <h2 id="prog-conv-mis-title" style={{ fontSize: '1.25rem', margin: 0 }}>Conversational MIS (WhatsApp)</h2>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              Field staff can send activity narratives. The MIS Agent extracts structured data and geo-tags automatically.
            </p>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.5rem' }}>EXAMPLE NARRATIVE</div>
              <div style={{ fontSize: '0.8125rem', fontStyle: 'italic', color: '#0c4a6e' }}>
                "Today visited Sunita Devi, village Rampur, attended nutrition session, weight 42kg up from 38kg last month."
              </div>
            </div>
            <div className="input-group">
              <label className="input-label">Type or paste field narrative</label>
              <textarea 
                className="input-field" 
                rows={4} 
                placeholder="e.g. Conducted sewing class for 12 women in Block B..."
                value={conversationalInput}
                onChange={(e) => setConversationalInput(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} 
              disabled={!conversationalInput || isParsing}
              onClick={async () => {
                setIsParsing(true);
                try {
                  const res = await apiFetch('/webhook/field-report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      report_text: conversationalInput,
                      reporter_id: 'field_staff_001',
                      program: form.program,
                      report_date: new Date().toISOString().slice(0, 10),
                    }),
                  });
                  // Always push the submission into the supervisor review
                  // queue (Agent HQ) — the audit found that field data was
                  // counted in dashboards without any review step. Now an
                  // approver must act before it shows up in metrics.
                  let extracted: { beneficiary?: string; location?: string; metric?: string; value?: string; program?: string } = { program: form.program };
                  try {
                    if (res.ok) {
                      const data = await res.json().catch(() => ({}));
                      const ex = (data && data.extracted) || data || {};
                      extracted = {
                        beneficiary: ex.beneficiary || extractFirstMatch(conversationalInput, /(?:visited|met|spoke with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/),
                        location:    ex.location    || extractFirstMatch(conversationalInput, /village\s+([A-Z][a-zA-Z]+)/i),
                        metric:      ex.metric      || (/weight/i.test(conversationalInput) ? 'weight_kg' : undefined),
                        value:       ex.value       || extractFirstMatch(conversationalInput, /(\d+(?:\.\d+)?)\s*kg/i),
                        program:     ex.program     || form.program,
                      };
                    }
                  } catch { /* ignore parse — fall back to local heuristics */ }

                  addMisReviewIntent({
                    id: `mis-${Date.now()}`,
                    narrative: conversationalInput,
                    extracted,
                    reporterId: 'field_staff_001',
                    reportDate: new Date().toISOString().slice(0, 10),
                    createdAt: new Date().toISOString(),
                    status: 'pending',
                  });

                  toast.success("Submitted. Routed to Supervisor review queue in Agent HQ.", { icon: '✅', duration: 4500 });
                  setShowConversationalModal(false);
                  setConversationalInput('');
                } catch {
                  toast.error("Failed to submit (backend not reachable).");
                } finally {
                  setIsParsing(false);
                }
              }}
            >
              {isParsing ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              {isParsing ? 'Agent Parsing...' : 'Submit to MIS Agent'}
            </button>
          </div>
        </ModalOverlay>
      )}
      
      {/* ── Edit Beneficiary Modal ───────────────────────────────────── */}
      {showEditBen && editBen && (
        <ModalOverlay onBackdropClick={() => setShowEditBen(false)}>
          <div
            className="modal-card modal-card--wide modal-card--tall"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prog-edit-ben-title"
            style={{ maxWidth: '540px', maxHeight: 'min(90vh, 780px)' }}
          >
            <button type="button" onClick={() => setShowEditBen(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="prog-edit-ben-title" style={{ marginBottom: '1rem', paddingRight: '2.5rem' }}>Edit Beneficiary</h2>
            <form onSubmit={handleEditBenSubmit} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required type="text" className="input-field" value={editBen.name} onChange={e => setEditBen({ ...editBen, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Program</label>
                <input required type="text" className="input-field" value={editBen.program} onChange={e => setEditBen({ ...editBen, program: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Location (District, State)</label>
                <input required type="text" className="input-field" value={editBen.location} onChange={e => setEditBen({ ...editBen, location: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Family size</label>
                  <input type="number" className="input-field" min="1" max="20" value={editBen.familySize} onChange={e => setEditBen({ ...editBen, familySize: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Gender</label>
                  <select className="input-field" value={editBenExtra.gender} onChange={e => setEditBenExtra({ ...editBenExtra, gender: e.target.value })}>
                    <option value="">—</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                    <option value="prefer_not">Prefer not to say</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="edit-aadhaar" checked={editBen.aadhaar} onChange={e => setEditBen({ ...editBen, aadhaar: e.target.checked })} />
                <label htmlFor="edit-aadhaar" style={{ fontSize: '0.875rem' }}>Aadhaar verified</label>
              </div>
              <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Phone</label>
                    <input type="tel" className="input-field" value={editBenExtra.phone} onChange={e => setEditBenExtra({ ...editBenExtra, phone: e.target.value })} />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Email</label>
                    <input type="email" className="input-field" value={editBenExtra.email} onChange={e => setEditBenExtra({ ...editBenExtra, email: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Date of birth</label>
                  <input type="date" className="input-field" value={editBenExtra.dob} onChange={e => setEditBenExtra({ ...editBenExtra, dob: e.target.value })} />
                </div>
              </div>
              <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Referral source</label>
                    <select className="input-field" value={editBenExtra.referralSource} onChange={e => setEditBenExtra({ ...editBenExtra, referralSource: e.target.value })}>
                      <option value="">—</option>
                      <option value="anganwadi">Anganwadi</option>
                      <option value="shg">SHG</option>
                      <option value="camp">Camp</option>
                      <option value="walk_in">Walk-in</option>
                      <option value="other_org">Partner</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Referral detail</label>
                    <input type="text" className="input-field" value={editBenExtra.referralDetail} onChange={e => setEditBenExtra({ ...editBenExtra, referralDetail: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Vulnerability tags</label>
                  <input type="text" className="input-field" value={editBenExtra.vulnerabilityTags} onChange={e => setEditBenExtra({ ...editBenExtra, vulnerabilityTags: e.target.value })} />
                </div>
              </div>
              <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">ID type</label>
                    <select className="input-field" value={editBenExtra.idDocType} onChange={e => setEditBenExtra({ ...editBenExtra, idDocType: e.target.value })}>
                      <option value="">—</option>
                      <option value="aadhaar_masked">Aadhaar (masked)</option>
                      <option value="election_id">Election ID</option>
                      <option value="ration_card">Ration card</option>
                      <option value="birth_cert">Birth certificate</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">ID reference</label>
                    <input type="text" className="input-field" value={editBenExtra.idDocRef} onChange={e => setEditBenExtra({ ...editBenExtra, idDocRef: e.target.value })} />
                  </div>
                </div>
                <div className="input-group" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <label className="input-label">Case notes</label>
                  <textarea className="input-field" rows={2} value={editBenExtra.notes} onChange={e => setEditBenExtra({ ...editBenExtra, notes: e.target.value })} />
                </div>
                <div className="flex items-center gap-2" style={{ marginTop: '0.5rem' }}>
                  <input type="checkbox" id="edit-consentBen" checked={editBenExtra.consentData} onChange={e => setEditBenExtra({ ...editBenExtra, consentData: e.target.checked })} />
                  <label htmlFor="edit-consentBen" style={{ fontSize: '0.875rem' }}>Consent on file for programme data</label>
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Update Beneficiary</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ── Delete Confirm Modal ───────────────────────────────────── */}
      {showDeleteBenConfirm && (
        <ModalOverlay onBackdropClick={() => setShowDeleteBenConfirm(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="prog-del-ben-title"
            style={{ textAlign: 'center' }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--color-danger)', color: 'white', padding: '1rem', borderRadius: '50%' }}>
                <Trash2 size={32} />
              </div>
            </div>
            <h2 id="prog-del-ben-title" style={{ marginBottom: '0.5rem' }}>Delete Beneficiary?</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to delete <strong>{benToDelete?.name}</strong>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowDeleteBenConfirm(false)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleDeleteBen} style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)', flex: 1 }}>Delete</button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {/* ── Log Service FAB ─────────────────────────────────────── */}
      <button
        className="programs-log-fab"
        onClick={() => {
          setLogServiceSearch('');
          setLogServiceType('service_visit');
          setLogServiceNotes('');
          setShowLogService(true);
        }}
        title="Log a service visit"
      >
        <ClipboardCheck size={22} />
        <span>Log Service</span>
      </button>

      {/* ── Log Service Drawer ───────────────────────────────────── */}
      {showLogService && (
        <ModalOverlay onBackdropClick={() => setShowLogService(false)}>
          <div
            className="modal-card"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: '460px' }}
          >
            <button
              type="button"
              onClick={() => setShowLogService(false)}
              style={{ position: 'absolute', right: '1rem', top: '1rem' }}
              className="action-btn"
              aria-label="Close"
            >
              <X size={20} />
            </button>
            <div className="flex items-center gap-2" style={{ marginBottom: '1.25rem', paddingRight: '2.5rem' }}>
              <ClipboardCheck size={20} color="var(--color-primary)" />
              <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Log Service Visit</h2>
            </div>
            <div className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Search beneficiary</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Type name or ID…"
                  value={logServiceSearch}
                  onChange={e => setLogServiceSearch(e.target.value)}
                />
                {logServiceSearch.length > 1 && (
                  <div style={{ border: '1px solid var(--color-border-light)', borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)', overflow: 'hidden' }}>
                    {beneficiaries
                      .filter(b => b.name.toLowerCase().includes(logServiceSearch.toLowerCase()))
                      .slice(0, 5)
                      .map(b => (
                        <button
                          key={b.id}
                          className="log-service-suggestion"
                          type="button"
                          onClick={() => setLogServiceSearch(b.name)}
                        >
                          {b.name} — {b.program}
                        </button>
                      ))
                    }
                  </div>
                )}
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Service type</label>
                <select className="input-field" value={logServiceType} onChange={e => setLogServiceType(e.target.value)}>
                  <option value="service_visit">Service Visit</option>
                  <option value="health_check">Health Check</option>
                  <option value="counselling">Counselling Session</option>
                  <option value="training">Training / Workshop</option>
                  <option value="distribution">Material Distribution</option>
                  <option value="follow_up">Follow-up Call</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Notes</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="What happened in this session?"
                  value={logServiceNotes}
                  onChange={e => setLogServiceNotes(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => {
                  toast.success(`Service log recorded for ${logServiceSearch || 'beneficiary'}.`);
                  setShowLogService(false);
                }}
              >
                <Send size={15} /> Submit Service Log
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Tier-cap upgrade prompt — opens whenever a Starter user tries to add
          a beneficiary past the 50-record cap (UI is gated everywhere through
          enforceBeneficiaryCap so the message + CTA stay consistent). */}
      <ContextualUpgradePrompt
        open={upgradePromptOpen}
        onClose={() => setUpgradePromptOpen(false)}
        blockedAction="Adding more beneficiaries"
        reason={`Starter is capped at ${STARTER_BENEFICIARY_CAP} beneficiaries. You've reached the limit.`}
        nextBenefits={[
          'Unlimited beneficiaries · unlimited programs',
          'AI Copilot for reports & receipts',
          'WhatsApp field data entry',
          'Priority support + onboarding call',
        ]}
        targetTier="growth"
        onUpgrade={() => {
          setUpgradePromptOpen(false);
          openUpgrade({ targetTier: 'growth', source: 'programs_beneficiary_cap' });
        }}
      />
    </div>
  );
};

export default Programs;
