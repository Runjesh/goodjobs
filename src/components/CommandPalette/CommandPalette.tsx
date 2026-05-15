import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Sparkles, UserPlus, IndianRupee, ShieldCheck, Mail, ArrowRight, Clock, Users, Briefcase, Heart, Flag, FolderKanban, ReceiptText, UserCheck, PlusCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import { useStore } from '../../store/useStore';
import { searchEntities, ENTITY_GROUP_LABEL, type EntityResult, type EntityKind } from '../../utils/entitySearch';
import './CommandPalette.css';

const ENTITY_ICON: Record<EntityKind, React.ComponentType<{ size?: number }>> = {
  donor: Heart,
  beneficiary: Users,
  csr: Briefcase,
  grant: ShieldCheck,
  campaign: Flag,
  program: FolderKanban,
  report: Mail,
  team: UserPlus,
};

const HISTORY_KEY = 'goodjobs.directive_history.v1';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

type DonorConfirm = { name: string; amount: number; campaign: string };
type IntentConfirm = { directive: string; card: Record<string, unknown> };

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function pushHistory(line: string) {
  const t = line.trim();
  if (t.length < 3) return;
  const prev = loadHistory().filter(x => x !== t);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([t, ...prev].slice(0, 10)));
}

/** Parse "add donor X 5000 [for campaign]" or "donate X 5000 …" */
function parseDonorQuickCapture(q: string): DonorConfirm | null {
  const s = q.trim();
  const patterns = [
    /(?:add\s+donor|donate)\s+(.+?)\s+(?:rs\.?|₹|inr\s*)?([\d][\d,\.]*)\s*(?:inr)?(?:\s*(?:for|to|towards?|campaign)\s+)?(.+)?$/i,
    /^donor\s+(.+?)\s+(?:rs\.?|₹|inr\s*)?([\d][\d,\.]*)\s*(?:inr)?(?:\s*(?:for|to|towards?|campaign)\s+)?(.+)?$/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const name = m[1].replace(/[,]+$/g, '').trim();
    const amount = parseFloat(m[2].replace(/,/g, ''));
    const campaign = (m[3] || '').trim();
    if (name && amount > 0) {
      return { name, amount, campaign: campaign || 'General Fund' };
    }
  }
  return null;
}

const CSR_STAGE_ALIASES: Record<string, string> = {
  prospecting: 'prospecting',
  prospect: 'prospecting',
  pitch: 'pitch',
  diligence: 'diligence',
  'due diligence': 'diligence',
  mou: 'mou',
  signed: 'mou',
  live: 'live',
  production: 'live',
};

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [confirmDonor, setConfirmDonor] = useState<DonorConfirm | null>(null);
  const [confirmIntent, setConfirmIntent] = useState<IntentConfirm | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Forward ref so the keydown handler can call the directive runner that
  // is defined later in this component without hitting the temporal dead
  // zone or re-binding the listener on every keystroke.
  const runDirectiveRef = useRef<() => void>(() => {});
  const navigate = useNavigate();

  const donors = useStore(s => s.donors);
  const beneficiaries = useStore(s => s.beneficiaries);
  const csrCards = useStore(s => s.csrCards);
  const campaigns = useStore(s => s.campaigns);
  const volunteers = useStore(s => s.volunteers);

  const entityResults = useMemo<EntityResult[]>(() => {
    if (query.startsWith('/')) return [];
    return searchEntities(query, { donors, beneficiaries, csrCards, campaigns, volunteers });
  }, [query, donors, beneficiaries, csrCards, campaigns, volunteers]);

  const groupedEntityResults = useMemo(() => {
    const groups = new Map<EntityKind, EntityResult[]>();
    for (const r of entityResults) {
      const arr = groups.get(r.kind) ?? [];
      arr.push(r);
      groups.set(r.kind, arr);
    }
    return [...groups.entries()];
  }, [entityResults]);

  const workflowSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.startsWith('/')) return [];
    const out: { label: string; hint: string; path: string; icon: React.ComponentType<{ size?: number }> }[] = [];
    if (q.includes('receipt') || q.includes('80g')) {
      out.push(
        { label: 'Generate receipt for recent donation', hint: 'Finance', path: '/finance', icon: ReceiptText },
        { label: 'View donor CRM & outreach', hint: 'CRM', path: '/crm', icon: Heart },
      );
    }
    if (q === 'new' || q.startsWith('new ')) {
      out.push(
        { label: 'Enroll beneficiary', hint: 'Programs', path: '/programs?action=enroll', icon: UserCheck },
        { label: 'Log donation', hint: 'Fundraising', path: '/fundraising', icon: IndianRupee },
        { label: 'Create campaign', hint: 'Fundraising', path: '/fundraising', icon: Flag },
      );
    }
    if (q.includes('enroll') || q.includes('beneficiar')) {
      out.push({ label: 'Enroll beneficiary', hint: 'Programs', path: '/programs?action=enroll', icon: UserCheck });
    }
    if (q.includes('donat') || q.includes('gift')) {
      out.push({ label: 'Log donation', hint: 'Fundraising', path: '/fundraising', icon: PlusCircle });
    }
    return out;
  }, [query]);

  // Reset selection whenever the result set changes.
  useEffect(() => { setActiveIndex(0); }, [entityResults]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setHistory(loadHistory());
    } else {
      setQuery('');
      setBusy(false);
      setConfirmDonor(null);
      setConfirmIntent(null);
    }
  }, [isOpen]);

  const handleEntityNavigate = useCallback((r: EntityResult) => {
    navigate(r.path);
    onClose();
  }, [navigate, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        if (confirmDonor || confirmIntent) {
          setConfirmDonor(null);
          setConfirmIntent(null);
          e.stopPropagation();
          return;
        }
        onClose();
        return;
      }
      // Cmd/Ctrl+Enter always runs the directive parser, even when entity
      // results are visible — gives keyboard users an explicit escape hatch
      // for free-text commands that happen to match an entity name.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && query.trim()) {
        e.preventDefault();
        runDirectiveRef.current();
        return;
      }
      if (entityResults.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => (i + 1) % entityResults.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => (i - 1 + entityResults.length) % entityResults.length);
      } else if (e.key === 'Enter') {
        // Enter navigates to the highlighted entity whenever results are
        // present. Slash-directives (e.g. "/log gift …") are excluded from
        // entityResults upstream, so the directive parser still runs for
        // them via the form's onSubmit.
        const r = entityResults[activeIndex];
        if (r) {
          e.preventDefault();
          handleEntityNavigate(r);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, confirmDonor, confirmIntent, entityResults, activeIndex, handleEntityNavigate, query]);

  const hour = new Date().getHours();
  const rhythmHint = useMemo(() => {
    const day = new Date().getDate();
    if (hour >= 7 && hour < 11) return 'Review morning brief';
    if (day >= 25 && hour >= 15) return 'Month-end close & filings';
    if (hour >= 11 && hour < 15) return 'Check grant utilisation / finance flags';
    if (hour >= 15 && hour < 19) return 'CSR follow-ups & donor outreach';
    return 'Prep for tomorrow — snooze or clear inbox';
  }, [hour]);

  const handleAction = (path: string) => {
    navigate(path);
    onClose();
  };

  const recordDonorAndTx = useCallback(async (d: DonorConfirm): Promise<boolean> => {
    const dRes = await apiFetch('/crm/donors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: d.name,
        type: 'Recurring',
        pan: '',
        location: '',
        tags: ['Quick capture'],
      }),
    });
    if (!dRes.ok) return false;
    const dj = await dRes.json();
    const donorId = dj?.donor?.id;
    const slug = d.campaign.toLowerCase().replace(/\s+/g, '-').slice(0, 48) || 'general';
    const tRes = await apiFetch('/finance/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        donorId: donorId ? String(donorId) : '',
        donorName: d.name,
        amount: d.amount,
        method: 'UPI',
        campaignId: slug,
        campaignTitle: d.campaign,
      }),
    });
    if (!tRes.ok) return false;
    toast.success(`Recorded ₹${d.amount.toLocaleString('en-IN')} from ${d.name} → ${d.campaign}.`);
    return true;
  }, []);

  const tryCsrMove = async (q: string): Promise<boolean> => {
    const s = q.trim();
    const m = s.match(/^\/move\s+(.+?)\s+to\s+(.+)$/i);
    if (!m) return false;
    const needle = m[1].trim().toLowerCase();
    const stageRaw = m[2].trim().toLowerCase();
    const col = CSR_STAGE_ALIASES[stageRaw] || stageRaw;
    if (!['prospecting', 'pitch', 'diligence', 'mou', 'live'].includes(col)) {
      toast.error('Use stage: prospecting, pitch, diligence, mou, or live.');
      return true;
    }
    const res = await apiFetch('/csr/cards');
    if (!res.ok) {
      toast.error('Could not load CSR pipeline.');
      return true;
    }
    const data = await res.json();
    const cards: any[] = Array.isArray(data.cards) ? data.cards : [];
    const card = cards.find(c => (c.company || '').toLowerCase().includes(needle));
    if (!card) {
      toast.error('No CSR card matched that company snippet.');
      return true;
    }
    const mv = await apiFetch(`/csr/cards/${encodeURIComponent(String(card.id))}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ col }),
    });
    if (!mv.ok) {
      toast.error('Move failed.');
      return true;
    }
    toast.success(`Moved “${card.company}” → ${col}.`);
    return true;
  };

  const runSlash = async (q: string): Promise<boolean> => {
    const s = q.trim();
    if (s.startsWith('/brief')) {
      handleAction('/');
      return true;
    }
    if (s.startsWith('/inbox') || s.startsWith('/tasks')) {
      handleAction('/tasks');
      return true;
    }
    if (s.startsWith('/hq') || s.startsWith('/agent')) {
      handleAction('/agent-hq');
      return true;
    }
    if (s.toLowerCase().startsWith('/move ')) {
      setBusy(true);
      try {
        if (await tryCsrMove(s)) {
          pushHistory(s);
          onClose();
          return true;
        }
      } finally {
        setBusy(false);
      }
    }
    if (s.startsWith('/donate ') || s.startsWith('/enroll ')) {
      const rest = s.replace(/^\/(donate|enroll)\s+/i, '');
      const donor = parseDonorQuickCapture(`add donor ${rest}`);
      if (donor) {
        setConfirmDonor(donor);
        return true;
      }
      setBusy(true);
      try {
        const res = await apiFetch(`/intent/process?directive=${encodeURIComponent(rest)}`, { method: 'POST' });
        if (res.ok) {
          toast.success('Directive queued for Agent HQ.');
          pushHistory(s);
          navigate('/agent-hq');
          onClose();
          return true;
        }
      } finally {
        setBusy(false);
      }
    }
    return false;
  };

  const startIntentPreview = async (directive: string) => {
    setBusy(true);
    try {
      const res = await apiFetch('/intent/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directive }),
      });
      if (!res.ok) {
        toast.error('Could not parse directive.');
        return;
      }
      const data = await res.json();
      setConfirmIntent({ directive, card: (data.action_card || {}) as Record<string, unknown> });
    } catch {
      toast.error('Backend not reachable.');
    } finally {
      setBusy(false);
    }
  };

  const runNaturalDirective = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      if (await runSlash(q)) return;
      const donor = parseDonorQuickCapture(q);
      if (donor) {
        setConfirmDonor(donor);
        return;
      }
      await startIntentPreview(q);
    } catch {
      toast.error('Backend not reachable.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDonorExecute = async () => {
    if (!confirmDonor) return;
    setBusy(true);
    try {
      if (await recordDonorAndTx(confirmDonor)) {
        pushHistory(`add donor ${confirmDonor.name} ${confirmDonor.amount} ${confirmDonor.campaign}`);
        setConfirmDonor(null);
        onClose();
      } else {
        toast.error('Donor or transaction failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmIntentExecute = async () => {
    if (!confirmIntent) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/intent/process?directive=${encodeURIComponent(confirmIntent.directive)}`, {
        method: 'POST',
      });
      if (res.ok) {
        toast.success('Queued — review in Agent HQ if needed.');
        pushHistory(confirmIntent.directive);
        setConfirmIntent(null);
        navigate('/agent-hq');
        onClose();
      } else {
        toast.error('Could not queue directive.');
      }
    } catch {
      toast.error('Backend not reachable.');
    } finally {
      setBusy(false);
    }
  };

  /** One-click re-run from history (skips confirm for speed). */
  const runHistoryLine = async (h: string) => {
    const line = h.trim();
    if (!line) return;
    setBusy(true);
    try {
      if (line.startsWith('/donate ') || line.startsWith('/enroll ')) {
        const rest = line.replace(/^\/(donate|enroll)\s+/i, '');
        const donor = parseDonorQuickCapture(`add donor ${rest}`);
        if (donor && (await recordDonorAndTx(donor))) {
          pushHistory(line);
          onClose();
        } else if (!donor) {
          toast.error('Could not parse donor from history line.');
        }
        return;
      }
      if (await runSlash(line)) return;
      const donor = parseDonorQuickCapture(line);
      if (donor) {
        if (await recordDonorAndTx(donor)) {
          pushHistory(line);
          onClose();
        }
        return;
      }
      const res = await apiFetch(`/intent/process?directive=${encodeURIComponent(line)}`, { method: 'POST' });
      if (res.ok) {
        toast.success('Directive queued.');
        pushHistory(line);
        navigate('/agent-hq');
        onClose();
      } else {
        toast.error('Could not run.');
      }
    } catch {
      toast.error('Backend not reachable.');
    } finally {
      setBusy(false);
    }
  };

  // Keep the keydown ref in sync with the latest closure.
  runDirectiveRef.current = () => { void runNaturalDirective(); };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runNaturalDirective();
  };

  return (
    <div className={`command-palette-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}>
      <div className="command-palette-container" onClick={e => e.stopPropagation()}>
        <form onSubmit={onSubmit}>
          <div className="palette-header">
            <Search size={20} color="var(--color-text-secondary)" />
            <input
              ref={inputRef}
              type="text"
              className="palette-input"
              placeholder="add donor Meera 5000 for water · /move Tata to diligence · draft report…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={busy}
            />
            <div className="palette-badge">
              <Sparkles size={12} color="#8b5cf6" /> Execute
            </div>
          </div>
        </form>

        <div className="palette-body">
          {(confirmDonor || confirmIntent) && (
            <div
              className="suggestion-group"
              style={{
                border: '1px solid var(--color-primary)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem',
                marginBottom: '0.75rem',
                background: 'var(--color-bg-card)',
              }}
            >
              <div className="suggestion-group-title">Confirm one-step action</div>
              {confirmDonor && (
                <>
                  <p style={{ fontSize: '0.875rem', margin: '0.25rem 0 0.75rem', color: 'var(--color-text-secondary)' }}>
                    <strong>{confirmDonor.name}</strong> · ₹{confirmDonor.amount.toLocaleString('en-IN')} ·{' '}
                    <em>{confirmDonor.campaign}</em>
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmDonorExecute()}>
                      Confirm &amp; record
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmDonor(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
              {confirmIntent && (
                <>
                  <p style={{ fontSize: '0.8rem', margin: '0.25rem 0', color: 'var(--color-text-tertiary)' }}>
                    {(confirmIntent.card.summary as string) || confirmIntent.directive}
                  </p>
                  <p style={{ fontSize: '0.75rem', margin: '0 0 0.5rem', color: 'var(--color-text-tertiary)' }}>
                    Risk: {String(confirmIntent.card.risk_level || '—')} · Type:{' '}
                    {String(confirmIntent.card.intent_type || '—')}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmIntentExecute()}>
                      Queue in Agent HQ
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmIntent(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {workflowSuggestions.length > 0 && !confirmDonor && !confirmIntent && (
            <div className="suggestion-group">
              <motion.div className="suggestion-group-title">Jobs to be done</motion.div>
              {workflowSuggestions.map(s => {
                const Icon = s.icon;
                return (
                  <div key={s.path + s.label} className="suggestion-item" onClick={() => handleAction(s.path)}>
                    <div className="suggestion-icon"><Icon size={16} /></div>
                    <div className="suggestion-text">{s.label}</div>
                    <div className="suggestion-hint">{s.hint}</div>
                  </div>
                );
              })}
            </div>
          )}

          {entityResults.length > 0 && !confirmDonor && !confirmIntent && (
            <div className="palette-entity-results">
              {groupedEntityResults.map(([kind, rows]) => (
                <div className="suggestion-group" key={kind}>
                  <div className="suggestion-group-title">{ENTITY_GROUP_LABEL[kind]}</div>
                  {rows.map(r => {
                    const Icon = ENTITY_ICON[r.kind];
                    const flatIdx = entityResults.indexOf(r);
                    const isActive = flatIdx === activeIndex;
                    return (
                      <div
                        key={`${r.kind}:${r.id}`}
                        className={`suggestion-item palette-entity-item${isActive ? ' palette-entity-item--active' : ''}`}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => handleEntityNavigate(r)}
                      >
                        <div className="suggestion-icon"><Icon size={16} /></div>
                        <div className="palette-entity-text">
                          <div className="palette-entity-label">{r.label}</div>
                          <div className="palette-entity-context">{r.context}</div>
                        </div>
                        <ArrowRight size={14} className="suggestion-hint" />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="suggestion-group">
            <div className="suggestion-group-title flex items-center gap-1">
              <Clock size={12} /> Now ({rhythmHint})
            </div>
            <div className="suggestion-item" onClick={() => handleAction('/')}>
              <div className="suggestion-icon">
                <Sparkles size={16} />
              </div>
              <div className="suggestion-text">Open dashboard &amp; morning brief</div>
              <div className="suggestion-hint">Home</div>
            </div>
            <div className="suggestion-item" onClick={() => handleAction('/tasks')}>
              <div className="suggestion-icon">
                <Search size={16} />
              </div>
              <div className="suggestion-text">Unified inbox (tasks)</div>
              <div className="suggestion-hint">Tasks</div>
            </div>
          </div>

          {history.length > 0 && (
            <div className="suggestion-group">
              <div className="suggestion-group-title">Recent directives (tap = run again)</div>
              {history.slice(0, 10).map(h => (
                <div
                  key={h}
                  className="suggestion-item"
                  onClick={() => {
                    void runHistoryLine(h);
                  }}
                >
                  <div className="suggestion-icon">
                    <Mail size={16} />
                  </div>
                  <div className="suggestion-text">{h}</div>
                  <ArrowRight size={14} className="suggestion-hint" />
                </div>
              ))}
            </div>
          )}

          {query.length > 2 && !confirmDonor && !confirmIntent ? (
            <div className="suggestion-group">
              <div className="suggestion-group-title">Run on Enter</div>
              <div className="suggestion-item" onClick={() => void runNaturalDirective()}>
                <div className="suggestion-icon">
                  <Sparkles size={16} />
                </div>
                <div className="suggestion-text">Preview / execute: "{query}"</div>
                <ArrowRight size={14} className="suggestion-hint" />
              </div>
              <div className="suggestion-item" onClick={() => handleAction('/fundraising')}>
                <div className="suggestion-icon">
                  <IndianRupee size={16} />
                </div>
                <div className="suggestion-text">Open fundraising (manual entry)</div>
                <ArrowRight size={14} className="suggestion-hint" />
              </div>
              <div className="suggestion-item" onClick={() => handleAction('/crm')}>
                <div className="suggestion-icon">
                  <Search size={16} />
                </div>
                <div className="suggestion-text">Open donor CRM</div>
                <ArrowRight size={14} className="suggestion-hint" />
              </div>
            </div>
          ) : !confirmDonor && !confirmIntent ? (
            <>
              <div className="suggestion-group">
                <div className="suggestion-group-title">Quick Actions</div>
                <div className="suggestion-item" onClick={() => handleAction('/fundraising')}>
                  <div className="suggestion-icon">
                    <IndianRupee size={16} />
                  </div>
                  <div className="suggestion-text">Log a New Donation</div>
                  <div className="suggestion-hint">Fundraising</div>
                </div>
                <div className="suggestion-item" onClick={() => handleAction('/crm')}>
                  <div className="suggestion-icon">
                    <UserPlus size={16} />
                  </div>
                  <div className="suggestion-text">Add a New Donor</div>
                  <div className="suggestion-hint">CRM</div>
                </div>
                <div className="suggestion-item" onClick={() => handleAction('/agent-hq')}>
                  <div className="suggestion-icon">
                    <Mail size={16} />
                  </div>
                  <div className="suggestion-text">Agent HQ — approvals</div>
                  <div className="suggestion-hint">Copilot</div>
                </div>
              </div>

              <div className="suggestion-group">
                <div className="suggestion-group-title">Slash shortcuts</div>
                <div className="suggestion-item" onClick={() => setQuery('/brief ')}>
                  <div className="suggestion-icon">
                    <Sparkles size={16} />
                  </div>
                  <div className="suggestion-text">/brief — dashboard</div>
                </div>
                <div className="suggestion-item" onClick={() => setQuery('/inbox ')}>
                  <div className="suggestion-icon">
                    <Search size={16} />
                  </div>
                  <div className="suggestion-text">/inbox — task queue</div>
                </div>
                <div className="suggestion-item" onClick={() => setQuery('/move Reliance to pitch')}>
                  <div className="suggestion-icon">
                    <Sparkles size={16} />
                  </div>
                  <div className="suggestion-text">/move Company to stage</div>
                </div>
                <div className="suggestion-item" onClick={() => setQuery('/donate Meera Joshi 5000 water campaign')}>
                  <div className="suggestion-icon">
                    <IndianRupee size={16} />
                  </div>
                  <div className="suggestion-text">/donate Name Amount [for campaign]</div>
                </div>
              </div>

              <div className="suggestion-group">
                <div className="suggestion-group-title">Compliance & Finance</div>
                <div className="suggestion-item" onClick={() => handleAction('/finance')}>
                  <div className="suggestion-icon">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="suggestion-text">Check FCRA Limit Status</div>
                  <div className="suggestion-hint">Finance</div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="palette-footer">
          <div>
            <kbd>esc</kbd> close · <kbd>↑</kbd><kbd>↓</kbd> nav · <kbd>enter</kbd> open · <kbd>⌘</kbd><kbd>↵</kbd> run directive
          </div>
          <div>
            <kbd>⌘</kbd>
            <kbd>K</kbd> open
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
