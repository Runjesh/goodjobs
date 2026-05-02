import React, { useMemo, useState } from 'react';
import {
  X, ChevronDown, CheckCircle2, AlertCircle, Search,
  Upload, FileText, Camera, ShieldCheck, Globe,
  User, Home, ClipboardCheck, Folder, Users
} from 'lucide-react';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import type { Beneficiary } from '../../store/useStore';

const VULNERABILITY_OPTIONS = [
  { id: 'orphan', label: 'Orphan' },
  { id: 'pwd', label: 'Person with disability' },
  { id: 'bpl', label: 'BPL' },
  { id: 'migrant', label: 'Migrant' },
  { id: 'survivor', label: 'Survivor (DV/abuse)' },
  { id: 'woman_headed', label: 'Woman-headed household' },
  { id: 'sc_st', label: 'SC / ST' },
  { id: 'minority', label: 'Religious minority' },
];

const INCOME_RANGES = [
  '< ₹5,000 / mo',
  '₹5,000 – 10,000 / mo',
  '₹10,000 – 25,000 / mo',
  '₹25,000 – 50,000 / mo',
  '> ₹50,000 / mo',
  'Not disclosed',
];

const CONSENT_TEXT: Record<'en' | 'hi' | 'mr', { title: string; body: string; check: string }> = {
  en: {
    title: 'Notice — what data we collect and why',
    body: 'We will collect your name, address, and health or education data to provide you services and report to our funders. Your data will not be shared without your permission. You can ask us to delete your data at any time.',
    check: 'I understand and consent to data being collected and used for this programme.',
  },
  hi: {
    title: 'सूचना — हम कौन सा डेटा एकत्र करते हैं और क्यों',
    body: 'हम आपकी सेवाओं को प्रदान करने और अपने दानदाताओं को रिपोर्ट करने के लिए आपका नाम, पता और स्वास्थ्य/शिक्षा डेटा एकत्र करेंगे। आपकी अनुमति के बिना आपका डेटा साझा नहीं किया जाएगा। आप किसी भी समय हमसे अपना डेटा हटाने के लिए कह सकते हैं।',
    check: 'मैं समझता/समझती हूँ और इस कार्यक्रम के लिए डेटा एकत्र करने और उपयोग करने की सहमति देता/देती हूँ।',
  },
  mr: {
    title: 'सूचना — आम्ही कोणता डेटा गोळा करतो आणि का',
    body: 'तुमच्या सेवा देण्यासाठी आणि आमच्या निधीदात्यांना अहवाल देण्यासाठी आम्ही तुमचे नाव, पत्ता आणि आरोग्य/शिक्षण डेटा गोळा करू. तुमच्या परवानगीशिवाय तुमचा डेटा शेअर केला जाणार नाही. तुम्ही कधीही आम्हाला तुमचा डेटा हटवण्यास सांगू शकता.',
    check: 'मला समजले आहे आणि या कार्यक्रमासाठी डेटा गोळा आणि वापरण्यास माझी संमती आहे.',
  },
};

export interface EnrollFormData {
  // A - Basic
  name: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  village: string;
  location: string;
  pinCode: string;
  // B - Program
  program: string;
  enrollmentDate: string;
  referralSource: string;
  referralDetail: string;
  vulnerabilityTags: string[];
  idDocType: string;
  idDocRef: string;
  aadhaar: boolean;
  // C - Household
  householdId: string;
  householdHead: string;
  familySize: number;
  monthlyIncome: string;
  // D - Consent (DPDP)
  consentLanguage: 'en' | 'hi' | 'mr';
  consentGiven: boolean;
  consentTimestamp: string;
  // E - Documents
  docAadhaar: string;
  docPhoto: string;
  docOther: string;
  docsSkipped: boolean;
  // misc
  notes: string;
}

const EMPTY_FORM: EnrollFormData = {
  name: '',
  dob: '',
  gender: '',
  phone: '',
  email: '',
  village: '',
  location: '',
  pinCode: '',
  program: '',
  enrollmentDate: new Date().toISOString().slice(0, 10),
  referralSource: '',
  referralDetail: '',
  vulnerabilityTags: [],
  idDocType: '',
  idDocRef: '',
  aadhaar: false,
  householdId: '',
  householdHead: '',
  familySize: 1,
  monthlyIncome: '',
  consentLanguage: 'en',
  consentGiven: false,
  consentTimestamp: '',
  docAadhaar: '',
  docPhoto: '',
  docOther: '',
  docsSkipped: false,
  notes: '',
};

// Profile completeness — counts how many of ~25 high-value fields are filled.
// Required Basic+Program+Consent fields are mandatory so they are always counted; the rest add granular score.
export function computeFormCompleteness(f: EnrollFormData): number {
  const checks: boolean[] = [
    !!f.name.trim(),
    !!f.dob,
    !!f.gender,
    !!f.phone.trim(),
    !!f.email.trim(),
    !!f.village.trim(),
    !!f.location.trim(),
    !!f.pinCode.trim(),
    !!f.program,
    !!f.enrollmentDate,
    !!f.referralSource,
    !!f.referralDetail.trim(),
    f.vulnerabilityTags.length > 0,
    !!f.idDocType,
    !!f.idDocRef.trim(),
    f.aadhaar,
    !!f.householdHead.trim(),
    !!f.monthlyIncome,
    f.familySize > 0,
    f.consentGiven,
    !!f.docAadhaar || f.docsSkipped,
    !!f.docPhoto || f.docsSkipped,
    !!f.notes.trim(),
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

// Compute completeness for an existing Beneficiary record (used on cards / watch list).
export function computeBeneficiaryCompleteness(b: Beneficiary): number {
  const d = (b.details || {}) as Record<string, unknown>;
  const has = (k: string): boolean => {
    const v = d[k];
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  };
  const checks: boolean[] = [
    !!b.name?.trim(),
    has('dob'),
    has('gender'),
    has('phone'),
    has('email'),
    has('village'),
    !!b.location?.trim(),
    has('pin_code'),
    !!b.program?.trim(),
    has('enrollment_date'),
    has('referral_source'),
    has('referral_detail'),
    has('vulnerability_flags'),
    has('id_doc_type'),
    has('id_doc_ref'),
    !!b.aadhaar,
    has('household_head'),
    has('monthly_income'),
    b.familySize > 0,
    has('consent_given'),
    has('doc_aadhaar') || has('docs_skipped'),
    has('doc_photo') || has('docs_skipped'),
    has('notes'),
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

// Fuzzy duplicate detection. Returns matches scored 0..1 where >=0.6 is "likely duplicate".
function nameSimilarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Token overlap (Jaccard-ish on words)
  const xt = new Set(x.split(/\s+/));
  const yt = new Set(y.split(/\s+/));
  let overlap = 0;
  xt.forEach(t => { if (yt.has(t)) overlap += 1; });
  const union = new Set([...xt, ...yt]).size;
  const tokenScore = union > 0 ? overlap / union : 0;
  // Also check substring containment for short names
  if (x.length >= 4 && (y.includes(x) || x.includes(y))) {
    return Math.max(tokenScore, 0.75);
  }
  return tokenScore;
}

function villageMatch(a: string, b: string): boolean {
  const ax = a.toLowerCase().trim();
  const bx = b.toLowerCase().trim();
  if (!ax || !bx) return false;
  // Match on first token (village name) of both location strings
  return ax.split(/[,\s]/)[0] === bx.split(/[,\s]/)[0];
}

function dobMatch(a: string, b: string): 'exact' | 'year' | 'none' {
  if (!a || !b) return 'none';
  if (a === b) return 'exact';
  const ya = a.slice(0, 4);
  const yb = b.slice(0, 4);
  if (ya && yb && ya === yb) return 'year';
  return 'none';
}

export interface DuplicateMatch {
  beneficiary: Beneficiary;
  score: number;
  reasons: string[];
}

export function detectDuplicates(
  form: { name: string; village: string; location: string; dob: string; phone?: string },
  existing: Beneficiary[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const b of existing) {
    const reasons: string[] = [];
    const nameScore = nameSimilarity(form.name, b.name);
    let score = nameScore * 0.5;
    if (nameScore >= 0.95) reasons.push('Name matches exactly');
    else if (nameScore >= 0.6) reasons.push('Name is similar');

    const bVillage = String((b.details as Record<string, unknown> | undefined)?.['village'] ?? '');
    const villageHere = form.village || form.location;
    const villageThere = bVillage || b.location;
    if (villageMatch(villageHere, villageThere)) {
      score += 0.2;
      reasons.push('Same village/area');
    }

    const bDob = String((b.details as Record<string, unknown> | undefined)?.['dob'] ?? '');
    const dobm = dobMatch(form.dob, bDob);
    if (dobm === 'exact') { score += 0.25; reasons.push('Date of birth matches'); }
    else if (dobm === 'year') { score += 0.1; reasons.push('Birth year matches'); }

    const bPhone = String((b.details as Record<string, unknown> | undefined)?.['phone'] ?? '');
    if (form.phone && bPhone) {
      const a = form.phone.replace(/\D/g, '').slice(-7);
      const b2 = bPhone.replace(/\D/g, '').slice(-7);
      if (a && b2 && a === b2) {
        score += 0.3;
        reasons.push('Same phone number');
      }
    }

    if (score >= 0.6 && reasons.length > 0) {
      matches.push({ beneficiary: b, score: Math.min(score, 1), reasons });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3);
}

interface SectionState {
  key: 'A' | 'B' | 'C' | 'D' | 'E';
  title: string;
  icon: React.ElementType;
  required: boolean;
  complete: boolean;
}

interface Props {
  programs: string[];
  existingBeneficiaries: Beneficiary[];
  initialProgram?: string;
  onClose: () => void;
  onSubmit: (form: EnrollFormData) => void;
}

const EnrollBeneficiaryModal: React.FC<Props> = ({
  programs, existingBeneficiaries, initialProgram, onClose, onSubmit,
}) => {
  const [form, setForm] = useState<EnrollFormData>({
    ...EMPTY_FORM,
    program: initialProgram || programs[0] || '',
  });
  const [openSection, setOpenSection] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('A');
  const [householdQuery, setHouseholdQuery] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [showDupModal, setShowDupModal] = useState(false);

  const setF = <K extends keyof EnrollFormData>(k: K, v: EnrollFormData[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const completeness = useMemo(() => computeFormCompleteness(form), [form]);

  // Section-level completion (required-fields gating)
  const sectionAComplete = !!form.name.trim() && !!form.location.trim();
  const sectionBComplete = !!form.program;
  const sectionCComplete = form.familySize > 0;
  const sectionDComplete = form.consentGiven;
  const sectionEComplete = form.docsSkipped || !!form.docAadhaar || !!form.docPhoto || !!form.docOther;

  const sections: SectionState[] = [
    { key: 'A', title: 'Basic Info',     icon: User,           required: true,  complete: sectionAComplete },
    { key: 'B', title: 'Program',        icon: ClipboardCheck, required: true,  complete: sectionBComplete },
    { key: 'C', title: 'Household',      icon: Home,           required: false, complete: sectionCComplete },
    { key: 'D', title: 'Consent (DPDP)', icon: ShieldCheck,    required: true,  complete: sectionDComplete },
    { key: 'E', title: 'Documents',      icon: Folder,         required: false, complete: sectionEComplete },
  ];

  const canSave = sectionAComplete && sectionBComplete && sectionDComplete;

  // Household typeahead — derive existing households from beneficiaries
  const allHouseholds = useMemo(() => {
    const map = new Map<string, { id: string; head: string; village: string; size: number }>();
    for (const b of existingBeneficiaries) {
      const d = (b.details || {}) as Record<string, unknown>;
      const head = String(d['household_head'] || '').trim();
      const id = String(d['household_id'] || '').trim();
      if (!head && !id) continue;
      const key = id || `${head}|${b.location}`;
      if (!map.has(key)) {
        map.set(key, {
          id: id || `HH-${head.replace(/\s+/g, '_').toLowerCase()}-${b.location.split(/[,]/)[0].trim()}`,
          head: head || 'Household',
          village: String(d['village'] || b.location),
          size: b.familySize || 1,
        });
      }
    }
    return Array.from(map.values());
  }, [existingBeneficiaries]);

  const householdResults = useMemo(() => {
    const q = householdQuery.trim().toLowerCase();
    if (!q) return [];
    return allHouseholds
      .filter(h => h.head.toLowerCase().includes(q) || h.village.toLowerCase().includes(q))
      .slice(0, 5);
  }, [householdQuery, allHouseholds]);

  const linkHousehold = (h: { id: string; head: string; village: string; size: number }) => {
    setForm(prev => ({
      ...prev,
      householdId: h.id,
      householdHead: h.head,
      familySize: prev.familySize > 1 ? prev.familySize : h.size,
      village: prev.village || h.village,
    }));
    setHouseholdQuery(`${h.head} · ${h.village}`);
  };

  const toggleVulnerability = (id: string) => {
    setForm(prev => ({
      ...prev,
      vulnerabilityTags: prev.vulnerabilityTags.includes(id)
        ? prev.vulnerabilityTags.filter(t => t !== id)
        : [...prev.vulnerabilityTags, id],
    }));
  };

  const handleFile = (key: 'docAadhaar' | 'docPhoto' | 'docOther') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setF(key, file.name);
    setF('docsSkipped', false);
  };

  const handleSave = () => {
    if (!canSave) return;
    const stamped: EnrollFormData = {
      ...form,
      consentTimestamp: form.consentTimestamp || new Date().toISOString(),
    };
    const dups = detectDuplicates(
      { name: form.name, village: form.village, location: form.location, dob: form.dob, phone: form.phone },
      existingBeneficiaries,
    );
    if (dups.length > 0) {
      setDuplicates(dups);
      setShowDupModal(true);
      setForm(stamped);
      return;
    }
    onSubmit(stamped);
  };

  const handleDupAction = (action: 'merge' | 'create') => {
    setShowDupModal(false);
    if (action === 'create') onSubmit(form);
    else onClose(); // merge: close so user opens existing record from the list
  };

  const Header = (
    <div className="enroll-header">
      <button type="button" onClick={onClose} className="action-btn" aria-label="Close" style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }}>
        <X size={20} />
      </button>
      <div style={{ paddingRight: '2.5rem' }}>
        <h2 id="enroll-title" style={{ marginBottom: '0.25rem' }}>Enroll Beneficiary</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '0.875rem' }}>
          Five sections. Required: Basic, Program, Consent. Skip optional sections to come back later.
        </p>
      </div>
      <div className="enroll-progress-row">
        <div className="enroll-progress-track">
          <div className="enroll-progress-fill" style={{ width: `${completeness}%` }} />
        </div>
        <span className="enroll-progress-pct">{completeness}% complete</span>
      </div>
      <div className="enroll-stepper">
        {sections.map((s, i) => {
          const Icon = s.icon;
          const isOpen = openSection === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={`enroll-step ${isOpen ? 'open' : ''} ${s.complete ? 'done' : ''} ${!s.complete && s.required ? 'required' : ''}`}
              onClick={() => setOpenSection(s.key)}
              aria-label={`Section ${i + 1}: ${s.title}`}
            >
              <span className="enroll-step-marker">
                {s.complete ? <CheckCircle2 size={13} /> : <Icon size={13} />}
              </span>
              <span className="enroll-step-label">{s.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderSection = (s: SectionState, body: React.ReactNode) => {
    const isOpen = openSection === s.key;
    const Icon = s.icon;
    return (
      <div className={`enroll-section ${isOpen ? 'open' : ''}`} key={s.key}>
        <button
          type="button"
          className="enroll-section-head"
          onClick={() => setOpenSection(isOpen ? ('' as any) : s.key)}
          aria-expanded={isOpen}
        >
          <span className={`enroll-section-icon ${s.complete ? 'done' : ''}`}>
            {s.complete ? <CheckCircle2 size={14} /> : <Icon size={14} />}
          </span>
          <span className="enroll-section-title">
            {s.title}
            {s.required && !s.complete && <span className="enroll-required-tag">Required</span>}
            {s.complete && <span className="enroll-done-tag">Done</span>}
          </span>
          <ChevronDown size={16} className="enroll-section-chev" />
        </button>
        {isOpen && <div className="enroll-section-body">{body}</div>}
      </div>
    );
  };

  return (
    <ModalOverlay onBackdropClick={onClose}>
      <div
        className="modal-card enroll-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="enroll-title"
      >
        {Header}

        <div className="enroll-sections">
          {/* SECTION A — BASIC INFO */}
          {renderSection(sections[0], (
            <>
              <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                <label className="input-label">Full name <span className="req">*</span></label>
                <input required type="text" className="input-field" placeholder="e.g. Meena Devi" value={form.name} onChange={e => setF('name', e.target.value)} />
              </div>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Date of birth</label>
                  <input type="date" className="input-field" value={form.dob} onChange={e => setF('dob', e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Gender</label>
                  <select className="input-field" value={form.gender} onChange={e => setF('gender', e.target.value)}>
                    <option value="">—</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                    <option value="prefer_not">Prefer not to say</option>
                  </select>
                </div>
              </div>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Phone</label>
                  <input type="tel" className="input-field" placeholder="+91 …" value={form.phone} onChange={e => setF('phone', e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Email</label>
                  <input type="email" className="input-field" placeholder="optional" value={form.email} onChange={e => setF('email', e.target.value)} />
                </div>
              </div>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Village / area</label>
                  <input type="text" className="input-field" placeholder="e.g. Piparia" value={form.village} onChange={e => setF('village', e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Pin code</label>
                  <input type="text" className="input-field" inputMode="numeric" maxLength={6} placeholder="e.g. 422001" value={form.pinCode} onChange={e => setF('pinCode', e.target.value)} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">District &amp; state <span className="req">*</span></label>
                <input required type="text" className="input-field" placeholder="e.g. Nashik, MH" value={form.location} onChange={e => setF('location', e.target.value)} />
              </div>
            </>
          ))}

          {/* SECTION B — PROGRAM */}
          {renderSection(sections[1], (
            <>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Program <span className="req">*</span></label>
                  <select className="input-field" value={form.program} onChange={e => setF('program', e.target.value)}>
                    <option value="">— Select —</option>
                    {programs.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Enrollment date</label>
                  <input type="date" className="input-field" value={form.enrollmentDate} onChange={e => setF('enrollmentDate', e.target.value)} />
                </div>
              </div>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Referral source</label>
                  <select className="input-field" value={form.referralSource} onChange={e => setF('referralSource', e.target.value)}>
                    <option value="">—</option>
                    <option value="phc">PHC / govt health post</option>
                    <option value="anganwadi">Anganwadi</option>
                    <option value="shg">SHG / community group</option>
                    <option value="camp">Outreach camp</option>
                    <option value="self">Self / walk-in</option>
                    <option value="other_org">Partner NGO / govt</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Referral detail</label>
                  <input type="text" className="input-field" placeholder="AWC code, staff name…" value={form.referralDetail} onChange={e => setF('referralDetail', e.target.value)} />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Vulnerability tags <span className="hint">(multi-select)</span></label>
                <div className="chip-row">
                  {VULNERABILITY_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`chip ${form.vulnerabilityTags.includes(opt.id) ? 'on' : ''}`}
                      onClick={() => toggleVulnerability(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">ID type</label>
                  <select className="input-field" value={form.idDocType} onChange={e => setF('idDocType', e.target.value)}>
                    <option value="">—</option>
                    <option value="aadhaar_masked">Aadhaar (masked)</option>
                    <option value="election_id">Election ID</option>
                    <option value="ration_card">Ration card</option>
                    <option value="birth_cert">Birth certificate</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">ID reference</label>
                  <input type="text" className="input-field" placeholder="Last 4 digits / doc no." value={form.idDocRef} onChange={e => setF('idDocRef', e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: '0.25rem' }}>
                <input type="checkbox" id="aadhaarVerified" checked={form.aadhaar} onChange={e => setF('aadhaar', e.target.checked)} />
                <label htmlFor="aadhaarVerified" style={{ fontSize: '0.875rem' }}>Aadhaar verified (consent on file)</label>
              </div>
              <div className="input-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                <label className="input-label">Case notes</label>
                <textarea className="input-field" rows={2} placeholder="Internal programme notes" value={form.notes} onChange={e => setF('notes', e.target.value)} />
              </div>
            </>
          ))}

          {/* SECTION C — HOUSEHOLD */}
          {renderSection(sections[2], (
            <>
              <div className="input-group">
                <label className="input-label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Search size={12} /> Link to existing household
                  </span>
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Search by household head name or village…"
                  value={householdQuery}
                  onChange={e => { setHouseholdQuery(e.target.value); setF('householdId', ''); }}
                />
                {householdResults.length > 0 && (
                  <div className="hh-suggestions">
                    {householdResults.map(h => (
                      <button
                        key={h.id}
                        type="button"
                        className={`hh-suggestion ${form.householdId === h.id ? 'selected' : ''}`}
                        onClick={() => linkHousehold(h)}
                      >
                        <Users size={12} />
                        <span className="hh-head">{h.head}</span>
                        <span className="hh-village">{h.village}</span>
                        <span className="hh-size">family of {h.size}</span>
                      </button>
                    ))}
                  </div>
                )}
                {form.householdId && (
                  <div className="hh-linked">
                    <CheckCircle2 size={12} /> Linked to household <strong>{form.householdHead}</strong> ({form.householdId})
                    <button
                      type="button"
                      className="hh-unlink"
                      onClick={() => { setF('householdId', ''); setF('householdHead', ''); setHouseholdQuery(''); }}
                    >
                      Unlink
                    </button>
                  </div>
                )}
                <div className="hh-or">— or create a new household —</div>
              </div>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Household head name</label>
                  <input type="text" className="input-field" placeholder="e.g. Ram Singh" value={form.householdHead} onChange={e => { setF('householdHead', e.target.value); setF('householdId', ''); }} />
                </div>
                <div className="input-group">
                  <label className="input-label">Family size</label>
                  <input type="number" className="input-field" min={1} max={30} value={form.familySize} onChange={e => setF('familySize', Number(e.target.value) || 1)} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Monthly household income</label>
                <select className="input-field" value={form.monthlyIncome} onChange={e => setF('monthlyIncome', e.target.value)}>
                  <option value="">—</option>
                  {INCOME_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </>
          ))}

          {/* SECTION D — CONSENT (DPDP) */}
          {renderSection(sections[3], (
            <>
              <div className="consent-lang-row">
                <span className="consent-lang-label"><Globe size={12} /> Language</span>
                {(['en', 'hi', 'mr'] as const).map(l => (
                  <button
                    key={l}
                    type="button"
                    className={`consent-lang-btn ${form.consentLanguage === l ? 'on' : ''}`}
                    onClick={() => setF('consentLanguage', l)}
                  >
                    {l === 'en' ? 'English' : l === 'hi' ? 'हिंदी' : 'मराठी'}
                  </button>
                ))}
              </div>
              <div className="consent-notice">
                <div className="consent-notice-title">{CONSENT_TEXT[form.consentLanguage].title}</div>
                <p className="consent-notice-body">{CONSENT_TEXT[form.consentLanguage].body}</p>
              </div>
              <label className="consent-check">
                <input
                  type="checkbox"
                  checked={form.consentGiven}
                  onChange={e => {
                    setF('consentGiven', e.target.checked);
                    setF('consentTimestamp', e.target.checked ? new Date().toISOString() : '');
                  }}
                />
                <span>{CONSENT_TEXT[form.consentLanguage].check} <span className="req">*</span></span>
              </label>
              {form.consentGiven && form.consentTimestamp && (
                <div className="consent-stamp">
                  <CheckCircle2 size={12} /> Consent recorded {new Date(form.consentTimestamp).toLocaleString()} ({form.consentLanguage.toUpperCase()})
                </div>
              )}
              {!form.consentGiven && (
                <div className="consent-warn">
                  <AlertCircle size={12} /> DPDP Act §7 requires explicit consent before saving any beneficiary record.
                </div>
              )}
            </>
          ))}

          {/* SECTION E — DOCUMENTS */}
          {renderSection(sections[4], (
            <>
              <p className="docs-help">Upload now if available, or skip and the record will be flagged "incomplete" for follow-up.</p>
              <div className="doc-row">
                <div className="doc-label"><FileText size={14} /> Aadhaar (masked or last-4)</div>
                {form.docAadhaar ? (
                  <div className="doc-uploaded"><CheckCircle2 size={12} /> {form.docAadhaar}
                    <button type="button" onClick={() => setF('docAadhaar', '')} className="doc-clear">remove</button>
                  </div>
                ) : (
                  <label className="doc-pick">
                    <Upload size={12} /> Choose file
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile('docAadhaar')} hidden />
                  </label>
                )}
              </div>
              <div className="doc-row">
                <div className="doc-label"><Camera size={14} /> Photo</div>
                {form.docPhoto ? (
                  <div className="doc-uploaded"><CheckCircle2 size={12} /> {form.docPhoto}
                    <button type="button" onClick={() => setF('docPhoto', '')} className="doc-clear">remove</button>
                  </div>
                ) : (
                  <label className="doc-pick">
                    <Upload size={12} /> Choose file
                    <input type="file" accept="image/*" onChange={handleFile('docPhoto')} hidden />
                  </label>
                )}
              </div>
              <div className="doc-row">
                <div className="doc-label"><Folder size={14} /> Other (consent form, BPL card, …)</div>
                {form.docOther ? (
                  <div className="doc-uploaded"><CheckCircle2 size={12} /> {form.docOther}
                    <button type="button" onClick={() => setF('docOther', '')} className="doc-clear">remove</button>
                  </div>
                ) : (
                  <label className="doc-pick">
                    <Upload size={12} /> Choose file
                    <input type="file" onChange={handleFile('docOther')} hidden />
                  </label>
                )}
              </div>
              <label className="docs-skip">
                <input
                  type="checkbox"
                  checked={form.docsSkipped}
                  onChange={e => setF('docsSkipped', e.target.checked)}
                />
                Skip documents for now — flag this record as incomplete
              </label>
            </>
          ))}
        </div>

        <div className="enroll-footer">
          {!canSave && (
            <div className="enroll-footer-warn">
              <AlertCircle size={12} /> Complete required sections (Basic, Program, Consent) before saving.
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            onClick={handleSave}
            style={{ width: '100%' }}
          >
            Save &amp; enroll
          </button>
        </div>
      </div>

      {showDupModal && (
        <DuplicateMatchModal
          form={form}
          matches={duplicates}
          onAction={handleDupAction}
          onCancel={() => setShowDupModal(false)}
        />
      )}
    </ModalOverlay>
  );
};

const DuplicateMatchModal: React.FC<{
  form: EnrollFormData;
  matches: DuplicateMatch[];
  onAction: (action: 'merge' | 'create') => void;
  onCancel: () => void;
}> = ({ form, matches, onAction, onCancel }) => {
  const top = matches[0];
  return (
    <div className="dup-overlay" onClick={onCancel}>
      <div className="dup-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="dup-header">
          <AlertCircle size={18} color="#d97706" />
          <div>
            <h3 className="dup-title">This looks like an existing record</h3>
            <p className="dup-sub">
              We found {matches.length} possible match{matches.length === 1 ? '' : 'es'}. Review before saving — duplicate beneficiaries break grant reporting.
            </p>
          </div>
        </div>

        <div className="dup-grid">
          <div className="dup-col">
            <div className="dup-col-head">New record (you are creating)</div>
            <div className="dup-row"><span>Name</span><strong>{form.name || '—'}</strong></div>
            <div className="dup-row"><span>DOB</span><strong>{form.dob || '—'}</strong></div>
            <div className="dup-row"><span>Village</span><strong>{form.village || '—'}</strong></div>
            <div className="dup-row"><span>District</span><strong>{form.location || '—'}</strong></div>
            <div className="dup-row"><span>Phone</span><strong>{form.phone || '—'}</strong></div>
            <div className="dup-row"><span>Program</span><strong>{form.program || '—'}</strong></div>
          </div>
          <div className="dup-col dup-col-existing">
            <div className="dup-col-head">
              Existing record · {Math.round(top.score * 100)}% match
            </div>
            <div className="dup-row"><span>Name</span><strong>{top.beneficiary.name}</strong></div>
            <div className="dup-row"><span>DOB</span><strong>{String((top.beneficiary.details as any)?.dob || '—')}</strong></div>
            <div className="dup-row"><span>Village</span><strong>{String((top.beneficiary.details as any)?.village || top.beneficiary.location.split(',')[0])}</strong></div>
            <div className="dup-row"><span>District</span><strong>{top.beneficiary.location}</strong></div>
            <div className="dup-row"><span>Phone</span><strong>{String((top.beneficiary.details as any)?.phone || '—')}</strong></div>
            <div className="dup-row"><span>Program</span><strong>{top.beneficiary.program}</strong></div>
            <div className="dup-row"><span>ID</span><strong>{top.beneficiary.id}</strong></div>
            <div className="dup-reasons">
              {top.reasons.map(r => <span key={r} className="dup-reason">{r}</span>)}
            </div>
          </div>
        </div>

        {matches.length > 1 && (
          <div className="dup-others">
            Other possible matches: {matches.slice(1).map(m => `${m.beneficiary.name} (${Math.round(m.score * 100)}%)`).join(', ')}
          </div>
        )}

        <div className="dup-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-secondary" onClick={() => onAction('merge')}>
            Use existing record
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onAction('create')}>
            Create new anyway
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnrollBeneficiaryModal;
