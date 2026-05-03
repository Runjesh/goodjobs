import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { selectAtRiskGrants } from '../../utils/complianceGrant';

/**
 * HITL queue entries for the Compliance → Grant cascade. Each entry pairs a
 * grant with its expiring/expired compliance doc and offers a single
 * "Renew first" CTA that deep-links to the Compliance page.
 */
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
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {items.map(it => {
          const isRed = it.tone === 'red';
          const dayLabel = isRed
            ? (it.daysToExpiry < 0 ? `expired ${Math.abs(it.daysToExpiry)}d ago` : 'expired today')
            : `expires in ${it.daysToExpiry}d`;
          return (
            <li
              key={it.link.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                padding: '0.55rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-main)',
                borderLeft: `3px solid ${isRed ? 'var(--color-danger)' : 'var(--color-warning)'}`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{it.grant.company} — {it.grant.project}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                  {it.doc.name} · {dayLabel}{it.link.reason ? ` · ${it.link.reason}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
                onClick={() => navigate(`/compliance?focus=${encodeURIComponent(it.doc.id)}`)}
              >
                Renew first <ArrowRight size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ComplianceCascadeQueue;
