import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MessageCircle, Plus, Save, Send, Trash2, KeyRound, CheckCircle2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext';
import {
  loadWhatsAppConfig, saveWhatsAppConfig, buildMisIntentFromWhatsApp,
  type WhatsAppMapping, type WhatsAppMappingTarget,
} from '../../utils/whatsappPortal';

const SAMPLE_MESSAGE = `beneficiary: Lakshmi Devi
location: Nashik
metric: weight_kg
value: 52
program: women-livelihood-center`;

const TARGETS: WhatsAppMappingTarget[] = ['beneficiary', 'location', 'metric', 'value', 'program'];

const WhatsAppPortal: React.FC = () => {
  const addIntent = useStore(s => s.addMisReviewIntent);
  const pendingCount = useStore(s => s.misReviewIntents.filter(i => i.status === 'pending').length);
  const { user } = useAuth();

  const [token, setToken]                 = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [enabled, setEnabled]             = useState(false);
  const [mappings, setMappings]           = useState<WhatsAppMapping[]>([]);
  const [testBody, setTestBody]           = useState(SAMPLE_MESSAGE);
  const [showToken, setShowToken]         = useState(false);

  useEffect(() => {
    const cfg = loadWhatsAppConfig();
    setToken(cfg.token);
    setPhoneNumberId(cfg.phoneNumberId);
    setEnabled(cfg.enabled);
    setMappings(cfg.mappings);
  }, []);

  const tokenHint = useMemo(() => {
    if (!token) return '';
    if (token.length <= 8) return '••••••••';
    return `${token.slice(0, 4)}…${token.slice(-4)} (${token.length} chars)`;
  }, [token]);

  const onSaveConfig = () => {
    const cleaned = mappings
      .map(m => ({ ...m, keyword: m.keyword.trim() }))
      .filter(m => m.keyword.length > 0);
    if (enabled && !token.trim()) {
      toast.error('Paste a WhatsApp Business token before enabling the portal.');
      return;
    }
    saveWhatsAppConfig({ token: token.trim(), phoneNumberId: phoneNumberId.trim(), mappings: cleaned, enabled });
    setMappings(cleaned);
    toast.success('WhatsApp portal configuration saved.');
  };

  const onAddMapping = () => {
    setMappings(prev => [
      ...prev,
      { id: `m-${Date.now()}`, keyword: '', target: 'metric' },
    ]);
  };

  const onRemoveMapping = (id: string) => {
    setMappings(prev => prev.filter(m => m.id !== id));
  };

  const onChangeMapping = (id: string, patch: Partial<WhatsAppMapping>) => {
    setMappings(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  };

  const onSendTest = () => {
    if (!testBody.trim()) {
      toast.error('Type a test message body first.');
      return;
    }
    const intent = buildMisIntentFromWhatsApp(
      testBody.trim(),
      user?.email ?? 'wa-test-bot',
      mappings,
    );
    addIntent(intent);
    const extractedCount = Object.keys(intent.extracted).length;
    toast.success(`Field report queued — ${extractedCount} field${extractedCount === 1 ? '' : 's'} extracted. Open Copilot → review queue.`);
  };

  return (
    <div>
      <h3 className="settings-section-title">WhatsApp Field Portal</h3>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: '-0.25rem', marginBottom: '1rem' }}>
        Wire up a WhatsApp Business number so field officers can submit updates by message. Inbound submissions
        land in the supervisor review queue (Copilot → Field reports awaiting review) before counting in dashboards.
      </p>

      {/* Wizard-connected number banner.
          The signup wizard stores the verified phone on the org (ngo.meta.whatsapp);
          Layout hydrates user.whatsapp from /settings on every login, so this banner
          reflects the backend state on a fresh device — no localStorage required. */}
      {user?.whatsapp?.phone && (
        <div
          data-testid="whatsapp-connected-banner"
          style={{
            padding: '0.6rem 0.85rem',
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: '1rem',
            fontSize: '0.82rem',
          }}
        >
          <CheckCircle2 size={16} style={{ color: '#15803d', flexShrink: 0 }} />
          <div>
            <strong>Connected number:</strong> {user.whatsapp.phone}
            {user.whatsapp.verified ? ' · verified' : ' · pending verification'}
            {user.whatsapp.connectedAt && (
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                {' '}· since {String(user.whatsapp.connectedAt).slice(0, 10)}
              </span>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          padding: '0.75rem 1rem',
          background: enabled ? '#ecfdf5' : 'var(--color-bg-main)',
          border: `1px solid ${enabled ? '#a7f3d0' : 'var(--color-border-light)'}`,
          borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MessageCircle size={18} style={{ color: enabled ? '#15803d' : 'var(--color-text-tertiary)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              Portal status: {enabled ? 'Enabled' : 'Disabled'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
              {pendingCount} field report{pendingCount === 1 ? '' : 's'} pending supervisor review
            </div>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          {enabled ? 'On' : 'Off'}
        </label>
      </div>

      {/* Credentials */}
      <div className="settings-form" style={{ marginBottom: '1.5rem' }}>
        <div className="input-group">
          <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <KeyRound size={13} /> WhatsApp Business token
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="input-field"
              type={showToken ? 'text' : 'password'}
              placeholder="EAA…"
              value={token}
              onChange={e => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn btn-secondary" onClick={() => setShowToken(s => !s)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            {tokenHint && <span>Stored token: <code>{tokenHint}</code> · </span>}
            Stored locally in your browser. Production deployments should swap this for a server-side secret.
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Phone number ID</label>
          <input
            className="input-field"
            placeholder="e.g. 1234567890"
            value={phoneNumberId}
            onChange={e => setPhoneNumberId(e.target.value)}
          />
        </div>
      </div>

      {/* Mappings */}
      <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.85rem', fontWeight: 700 }}>Keyword → field mappings</h4>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.78rem', margin: '0 0 0.75rem 0' }}>
        Each line in an inbound message is matched against keywords (case-insensitive) and the value
        after <code>:</code> / <code>=</code> populates the chosen field on the field report.
      </p>

      <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '0.75rem' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1.4fr 1fr auto',
          padding: '0.5rem 0.75rem', background: 'var(--color-bg-main)',
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <span>Keyword</span><span>Maps to field</span><span></span>
        </div>
        {mappings.length === 0 && (
          <div style={{ padding: '0.85rem 0.75rem', fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
            No mappings yet — add at least one to start extracting fields.
          </div>
        )}
        {mappings.map(m => (
          <div
            key={m.id}
            style={{
              display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: '0.5rem',
              alignItems: 'center', padding: '0.5rem 0.75rem',
              borderBottom: '1px solid var(--color-border-light)',
            }}
          >
            <input
              className="input-field"
              style={{ padding: '0.35rem 0.55rem', fontSize: '0.85rem' }}
              placeholder="e.g. weight"
              value={m.keyword}
              onChange={e => onChangeMapping(m.id, { keyword: e.target.value })}
            />
            <select
              className="input-field"
              style={{ padding: '0.35rem 0.55rem', fontSize: '0.85rem' }}
              value={m.target}
              onChange={e => onChangeMapping(m.id, { target: e.target.value as WhatsAppMappingTarget })}
            >
              {TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              type="button"
              onClick={() => onRemoveMapping(m.id)}
              title="Remove mapping"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button className="btn btn-secondary" onClick={onAddMapping}><Plus size={14} /> Add mapping</button>
        <button className="btn btn-primary" onClick={onSaveConfig}><Save size={14} /> Save configuration</button>
      </div>

      {/* Test message */}
      <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.85rem', fontWeight: 700 }}>
        Test message <span style={{ fontWeight: 500, color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>(simulation — runs even when portal is Off)</span>
      </h4>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.78rem', margin: '0 0 0.5rem 0' }}>
        Simulate an inbound WhatsApp message. The portal parses it against your mappings and creates a
        pending field report in the supervisor review queue — exactly what a real inbound message will do
        once the portal is enabled and your webhook is wired up.
      </p>
      <textarea
        className="input-field"
        rows={6}
        value={testBody}
        onChange={e => setTestBody(e.target.value)}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.82rem' }}
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={onSendTest}>
          <Send size={14} /> Send test message
        </button>
        {pendingCount > 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={13} style={{ color: '#15803d' }} />
            Open <strong>Copilot</strong> to review the {pendingCount} pending report{pendingCount === 1 ? '' : 's'}.
          </span>
        )}
      </div>
    </div>
  );
};

export default WhatsAppPortal;
