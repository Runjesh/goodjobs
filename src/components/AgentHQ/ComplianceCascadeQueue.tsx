import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight, User, ListChecks } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { selectAtRiskGrants } from '../../utils/complianceGrant';
import { renewalWorkspacePath } from '../../utils/complianceRenewal';

const RENEWAL_STEPS: Record<string, string[]> = {
  'Donor Deduction': [
    'Download Form 10BD from Income Tax portal',
    'File with PCIT/CIT online before expiry',
    'Upload renewed certificate to Compliance Vault',
  ],
  'Tax Exemption': [
    'File application to PCIT/CIT (Form 10A)',
    'Attach audited financials for last 3 years',
    'Allow 3–6 months for ministry review',
  ],
  'Foreign Contribution': [
    'Log in to FCRA online portal (MHA)',
    'Ensure all FC-4 annual returns are filed',
    'Submit renewal application — ministry review takes 6–8 weeks',
  ],
  'CSR Eligibility': [
    'File CSR-1 on MCA21 portal',
    'Attach board resolution on CSR spend',
    'Update MCA record within 30 days of new FY',
  ],
};

function renewalSteps(docType: string): string[] {
  return RENEWAL_STEPS[docType] ?? ['Contact issuing authority for renewal procedure'];
}

const ComplianceCascadeQueue: React.FC = () => {
  const navigate = useNavigate();
  const links   = useStore(s => s.complianceGrantLinks);
  const grants  = useStore(s => s.csrCards);
  const docs    = useStore(s => s.complianceDocs);

  const items = selectAtRiskGrants(links, grants, docs);
  if (items.length === 0) return null;

  return (
    <section
      style={{
        padding: '1rem 1.1rem',
        borderRadius: 'var(--radius-xl)',
        background: 'var(--color-bg-card)',
        border: '1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)',
        marginBottom: '1rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
        <ShieldAlert size={16} color="var(--color-warning)" />
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Grants blocked by compliance</h3>
        <span className="badge" style={{ background: 'var(--color-warning)', color: 'white', marginLeft: 'auto', fontSize: '0.7rem' }}>
          {items.length}
        </span>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {items.map(it => {
          const isRed = it.tone === 'red';
          const dayLabel = isRed
            ? (it.daysToExpiry < 0 ? `expired ${Math.abs(it.daysToExpiry)}d ago` : 'expired today')
            : `expires in ${it.daysToExpiry}d`;
          const owner = it.doc.assigned_to;
          const steps = renewalSteps(it.doc.type);
          return (
            <li
              key={it.link.id}
              style={{
                padding: '0.65rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-main)',
                borderLeft: `3px solid ${isRed ? 'var(--color-danger)' : 'var(--color-warning)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: owner || steps.length > 0 ? '0.5rem' : 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{it.grant.company} — {it.grant.project}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                    {it.doc.name} · {dayLabel}{it.link.reason ? ` · ${it.link.reason}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem', flexShrink: 0 }}
                  onClick={() => navigate(renewalWorkspacePath(it.doc.id))}
                >
                  Renew first <ArrowRight size={12} />
                </button>
              </div>
              {/* Compliance owner + renewal process */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.35rem' }}>
                {owner && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: 'var(--color-text-secondary)', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-sm)', padding: '2px 7px' }}>
                    <User size={11} />
                    <span>Owner: <strong>{owner}</strong></span>
                  </div>
                )}
                <details style={{ fontSize: '0.72rem' }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600, listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <ListChecks size={11} /> Renewal steps
                  </summary>
                  <ol style={{ margin: '0.35rem 0 0 1rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    {steps.map((s, i) => (
                      <li key={i} style={{ color: 'var(--color-text-secondary)', marginTop: '0.15rem' }}>{s}</li>
                    ))}
                  </ol>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ComplianceCascadeQueue;
