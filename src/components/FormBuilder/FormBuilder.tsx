import React, { useEffect, useState, useCallback } from 'react';
import {
  Plus, GripVertical, Trash2, ChevronDown, ChevronUp,
  Eye, Save, Send, X, Type, Hash, ToggleLeft,
  List, Calendar, MapPin, Camera, CheckSquare
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';

// ── Field Type Definitions ────────────────────────────────────────────────────

const BEN_FIELD_OPTIONS = [
  { value: '', label: '— none —' },
  { value: 'name', label: 'Full Name' },
  { value: 'location', label: 'Location' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'gender', label: 'Gender' },
  { value: 'dob', label: 'Date of Birth' },
  { value: 'aadhaar', label: 'Aadhaar Verified' },
  { value: 'familySize', label: 'Family Size' },
  { value: 'referral_source', label: 'Referral Source' },
  { value: 'referral_detail', label: 'Referral Detail' },
  { value: 'vulnerability_flags', label: 'Vulnerability Tags' },
  { value: 'notes', label: 'Notes' },
];

interface FormField {
  id: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'date' | 'location' | 'photo' | 'checkbox';
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
  skipLogic?: { ifValue: string; thenHide: string[] };
  /** Beneficiary field this form field writes back to on submission. */
  mapsToField?: string;
}

const FIELD_TYPES = [
  { type: 'text',     label: 'Short Text',    icon: <Type size={16} /> },
  { type: 'number',   label: 'Number / Count',icon: <Hash size={16} /> },
  { type: 'select',   label: 'Dropdown',      icon: <List size={16} /> },
  { type: 'boolean',  label: 'Yes / No',      icon: <ToggleLeft size={16} /> },
  { type: 'date',     label: 'Date',          icon: <Calendar size={16} /> },
  { type: 'location', label: 'GPS Location',  icon: <MapPin size={16} /> },
  { type: 'photo',    label: 'Photo Upload',  icon: <Camera size={16} /> },
  { type: 'checkbox', label: 'Multi-select',  icon: <CheckSquare size={16} /> },
] as const;

const DEFAULT_FIELDS: FormField[] = [
  { id: 'f1', type: 'text',     label: 'Beneficiary Full Name', required: true },
  { id: 'f2', type: 'select',   label: 'Program', required: true, options: ['Women Livelihood', 'Digital Literacy', 'Healthcare Camp', 'Other'] },
  { id: 'f3', type: 'number',   label: 'Family Size', required: false, placeholder: 'e.g. 4' },
  { id: 'f4', type: 'boolean',  label: 'Aadhaar Verified', required: true },
  { id: 'f5', type: 'location', label: 'Village / GPS Location', required: true },
];

const uid = () => 'f' + Math.random().toString(36).slice(2, 8);

type SavedForm = { id: string; name: string; fields: FormField[]; createdAt: string };
const LS_KEY = 'goodjobs.saved_forms.v1';

const FormBuilder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'builder' | 'forms' | 'preview'>('forms');
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS);
  const [formName, setFormName] = useState('New Field Form');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lang, setLang] = useState<'en' | 'hi' | 'mr' | 'ta'>('en');
  const [savedForms, setSavedForms] = useState<SavedForm[]>([]);
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewBenId, setPreviewBenId] = useState<string>('');

  const allBeneficiaries = useStore(s => s.beneficiaries);
  const updateBeneficiary = useStore(s => s.updateBeneficiary);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setSavedForms(parsed);
    } catch {
      // ignore
    }
  }, []);

  const persistSavedForms = (next: SavedForm[]) => {
    setSavedForms(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const LANG_LABELS: Record<string, Record<string, string>> = {
    en: { save: 'Save Form', preview: 'Preview', deploy: 'Deploy to Field App' },
    hi: { save: 'फॉर्म सहेजें', preview: 'पूर्वावलोकन', deploy: 'फील्ड ऐप पर भेजें' },
    mr: { save: 'फॉर्म जतन करा', preview: 'पूर्वावलोकन', deploy: 'फील्ड ॲपवर पाठवा' },
    ta: { save: 'படிவம் சேமி', preview: 'முன்னோட்டம்', deploy: 'Field App க்கு அனுப்பு' },
  };

  const addField = (type: FormField['type']) => {
    const newField: FormField = { id: uid(), type, label: `New ${type} field`, required: false };
    if (type === 'select' || type === 'checkbox') newField.options = ['Option 1', 'Option 2'];
    setFields(prev => [...prev, newField]);
    setExpandedId(newField.id);
    toast.success(`${type} field added`, { duration: 1500 });
  };

  const updateField = (id: string, patch: Partial<FormField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
    toast('Field removed', { duration: 1200 });
  };

  const moveField = (from: number, to: number) => {
    const arr = [...fields];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setFields(arr);
  };

  const handleDeploy = () => {
    toast('Deploy is not available yet.', { icon: '📱', duration: 2500 });
  };

  const handleSave = () => {
    const id = 'form_' + Date.now().toString(36);
    const item: SavedForm = { id, name: formName.trim() || 'Untitled form', fields, createdAt: new Date().toISOString() };
    persistSavedForms([item, ...savedForms]);
    toast.success(`Saved locally: "${item.name}"`, { icon: '💾' });
    setActiveTab('forms');
  };

  return (
    <div className="form-builder-container">
      {/* Tab Nav */}
      <div className="fb-tabs">
        {[
          { id: 'forms', label: '📋 My Forms' },
          { id: 'builder', label: '🔨 Builder' },
          { id: 'preview', label: '👁️ Preview' },
        ].map(t => (
          <button key={t.id} className={`fb-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id as any)}>
            {t.label}
          </button>
        ))}

        {activeTab === 'builder' && (
          <div className="fb-lang-selector">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginRight: '0.5rem' }}>Form language:</span>
            {[{ v: 'en', l: 'EN' }, { v: 'hi', l: 'हि' }, { v: 'mr', l: 'मर' }, { v: 'ta', l: 'த' }].map(l => (
              <button key={l.v} className={`lang-btn ${lang === l.v ? 'active' : ''}`} onClick={() => setLang(l.v as any)}>{l.l}</button>
            ))}
          </div>
        )}
      </div>

      {/* My Forms Tab */}
      {activeTab === 'forms' && (
        <div>
          <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
            <div>
              <h3 style={{ fontWeight: 700, fontSize: '1.125rem' }}>Field Data Collection Forms</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                Build once, collect offline. Syncs when field staff get connectivity.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => { setFields(DEFAULT_FIELDS); setFormName('New Field Form'); setActiveTab('builder'); }}>
              <Plus size={16} /> New Form
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {savedForms.length === 0 ? (
              <div className="card" style={{ padding: '1.25rem', color: 'var(--color-text-tertiary)' }}>
                No forms yet. Create one with “New Form”.
              </div>
            ) : savedForms.map(form => (
              <div key={form.id} className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{form.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                    {form.fields.length} fields • saved locally
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem' }}
                    onClick={() => { setFormName(form.name); setFields(form.fields); setActiveTab('builder'); }}
                  >
                    <ChevronDown size={14} /> Edit
                  </button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleDeploy}>
                    <Send size={14} /> Deploy
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Builder Tab */}
      {activeTab === 'builder' && (
        <div className="fb-layout">
          {/* Left: Field palette */}
          <div className="fb-palette">
            <div className="fb-palette-title">Add Fields</div>
            {FIELD_TYPES.map(ft => (
              <button key={ft.type} className="fb-palette-btn" onClick={() => addField(ft.type as FormField['type'])}>
                {ft.icon} <span>{ft.label}</span>
              </button>
            ))}
          </div>

          {/* Center: Canvas */}
          <div className="fb-canvas">
            <div className="flex items-center gap-2" style={{ marginBottom: '1.5rem' }}>
              <input className="input-field" value={formName} onChange={e => setFormName(e.target.value)} style={{ fontWeight: 700, fontSize: '1rem', flex: 1 }} />
              <span className="badge badge-success">{lang.toUpperCase()}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {fields.map((field, idx) => (
                <div key={field.id} className={`fb-field-card ${expandedId === field.id ? 'expanded' : ''}`}
                  draggable onDragStart={() => setDragIdx(idx)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { if (dragIdx !== null && dragIdx !== idx) { moveField(dragIdx, idx); setDragIdx(null); } }}>
                  <div className="fb-field-header" onClick={() => setExpandedId(expandedId === field.id ? null : field.id)}>
                    <div className="flex items-center gap-3">
                      <GripVertical size={16} color="var(--color-text-tertiary)" style={{ cursor: 'grab' }} />
                      <span className="fb-field-type-badge">{FIELD_TYPES.find(t => t.type === field.type)?.icon}</span>
                      <span style={{ fontWeight: 500 }}>{field.label}</span>
                      {field.required && <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c', fontSize: '0.65rem' }}>Required</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {expandedId === field.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      <button onClick={(e) => { e.stopPropagation(); removeField(field.id); }} className="action-btn" style={{ color: 'var(--color-danger)' }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {expandedId === field.id && (
                    <div className="fb-field-config">
                      <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="input-label">Field Label</label>
                        <input type="text" className="input-field" value={field.label} onChange={e => updateField(field.id, { label: e.target.value })} />
                      </div>
                      {(field.type === 'text' || field.type === 'number') && (
                        <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                          <label className="input-label">Placeholder text</label>
                          <input type="text" className="input-field" value={field.placeholder || ''} onChange={e => updateField(field.id, { placeholder: e.target.value })} />
                        </div>
                      )}
                      {(field.type === 'select' || field.type === 'checkbox') && (
                        <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                          <label className="input-label">Options (one per line)</label>
                          <textarea className="input-field" rows={3} value={(field.options || []).join('\n')}
                            onChange={e => updateField(field.id, { options: e.target.value.split('\n').filter(Boolean) })} />
                        </div>
                      )}
                      <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="input-label">Maps to beneficiary field</label>
                        <select
                          className="input-field"
                          value={field.mapsToField ?? ''}
                          onChange={e => updateField(field.id, { mapsToField: e.target.value || undefined })}
                        >
                          {BEN_FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        {field.mapsToField && (
                          <div style={{ fontSize: '0.72rem', color: '#0369a1', marginTop: 3 }}>
                            Submissions will write to beneficiary.{field.mapsToField}
                          </div>
                        )}
                      </div>
                      <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.875rem' }}>
                        <input type="checkbox" checked={field.required} onChange={e => updateField(field.id, { required: e.target.checked })} />
                        Mark as required
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="fb-actions">
              <button className="btn btn-secondary" onClick={handleSave}><Save size={16} /> {LANG_LABELS[lang].save}</button>
              <button className="btn btn-secondary" onClick={() => setActiveTab('preview')}><Eye size={16} /> {LANG_LABELS[lang].preview}</button>
              <button className="btn btn-primary" onClick={handleDeploy}><Send size={16} /> {LANG_LABELS[lang].deploy}</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ fontWeight: 700 }}>{formName}</h3>
              <span className="badge badge-success">📱 Mobile Preview</span>
            </div>
            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Filling out for beneficiary (optional)</label>
              <select
                className="input-field"
                value={previewBenId}
                onChange={e => setPreviewBenId(e.target.value)}
              >
                <option value="">— select beneficiary —</option>
                {allBeneficiaries.map(b => (
                  <option key={b.id} value={b.id}>{b.name} · {b.program}</option>
                ))}
              </select>
              {previewBenId && fields.some(f => f.mapsToField) && (
                <div style={{ fontSize: '0.7rem', color: '#0369a1', marginTop: 3 }}>
                  Submitting will write {fields.filter(f => f.mapsToField).length} mapped field{fields.filter(f => f.mapsToField).length > 1 ? 's' : ''} to this beneficiary's record.
                </div>
              )}
            </div>
            {fields.map(f => (
              <div key={f.id} className="input-group">
                <label className="input-label">
                  {f.label}{f.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
                  {f.mapsToField && <span style={{ fontSize: '0.65rem', color: '#0369a1', marginLeft: 5 }}>→ {f.mapsToField}</span>}
                </label>
                {f.type === 'text' && (
                  <input type="text" className="input-field" placeholder={f.placeholder || ''}
                    value={previewValues[f.id] ?? ''}
                    onChange={e => setPreviewValues(prev => ({ ...prev, [f.id]: e.target.value }))} />
                )}
                {f.type === 'number' && (
                  <input type="number" className="input-field" placeholder={f.placeholder || '0'}
                    value={previewValues[f.id] ?? ''}
                    onChange={e => setPreviewValues(prev => ({ ...prev, [f.id]: e.target.value }))} />
                )}
                {f.type === 'date' && (
                  <input type="date" className="input-field"
                    value={previewValues[f.id] ?? ''}
                    onChange={e => setPreviewValues(prev => ({ ...prev, [f.id]: e.target.value }))} />
                )}
                {f.type === 'boolean' && (
                  <div className="flex gap-3" style={{ paddingTop: '0.25rem' }}>
                    <label className="flex items-center gap-2">
                      <input type="radio" name={f.id} checked={previewValues[f.id] === 'yes'} onChange={() => setPreviewValues(prev => ({ ...prev, [f.id]: 'yes' }))} /> Yes
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name={f.id} checked={previewValues[f.id] === 'no'} onChange={() => setPreviewValues(prev => ({ ...prev, [f.id]: 'no' }))} /> No
                    </label>
                  </div>
                )}
                {f.type === 'select' && (
                  <select className="input-field"
                    value={previewValues[f.id] ?? ''}
                    onChange={e => setPreviewValues(prev => ({ ...prev, [f.id]: e.target.value }))}>
                    <option value="">Select…</option>
                    {f.options?.map(o => <option key={o}>{o}</option>)}
                  </select>
                )}
                {f.type === 'location' && (
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => {
                    const gps = '18.9220° N, 72.8347° E';
                    setPreviewValues(prev => ({ ...prev, [f.id]: gps }));
                    toast('📍 GPS captured: ' + gps, { duration: 2000 });
                  }}>
                    <MapPin size={14} /> {previewValues[f.id] ? `📍 ${previewValues[f.id]}` : 'Capture GPS Location'}
                  </button>
                )}
                {f.type === 'photo' && (
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => {
                    setPreviewValues(prev => ({ ...prev, [f.id]: 'photo_captured' }));
                    toast('📷 Photo captured and geotagged!', { duration: 2000 });
                  }}>
                    <Camera size={14} /> {previewValues[f.id] ? '✓ Photo captured' : 'Take Photo'}
                  </button>
                )}
                {f.type === 'checkbox' && (
                  <div className="flex flex-col gap-2" style={{ paddingTop: '0.25rem' }}>
                    {f.options?.map(o => (
                      <label key={o} className="flex items-center gap-2">
                        <input type="checkbox"
                          checked={(previewValues[f.id] ?? '').split(',').filter(Boolean).includes(o)}
                          onChange={e => {
                            const cur = (previewValues[f.id] ?? '').split(',').filter(Boolean);
                            const next = e.target.checked ? [...cur, o] : cur.filter(v => v !== o);
                            setPreviewValues(prev => ({ ...prev, [f.id]: next.join(',') }));
                          }} /> {o}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1rem' }}
              onClick={() => {
                let writtenCount = 0;
                if (previewBenId) {
                  const ben = allBeneficiaries.find(b => b.id === previewBenId);
                  if (ben) {
                    const details: Record<string, unknown> = { ...(ben.details || {}) };
                    const topLevel: Partial<typeof ben> = {};
                    for (const f of fields) {
                      const val = previewValues[f.id];
                      if (!f.mapsToField || val === undefined || val === '') continue;
                      const target = f.mapsToField;
                      if (target === 'name') { topLevel.name = val; }
                      else if (target === 'location') { topLevel.location = val; }
                      else if (target === 'familySize') { topLevel.familySize = Number(val) || ben.familySize; }
                      else if (target === 'aadhaar') { topLevel.aadhaar = val === 'yes'; }
                      else if (target === 'referral_source') { details['referral_source'] = val; }
                      else if (target === 'referral_detail') { details['referral_detail'] = val; }
                      else if (target === 'vulnerability_flags') { details['vulnerability_flags'] = val; }
                      else { details[target] = val; }
                      writtenCount++;
                    }
                    if (writtenCount > 0) {
                      updateBeneficiary({ ...ben, ...topLevel, details });
                    }
                  }
                }
                setPreviewValues({});
                if (writtenCount > 0) {
                  toast.success(`Form submitted! ${writtenCount} field${writtenCount > 1 ? 's' : ''} written to beneficiary record.`);
                } else {
                  toast.success('Form submitted! Data synced to MIS.');
                }
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FormBuilder;
