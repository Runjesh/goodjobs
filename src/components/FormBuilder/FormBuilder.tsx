import React, { useState, useCallback } from 'react';
import {
  Plus, GripVertical, Trash2, ChevronDown, ChevronUp,
  Eye, Save, Send, X, Type, Hash, ToggleLeft,
  List, Calendar, MapPin, Camera, CheckSquare
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Field Type Definitions ────────────────────────────────────────────────────
interface FormField {
  id: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'date' | 'location' | 'photo' | 'checkbox';
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];       // for select / checkbox
  skipLogic?: { ifValue: string; thenHide: string[] };
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

const SAVED_FORMS = [
  { id: 'form1', name: 'Beneficiary Enrollment Form', fields: 5, submissions: 342 },
  { id: 'form2', name: 'Health Camp Attendance', fields: 7, submissions: 178 },
  { id: 'form3', name: 'Post-Training Assessment', fields: 8, submissions: 94 },
];

const FormBuilder: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'builder' | 'forms' | 'preview'>('forms');
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS);
  const [formName, setFormName] = useState('New Field Form');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lang, setLang] = useState<'en' | 'hi' | 'mr' | 'ta'>('en');

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
    toast.success(`"${formName}" deployed to Field App! ${fields.length} fields, available offline.`, { icon: '📱', duration: 4000 });
    setActiveTab('forms');
  };

  const handleSave = () => {
    toast.success(`Form "${formName}" saved with ${fields.length} fields.`, { icon: '💾' });
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
            {SAVED_FORMS.map(form => (
              <div key={form.id} className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{form.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                    {form.fields} fields • {form.submissions} submissions
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => { setFormName(form.name); setActiveTab('builder'); }}>
                    <ChevronDown size={14} /> Edit
                  </button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => toast.success(`${form.name} deployed to Field App!`, { icon: '📱' })}>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700 }}>{formName}</h3>
              <span className="badge badge-success">📱 Mobile Preview</span>
            </div>
            {fields.map(f => (
              <div key={f.id} className="input-group">
                <label className="input-label">{f.label}{f.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}</label>
                {f.type === 'text' && <input type="text" className="input-field" placeholder={f.placeholder || ''} />}
                {f.type === 'number' && <input type="number" className="input-field" placeholder={f.placeholder || '0'} />}
                {f.type === 'date' && <input type="date" className="input-field" />}
                {f.type === 'boolean' && (
                  <div className="flex gap-3" style={{ paddingTop: '0.25rem' }}>
                    <label className="flex items-center gap-2"><input type="radio" name={f.id} /> Yes</label>
                    <label className="flex items-center gap-2"><input type="radio" name={f.id} /> No</label>
                  </div>
                )}
                {f.type === 'select' && (
                  <select className="input-field">
                    <option value="">Select…</option>
                    {f.options?.map(o => <option key={o}>{o}</option>)}
                  </select>
                )}
                {f.type === 'location' && (
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => toast('📍 GPS captured: 18.9220° N, 72.8347° E', { duration: 2000 })}>
                    <MapPin size={14} /> Capture GPS Location
                  </button>
                )}
                {f.type === 'photo' && (
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => toast('📷 Photo captured and geotagged!', { duration: 2000 })}>
                    <Camera size={14} /> Take Photo
                  </button>
                )}
                {f.type === 'checkbox' && (
                  <div className="flex flex-col gap-2" style={{ paddingTop: '0.25rem' }}>
                    {f.options?.map(o => <label key={o} className="flex items-center gap-2"><input type="checkbox" /> {o}</label>)}
                  </div>
                )}
              </div>
            ))}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => toast.success('Form submitted! Data synced to MIS.')}>
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FormBuilder;
