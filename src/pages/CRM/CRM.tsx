import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, Filter, MessageCircle, Mail, Phone, MapPin,
  IndianRupee, Clock, CheckCircle, X, UserPlus,
  Download, Upload, Users, Send, ChevronDown, ChevronUp, Zap, Loader2, Mic, Bot
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import './CRM.css';

const WA_TEMPLATES = [
  { id: 'thank', label: 'Thank You', body: 'Namaste {name}! 🙏 Thank you for your generous donation of ₹{amount} to India NGO Trust. Your support directly helps {cause}. Your 80G certificate has been sent to your email.' },
  { id: 'reactivate', label: 'Re-engagement', body: 'Namaste {name}! We miss you 💙 It\'s been a while since your last gift. Children in our programs still need your support. Even ₹500 makes a difference. Give today: sevasuite.in/give/india-ngo' },
  { id: 'impact', label: 'Impact Update', body: 'Dear {name}, your donations have helped 450 girls get digital literacy training this year 🎓 See the full impact report: [link]. Thank you for being part of this journey!' },
  { id: 'event', label: 'Event Invite', body: 'Dear {name}, you\'re invited to our Annual Gala on Dec 15th in Mumbai 🌟 As a valued donor, your seat is reserved. RSVP: [link]' },
];

const CSV_TEMPLATE = 'name,type,pan,location\nAnita Sharma,Recurring,ABCDE1234F,"Mumbai, Maharashtra"\nRaj Kumar,Major Donor,XYZAB5678G,"Delhi, NCR"';

const CRM: React.FC = () => {
  const { donors, transactions, addDonor } = useStore();
  const [activeDonorId, setActiveDonorId] = useState(donors[0]?.id || '');
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
  const [newContact, setNewContact] = useState({ name: '', type: 'Recurring', pan: '', location: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [propensity, setPropensity] = useState<{score: number, recommendation: string, insights?: any} | null>(null);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [sentiment, setSentiment] = useState<{sentiment: string, score: number} | null>(null);
  const [propensityLoading, setPropensityLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!activeDonorId || viewMode === 'heatmap') return;
    
    const fetchPropensity = async () => {
      setPropensityLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(`http://localhost:8000/analytics/donor-propensity/${activeDonorId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
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
        const token = localStorage.getItem('access_token');
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
        
        // Fetch Summary
        const sumRes = await fetch('http://localhost:8000/gen-ai/summarize', {
          method: 'POST',
          headers,
          body: JSON.stringify([
            { sender: 'Donor', text: 'I really like the work you are doing for girls education.' },
            { sender: 'SevaSuite', text: 'Thank you Anjali! Your support makes it possible.' },
            { sender: 'Donor', text: 'When is the next site visit? I would like to join.' }
          ])
        });
        
        // Fetch Sentiment
        const sentRes = await fetch(`http://localhost:8000/gen-ai/sentiment?text=${encodeURIComponent("I am very happy with the progress reports.")}`, {
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
    fetchPropensity();
    fetchAiInsights();
  }, [activeDonorId, viewMode]);

  const [nurtureQueue, setNurtureQueue] = useState<any[]>([
    { id: 'd1', name: 'Rahul Mehta', reason: 'High Propensity (₹50K)', action: 'WhatsApp Update' },
    { id: 'd2', name: 'Sunita Rao', reason: 'Lapse Risk (90 days)', action: 'Re-engagement Call' }
  ]);

  const activeDonor = useMemo(() => donors.find(d => d.id === activeDonorId) || donors[0], [donors, activeDonorId]);
  const donorTransactions = useMemo(() => transactions.filter(t => t.donorId === activeDonor?.id), [transactions, activeDonor]);

  const filteredDonors = useMemo(() => {
    return donors.filter(d => {
      const matchesSearch = d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.pan.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = activeFilter === 'All' ||
        (activeFilter === 'Major' && d.type === 'Major Donor') ||
        (activeFilter === 'Recurring' && d.type === 'Recurring') ||
        (activeFilter === 'Lapsing' && d.type === 'Lapsing');
      return matchesSearch && matchesFilter;
    });
  }, [donors, searchQuery, activeFilter]);

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    addDonor({ name: newContact.name, type: newContact.type, pan: newContact.pan, location: newContact.location, tags: ['New'] });
    toast.success(`${newContact.name} added to CRM!`);
    setShowAddContact(false);
    setNewContact({ name: '', type: 'Recurring', pan: '', location: '' });
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

  const handleSendComposer = () => {
    const recipients = bulkMode ? selectedIds.size : 1;
    const name = bulkMode ? `${recipients} donors` : activeDonor?.name;
    toast.success(`${composerChannel === 'whatsapp' ? 'WhatsApp' : 'Email'} sent to ${name}!`, { icon: composerChannel === 'whatsapp' ? '📲' : '📧' });
    setShowComposer(false);
    setSelectedIds(new Set());
    setBulkMode(false);
  };

  const openBulkCompose = (channel: 'whatsapp' | 'email') => {
    if (selectedIds.size === 0) { toast.error('Select at least one donor first.'); return; }
    setComposerChannel(channel);
    setBulkMode(true);
    setShowComposer(true);
  };

  const openSingleCompose = (channel: 'whatsapp' | 'email') => {
    setComposerChannel(channel);
    setBulkMode(false);
    setShowComposer(true);
  };

  const handleExportSelected = () => {
    const toExport = selectedIds.size > 0 ? donors.filter(d => selectedIds.has(d.id)) : donors;
    const csv = ['Name,Type,PAN,Location,Total Given,Last Gift',
      ...toExport.map(d => `${d.name},${d.type},${d.pan},"${d.location}",${d.totalGiven},${d.lastGift}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'donors_export.csv'; a.click();
    toast.success(`Exported ${toExport.length} donor records!`);
  };

  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',');
      const preview = lines.slice(1, 6).map(line => {
        const vals = line.split(',');
        return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] || '').replace(/^"|"$/g, '').trim()]));
      });
      setCsvPreview(preview);
    };
    reader.readAsText(file);
  };

  const handleCSVImport = () => {
    csvPreview.forEach(row => {
      if (row.name) addDonor({ name: row.name, type: row.type || 'Recurring', pan: row.pan || '', location: row.location || '', tags: ['Imported'] });
    });
    toast.success(`${csvPreview.length} donors imported successfully!`);
    setCsvPreview([]);
    setShowCSVImport(false);
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
              {['All', 'Major', 'Recurring', 'Lapsing'].map(tag => (
                <span key={tag} className={`filter-tag ${activeFilter === tag ? 'active' : ''}`} onClick={() => setActiveFilter(tag)}>{tag}</span>
              ))}
            </div>
            <div className="flex items-center gap-2" style={{ paddingTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', cursor: 'pointer' }} onClick={toggleSelectAll}>
              <input type="checkbox" readOnly checked={selectedIds.size === filteredDonors.length && filteredDonors.length > 0} style={{ cursor: 'pointer' }} />
              Select all ({filteredDonors.length})
            </div>
          </div>
          {/* Nurture Queue Section */}
          <div style={{ padding: '1rem', borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg-main)', borderBottom: '1px solid var(--color-border-light)', marginBottom: '1rem' }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-primary" />
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Daily Nurture Queue</span>
            </div>
            {nurtureQueue.map(item => (
              <div key={item.id} className="card" style={{ padding: '0.75rem', marginBottom: '0.5rem', border: '1px solid var(--color-border-light)' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{item.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '0.5rem' }}>{item.reason}</div>
                <button className="btn btn-primary" style={{ width: '100%', padding: '0.25rem', fontSize: '0.7rem' }} onClick={() => toast(`Drafting ${item.action}...`)}>
                  {item.action}
                </button>
              </div>
            ))}
          </div>

          <div className="donor-list">
            {filteredDonors.map(donor => (
              <div key={donor.id}
                className={`donor-item ${activeDonorId === donor.id ? 'active' : ''} ${selectedIds.has(donor.id) ? 'selected' : ''}`}
                onClick={() => setActiveDonorId(donor.id)}>
                <input type="checkbox" checked={selectedIds.has(donor.id)} onClick={e => e.stopPropagation()}
                  onChange={() => toggleSelect(donor.id)} style={{ flexShrink: 0 }} />
                <div className="donor-avatar">{donor.initial}</div>
                <div className="donor-info">
                  <div className="donor-name">{donor.name}</div>
                  <div className="donor-meta">{donor.type}</div>
                </div>
              </div>
            ))}
            {filteredDonors.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>No donors found.</div>
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
                    <div style={{ fontSize: '0.7rem', opacity: 0.9 }}>RFM: {donor.rfmScore || '78'}</div>
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
                  <div style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem' }}>
                    <span className="flex items-center gap-1"><MapPin size={14} /> {activeDonor.location}</span>
                    <span>PAN: {activeDonor.pan}</span>
                  </div>
                  <div className="profile-tags">
                    <span className="badge badge-success">{activeDonor.type}</span>
                    {activeDonor.tags.map(tag => <span key={tag} className="badge badge-outline">{tag}</span>)}
                    
                    {/* Propensity Score Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-main)', padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', marginLeft: '0.5rem' }}>
                      {propensityLoading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} color="var(--color-warning)" />}
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                        {propensityLoading ? 'Calculating...' : `Propensity: ${propensity?.score || '--'}%`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="contact-actions">
                <button className="btn btn-whatsapp" title="WhatsApp" onClick={() => openSingleCompose('whatsapp')}>
                  <MessageCircle size={16} /> WhatsApp
                </button>
                <button className="btn btn-secondary" title="Email" onClick={() => openSingleCompose('email')}>
                  <Mail size={16} />
                </button>
                <button className="btn btn-secondary" title="Call" onClick={() => toast(`Calling ${activeDonor.name}...`, { icon: '📞' })}>
                  <Phone size={16} />
                </button>
              </div>
            </div>

            <div className="detail-body">
              <div className="timeline-section">
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.125rem' }}>Activity Timeline</h3>
                {donorTransactions.map(tx => (
                  <div className="timeline-item" key={tx.id}>
                    <div className="timeline-icon" style={{ borderColor: 'var(--color-primary)' }}>
                      <IndianRupee size={10} color="var(--color-primary)" />
                    </div>
                    <div className="timeline-content">
                      <div className="timeline-date">{tx.date} • {tx.method}</div>
                      <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Donation: ₹{tx.amount.toLocaleString()}</div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Campaign: {tx.campaignTitle}</p>
                    </div>
                  </div>
                ))}
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
                      onClick={() => toast('Voice Note Capture Active... Speak now.', { icon: '🎙️' })}>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '560px', maxHeight: '90vh', overflow: 'auto', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowComposer(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => toast('Draft saved!', { icon: '💾' })}>
                Save Draft
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSendComposer}>
                <Send size={16} /> Send {bulkMode ? `to ${selectedIds.size} donors` : `to ${activeDonor?.name}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV Import Modal ─────────────────────────────────────── */}
      {showCSVImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '560px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => { setShowCSVImport(false); setCsvPreview([]); }} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '0.5rem' }}>Import Donors from CSV</h2>
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
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>Preview ({csvPreview.length} rows)</div>
                <div className="table-scroll-wrap" style={{ marginBottom: '1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
                  <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-main)' }}>
                        {['Name', 'Type', 'PAN', 'Location'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.map((row, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.name}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.type}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>{row.pan}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{row.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleCSVImport}>
                  <Users size={16} /> Import {csvPreview.length} Donors
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Add Contact Modal ───────────────────────────────────── */}
      {showAddContact && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '400px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowAddContact(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>Add New Contact</h2>
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
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">PAN Number</label>
                <input type="text" className="input-field" value={newContact.pan} onChange={e => setNewContact({ ...newContact, pan: e.target.value.toUpperCase() })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Location</label>
                <input required type="text" className="input-field" value={newContact.location} onChange={e => setNewContact({ ...newContact, location: e.target.value })} placeholder="e.g. Mumbai, Maharashtra" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Save Contact</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CRM;
