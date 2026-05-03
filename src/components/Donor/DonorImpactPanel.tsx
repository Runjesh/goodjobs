import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Users, TrendingUp } from 'lucide-react';
import { useStore, type Donor } from '../../store/useStore';
import { buildDonorImpactTrail } from '../../utils/donorImpact';
import { formatINR } from '../../utils/programFinance';

interface Props {
  donor: Donor;
}

/**
 * The donor → campaign(s) → programme(s) → measured outcomes trail.
 * Designed for funder pitches: a single panel that proves where this
 * donor's money went and what changed because of it.
 */
const DonorImpactPanel: React.FC<Props> = ({ donor }) => {
  const navigate = useNavigate();
  const transactions       = useStore(s => s.transactions);
  const campaigns          = useStore(s => s.campaigns);
  const beneficiaryOutcomes = useStore(s => s.beneficiaryOutcomes);

  const trail = useMemo(
    () => buildDonorImpactTrail(donor, transactions, campaigns, beneficiaryOutcomes),
    [donor, transactions, campaigns, beneficiaryOutcomes],
  );

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
        <Sparkles size={16} color="var(--color-accent)" />
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Donor impact trail</h3>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
          {formatINR(trail.totalRecorded)} across {trail.totalCampaignsFunded} campaign{trail.totalCampaignsFunded === 1 ? '' : 's'}
        </span>
      </div>

      {trail.campaigns.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)', margin: 0 }}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            <ArrowRight size={12} /> Measured outcomes on those programmes:
          </div>

          {trail.programmes.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', margin: 0 }}>
              No outcome measurements logged yet for the funded programmes. Add records on Beneficiaries to fill in this trail.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
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
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'capitalize' }}>{p.programLabel}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>
                    <span><Users size={11} style={{ verticalAlign: '-1px' }} /> {p.beneficiariesMeasured} measured</span>
                    <span>+{p.avgImprovementPct.toFixed(1)}% avg</span>
                    <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>SROI {p.sroiScore.toFixed(2)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default DonorImpactPanel;
