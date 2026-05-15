import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Users, TrendingUp, MessageCircle, Loader2, Send, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore, type Donor } from '../../store/useStore';
import { buildDonorImpactTrail } from '../../utils/donorImpact';
import { formatINR } from '../../utils/programFinance';
import { apiFetch } from '../../api/client';
import { deriveNextAction } from '../../utils/donorNextAction';

interface Props {
  donor: Donor;
  propensityScore?: number;
}

const DonorImpactPanel: React.FC<Props> = ({ donor, propensityScore }) => {
  const navigate = useNavigate();
  const transactions = useStore(s => s.transactions);
  const campaigns = useStore(s => s.campaigns);
  const beneficiaryOutcomes = useStore(s => s.beneficiaryOutcomes);
  const addOutreachEntry = useStore(s => s.addOutreachEntry);

  const [draft, setDraft] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [score, setScore] = useState<number | undefined>(propensityScore);

  const trail = useMemo(
    () => buildDonorImpactTrail(donor, transactions, campaigns, beneficiaryOutcomes),
    [donor, transactions, campaigns, beneficiaryOutcomes],
  );

  const programHint = useMemo(() => {
    const txs = transactions.filter(t => String(t.donorId) === String(donor.id));
    const last = [...txs].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    if (!last?.programmeId) return trail.programmes[0]?.programLabel ?? '';
    const c = campaigns.find(x => String(x.id) === String(last.programmeId));
    return c?.title ?? trail.programmes[0]?.programLabel ?? '';
  }, [donor.id, transactions, campaigns, trail.programmes]);

  const nextAction = useMemo(() => deriveNextAction(donor, score), [donor, score]);

  useEffect(() => {
    if (propensityScore != null) {
      setScore(propensityScore);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/analytics/donor-propensity/${donor.id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && typeof data.propensity_score === 'number') {
          setScore(data.propensity_score);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [donor.id, propensityScore]);

  const loadDraft = useCallback(async () => {
    setDraftLoading(true);
    try {
      const res = await apiFetch('/gen-ai/donor-outreach-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donor_name: donor.name,
          total_given: donor.totalGiven ?? 0,
          propensity_score: score,
          program_hint: programHint,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDraft(String(data.message ?? ''));
      } else {
        const first = donor.name.split(' ')[0];
        setDraft(`Namaste ${first}! Thank you for standing with us. We'd love to share a quick programme update.`);
      }
    } catch {
      toast.error('Could not draft message.');
    } finally {
      setDraftLoading(false);
    }
  }, [donor, score, programHint]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  const markContacted = useCallback(() => {
    const now = Date.now();
    addOutreachEntry({
      id: `${now}-impact-panel`,
      donorId: String(donor.id),
      timestamp: now,
      date: new Date(now).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      channel: 'whatsapp',
      template: nextAction.label,
      status: 'sent',
    });
    toast.success('Marked as contacted today.', { icon: '✓' });
  }, [addOutreachEntry, donor.id, nextAction.label]);

  const sendWhatsApp = async () => {
    const msg = draft.trim();
    if (!msg) {
      toast.error('Message is empty.');
      return;
    }
    setSendBusy(true);
    try {
      const phone = (donor.phone || '').replace(/\D/g, '');
      if (phone.length >= 10) {
        const res = await apiFetch('/crm/outreach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          noMockFallback: true,
          body: JSON.stringify({
            mode: 'send',
            channel: 'whatsapp',
            donor_ids: [String(donor.id)],
            message: msg,
            template_id: nextAction.templateId,
          }),
        });
        if (res.ok) {
          markContacted();
          return;
        }
      }
      const encoded = encodeURIComponent(msg);
      const waPhone = phone.length >= 10 ? phone : '';
      const url = waPhone
        ? `https://wa.me/${waPhone.startsWith('91') ? waPhone : `91${waPhone}`}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      markContacted();
    } catch {
      toast.error('Send failed — try copy to clipboard instead.');
    } finally {
      setSendBusy(false);
    }
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      markContacted();
      toast.success('Copied — marked as contacted today.');
    } catch {
      toast.error('Could not copy.');
    }
  };

  return (
    <div
      style={{
        marginTop: '1.25rem',
        padding: '1.1rem 1.25rem',
        borderRadius: 'var(--radius-xl)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 6%, transparent), var(--color-bg-card))',
        border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
        <Sparkles size={16} color="var(--color-accent)" />
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Donor impact trail</h3>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
          {formatINR(trail.totalRecorded)} across {trail.totalCampaignsFunded} campaign{trail.totalCampaignsFunded === 1 ? '' : 's'}
        </span>
      </div>

      {trail.campaigns.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)', margin: '0 0 1rem' }}>
          No attributed gifts yet. Once {donor.name.split(' ')[0]} donates to a campaign, the chain to programmes and measured outcomes will appear here.
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '0.85rem' }}>
            {trail.campaigns.map(c => (
              <button
                key={c.campaign.id}
                type="button"
                onClick={() => navigate('/fundraising')}
                style={{
                  textAlign: 'left',
                  padding: '0.65rem 0.75rem',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginBottom: '0.15rem' }}>
                  {c.giftCount} gift{c.giftCount === 1 ? '' : 's'} · {formatINR(c.totalGiven)}
                </div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.3rem' }}>{c.campaign.title}</div>
                {c.programLabels.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {c.programLabels.map(l => (
                      <span key={l} className="badge badge-outline" style={{ fontSize: '0.68rem' }}>{l}</span>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>No programme tag yet</span>
                )}
              </button>
            ))}
          </div>

          {trail.programmes.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {trail.programmes.map(p => (
                <li
                  key={p.programId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.55rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <TrendingUp size={14} color="var(--color-success)" />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'capitalize' }}>{p.programLabel}</span>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                      {p.beneficiariesMeasured} measured
                      {p.avgImprovementPct > 0 && (
                        <> · {p.avgImprovementPct.toFixed(0)}% avg improvement</>
                      )}
                      {p.sroiScore > 0 && <> · SROI {p.sroiScore.toFixed(1)}</>}
                    </div>
                  </div>
                  <Users size={14} style={{ opacity: 0.5 }} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div
        style={{
          marginTop: '0.5rem',
          padding: '0.85rem',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <MessageCircle size={15} color="#16a34a" />
          <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Next best action</span>
          <span className="badge badge-outline" style={{ fontSize: '0.68rem' }}>{nextAction.label}</span>
          {score != null && (
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
              Propensity {score}%
            </span>
          )}
        </div>
        <textarea
          className="input-field"
          rows={4}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          style={{ fontSize: '0.82rem', marginBottom: '0.6rem', resize: 'vertical' }}
          aria-label="AI-drafted WhatsApp message"
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }} onClick={() => void loadDraft()} disabled={draftLoading}>
            {draftLoading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            Regenerate
          </button>
          <button type="button" className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }} onClick={() => void sendWhatsApp()} disabled={sendBusy || draftLoading}>
            {sendBusy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
            Send via WhatsApp
          </button>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }} onClick={() => void copyMessage()} disabled={!draft.trim()}>
            <Copy size={13} /> Copy
          </button>
        </div>
      </div>
    </div>
  );
};

export default DonorImpactPanel;