import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Clock, Users, MapPin, UserPlus, Send, CheckCircle2, ShieldAlert, X, Bell, Calendar } from 'lucide-react';
import { useStore } from '../../store/useStore';
import toast from 'react-hot-toast';
import './Volunteers.css';
import { apiFetch } from '../../api/client';

type Shift = { id: number; title: string; date: string; location: string; filled: number; total: number; role: string };
type Signup = { id: string; shiftId: number; volunteerName: string; createdAt?: string };

const Volunteers: React.FC = () => {
  const { volunteers, addVolunteer } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [reminderConfig, setReminderConfig] = useState({ timing: '24h', channel: 'whatsapp', message: '' });
  const [form, setForm] = useState({ name: '', skills: '', verified: false });
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [signupShift, setSignupShift] = useState<Shift | null>(null);
  const [signupName, setSignupName] = useState('');

  const shiftListRef = useRef<HTMLDivElement>(null);
  const shiftVirtualizer = useVirtualizer({
    count: shifts.length,
    getScrollElement: () => shiftListRef.current,
    estimateSize: () => 148,
    overscan: 6,
  });

  const rosterRef = useRef<HTMLDivElement>(null);
  const rosterVirtualizer = useVirtualizer({
    count: volunteers.length,
    getScrollElement: () => rosterRef.current,
    estimateSize: () => 68,
    overscan: 10,
  });

  const refresh = async () => {
    setShiftsLoading(true);
    try {
      const [sRes, suRes] = await Promise.all([
        apiFetch('/volunteers/shifts'),
        apiFetch('/volunteers/signups'),
      ]);
      if (sRes.ok) {
        const sData = await sRes.json();
        const list = Array.isArray(sData.shifts) ? sData.shifts : [];
        setShifts(list);
        setSelectedShift((prev) => prev ?? list[0] ?? null);
      }
      if (suRes.ok) {
        const suData = await suRes.json();
        setSignups(Array.isArray(suData.signups) ? suData.signups : []);
      }
    } catch {
      // keep empty; page still usable for roster + broadcast
    } finally {
      setShiftsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleAddVolunteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const skills = form.skills.split(',').map(s => s.trim()).filter(Boolean);
    try {
      const res = await apiFetch('/volunteers/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, skills, verified: form.verified }),
      });
      if (!res.ok) throw new Error('create');
      // refresh roster from backend so IDs match canonical records
      const r = await apiFetch('/volunteers/roster');
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.volunteers)) useStore.getState().setVolunteers(data.volunteers);
      }
      toast.success(`${form.name} added to volunteer roster!`);
      setForm({ name: '', skills: '', verified: false });
      setShowModal(false);
    } catch {
      toast.error('Failed to add volunteer (backend not reachable).');
    }
  };

  const handleBroadcast = async () => {
    try {
      const res = await apiFetch('/volunteers/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'whatsapp',
          audience: 'all',
          message: 'Namaste! New volunteer opportunity is open. Reply YES to join. धन्यवाद 🙏',
        }),
      });
      if (!res.ok) throw new Error('broadcast failed');
      toast.success('Broadcast queued to volunteers.', { icon: '📲' });
    } catch {
      toast.error('Failed to queue broadcast (backend not reachable).');
    }
  };

  const handleManageShift = (title: string) => {
    const shift = shifts.find(s => s.title === title) || shifts[0] || null;
    setSelectedShift(shift);
    setShowReminderModal(true);
  };

  const handleSendReminder = async () => {
    if (!selectedShift) return;
    try {
      const res = await apiFetch('/volunteers/reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shift_id: selectedShift.id,
          shift_title: selectedShift.title,
          shift_datetime: selectedShift.date,
          channel: reminderConfig.channel,
          timing: reminderConfig.timing,
          message: reminderConfig.message || undefined,
          recipients: selectedShift.filled,
        }),
      });
      if (!res.ok) throw new Error('reminder failed');
      toast.success(`Reminder scheduled for "${selectedShift.title}".`, { icon: '🔔', duration: 4000 });
      setShowReminderModal(false);
    } catch {
      toast.error('Failed to schedule reminder (backend not reachable).');
    }
  };

  const shiftSignupCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of signups) m.set(s.shiftId, (m.get(s.shiftId) || 0) + 1);
    return m;
  }, [signups]);

  const handleSignup = async (shiftId: number) => {
    const shift = shifts.find(s => s.id === shiftId) || null;
    setSignupShift(shift);
    setSignupName('');
    setShowSignupModal(true);
  };

  const submitSignup = async () => {
    if (!signupShift) return;
    const name = signupName.trim();
    if (!name) return;
    try {
      const res = await apiFetch(`/volunteers/shifts/${encodeURIComponent(String(signupShift.id))}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volunteer_name: name }),
      });
      if (!res.ok) throw new Error('signup');
      toast.success('Signed up.');
      setShowSignupModal(false);
      refresh();
    } catch {
      toast.error('Failed to sign up.');
    }
  };

  return (
    <div className="volunteers-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Volunteer Operations</h1>
          <p className="page-subtitle">Recruit, schedule, and track volunteer impact hours.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" onClick={handleBroadcast}>
            <Send size={16} /> Broadcast WhatsApp
          </button>
          <button className="btn btn-secondary" onClick={() => { setSelectedShift(shifts[0] || null); setShowReminderModal(true); }}>
            <Bell size={16} /> Schedule Reminder
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <UserPlus size={16} /> Add Volunteer
          </button>
        </div>
      </div>

      <div className="volunteers-stats-row">
        <div className="vol-card">
          <div className="vol-card-header"><div className="vol-card-title"><Users size={16} color="var(--color-primary)" /> Total Active</div></div>
          <div className="vol-card-value">{volunteers.length}</div>
        </div>
        <div className="vol-card">
          <div className="vol-card-header"><div className="vol-card-title"><Clock size={16} color="var(--color-success)" /> Hours Logged (YTD)</div></div>
          <div className="vol-card-value">{volunteers.reduce((s,v)=>s+v.hours,0).toLocaleString()}</div>
        </div>
        <div className="vol-card">
          <div className="vol-card-header"><div className="vol-card-title"><Clock size={16} color="var(--color-warning)" /> Upcoming Shifts</div></div>
          <div className="vol-card-value">{shifts.length}</div>
        </div>
        <div className="vol-card">
          <div className="vol-card-header"><div className="vol-card-title"><Users size={16} color="var(--color-danger)" /> Corp Partners</div></div>
          <div className="vol-card-value">0</div>
        </div>
      </div>

      <div className="volunteers-grid">
        <div className="flex-col gap-6 flex">
          <div className="card">
            <div className="card-header flex justify-between items-center">
              <h3 className="card-title">Shift Scheduling</h3>
              <div className="flex gap-2">
                <span className="badge badge-outline">{shiftsLoading ? 'Loading…' : 'List View'}</span>
                <button className="btn btn-secondary" style={{ padding: '0.125rem 0.5rem', fontSize: '0.7rem' }} onClick={refresh} disabled={shiftsLoading}>
                  Refresh
                </button>
              </div>
            </div>
            <div className="card-body">
              {shiftsLoading && shifts.length === 0 ? (
                <div style={{ padding: '1rem', color: 'var(--color-text-tertiary)' }}>Loading shifts…</div>
              ) : !shiftsLoading && shifts.length === 0 ? (
                <div style={{ padding: '1rem', color: 'var(--color-text-tertiary)' }}>No shifts found.</div>
              ) : (
                <div
                  ref={shiftListRef}
                  className="shift-list"
                  style={{ maxHeight: 'min(52vh, 440px)', overflow: 'auto', gap: 0 }}
                >
                  <div style={{ height: shiftVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                    {shiftVirtualizer.getVirtualItems().map(vi => {
                      const shift = shifts[vi.index];
                      return (
                        <div
                          key={shift.id}
                          data-index={vi.index}
                          ref={shiftVirtualizer.measureElement}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${vi.start}px)`,
                            paddingBottom: '0.75rem',
                          }}
                        >
                          <div className="shift-item">
                            <div className="shift-header">
                              <div className="shift-title">{shift.title}</div>
                              <div className="shift-date">{shift.date}</div>
                            </div>
                            <div className="shift-meta">
                              <span className="flex items-center gap-1">
                                <MapPin size={14} /> {shift.location}
                              </span>
                              <span className="badge badge-outline" style={{ fontSize: '0.7rem' }}>
                                {shift.role}
                              </span>
                            </div>
                            <div className="shift-progress">
                              <div style={{ minWidth: '80px' }}>
                                {shift.filled} / {shift.total} filled
                              </div>
                              <div className="progress-bar-sm">
                                <div
                                  className="progress-fill-sm"
                                  style={{ width: `${(shift.filled / shift.total) * 100}%` }}
                                ></div>
                              </div>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.125rem 0.5rem', fontSize: '0.7rem' }}
                                onClick={() => handleSignup(shift.id)}
                                disabled={shift.filled >= shift.total}
                              >
                                Join
                              </button>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.125rem 0.5rem', fontSize: '0.7rem' }}
                                onClick={() => handleManageShift(shift.title)}
                              >
                                Manage
                              </button>
                            </div>
                            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                              Signups logged: {shiftSignupCounts.get(shift.id) || 0}
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
        </div>

        <div className="flex-col gap-6 flex">
          <div className="corp-volunteer-banner">
            <div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>Corporate Volunteer Days</h3>
              <p style={{ fontSize: '0.875rem', opacity: 0.9 }}>Manage groups of employees fulfilling company CSR hours.</p>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', opacity: 0.8 }}>Active Partner Groups</div>
              <div className="corp-logo-group">
                {['TCS', 'INF', 'HDF'].map(l => <div key={l} className="corp-logo">{l}</div>)}
                <div className="corp-logo" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>+3</div>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', width: 'max-content' }}
              disabled
              title="Not available yet">
              Corporate Portal Settings
            </button>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Volunteer Roster ({volunteers.length})</h3>
            </div>
            <div className="card-body">
              {volunteers.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>No volunteers on the roster yet.</div>
              ) : (
                <div
                  ref={rosterRef}
                  className="volunteer-roster"
                  style={{ maxHeight: 'min(48vh, 400px)', overflow: 'auto' }}
                >
                  <div style={{ height: rosterVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                    {rosterVirtualizer.getVirtualItems().map(vi => {
                      const vol = volunteers[vi.index];
                      return (
                        <div
                          key={vol.id}
                          data-index={vi.index}
                          ref={rosterVirtualizer.measureElement}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${vi.start}px)`,
                          }}
                        >
                          <div className="roster-item">
                            <div className="flex items-center gap-3">
                              <div className="avatar" style={{ width: 32, height: 32 }}>
                                {vol.name.charAt(0)}
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontWeight: 500,
                                    fontSize: '0.875rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                  }}
                                >
                                  {vol.name}
                                  {vol.verified ? (
                                    <CheckCircle2 size={12} color="var(--color-success)" />
                                  ) : (
                                    <ShieldAlert size={12} color="var(--color-warning)" />
                                  )}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                  {vol.skills.join(', ')}
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{vol.hours}h</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>YTD</div>
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
        </div>
      </div>

      {showReminderModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '480px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowReminderModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Bell size={20} color="#f59e0b" /> Schedule Volunteer Reminder</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>Send an automated WhatsApp/SMS reminder to volunteers before their shift.</p>

            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Shift</label>
              <select className="input-field" value={selectedShift?.id || ''} onChange={e => setSelectedShift(shifts.find(s => s.id === Number(e.target.value)) || shifts[0] || null)}>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.title} — {s.date}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Send Reminder</label>
              <select className="input-field" value={reminderConfig.timing} onChange={e => setReminderConfig({ ...reminderConfig, timing: e.target.value })}>
                <option value="24h">24 hours before</option>
                <option value="48h">48 hours before</option>
                <option value="2h">2 hours before (day-of)</option>
                <option value="1w">1 week before</option>
              </select>
            </div>
            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Channel</label>
              <div className="flex gap-3">
                {[{ v: 'whatsapp', l: '📲 WhatsApp' }, { v: 'sms', l: '💬 SMS' }, { v: 'both', l: 'Both' }].map(ch => (
                  <label key={ch.v} className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input type="radio" name="channel" value={ch.v} checked={reminderConfig.channel === ch.v}
                      onChange={() => setReminderConfig({ ...reminderConfig, channel: ch.v })} />
                    {ch.l}
                  </label>
                ))}
              </div>
            </div>
            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Custom Message (optional)</label>
              <textarea className="input-field" rows={3} placeholder={selectedShift ? `Namaste! Reminder: Your volunteer shift "${selectedShift.title}" is ${reminderConfig.timing} away. Location: ${selectedShift.location}. Thank you for your seva! 🙏` : 'Select a shift first.'}
                value={reminderConfig.message} onChange={e => setReminderConfig({ ...reminderConfig, message: e.target.value })} />
            </div>
            <div style={{ padding: '0.75rem', background: '#f0fdf4', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', marginBottom: '1rem', color: '#166534' }}>
              ✅ Will send to <strong>{selectedShift?.filled || 0} confirmed volunteers</strong> for "{selectedShift?.title || '—'}" at {selectedShift?.location || '—'}
            </div>
            <div className="flex gap-3">
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowReminderModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSendReminder}><Bell size={15} /> Schedule Reminder</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '420px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '1.5rem' }}>Add New Volunteer</h2>
            <form onSubmit={handleAddVolunteer} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required type="text" className="input-field" placeholder="e.g. Arjun Mehta" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Skills (comma separated)</label>
                <input type="text" className="input-field" placeholder="e.g. Teaching, Medical, Logistics" value={form.skills} onChange={e => setForm({ ...form, skills: e.target.value })} />
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: '0.25rem' }}>
                <input type="checkbox" id="verified" checked={form.verified} onChange={e => setForm({ ...form, verified: e.target.checked })} />
                <label htmlFor="verified" style={{ fontSize: '0.875rem' }}>Background Verified</label>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Add to Roster</button>
            </form>
          </div>
        </div>
      )}

      {showSignupModal && signupShift && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ width: '440px', padding: '1.5rem', position: 'relative' }}>
            <button onClick={() => setShowSignupModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="action-btn"><X size={20} /></button>
            <h2 style={{ marginBottom: '0.5rem' }}>Join shift</h2>
            <p style={{ marginBottom: '1rem', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
              {signupShift.title} • {signupShift.date} • {signupShift.location}
            </p>

            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Volunteer</label>
              <select
                className="input-field"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
              >
                <option value="">Select from roster…</option>
                {volunteers.map(v => (
                  <option key={v.id} value={v.name}>{v.name}</option>
                ))}
              </select>
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                Not in roster? Add them first with “Add Volunteer”.
              </div>
            </div>

            <div className="flex gap-3">
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowSignupModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={submitSignup} disabled={!signupName}>
                Confirm signup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Volunteers;
