import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { selectAtRiskGrants } from '../../utils/complianceGrant';
import { renewalWorkspacePath } from '../../utils/complianceRenewal';

interface Props {
  /** When set, only show at-risk entries for that grant; used on GrantDetail. */
  grantId?: string;
  /** Hide entirely when no entries match (default true). */
  hideWhenEmpty?: boolean;
}

/**
 * Surfaces every grant whose linked compliance doc is within 30d of expiry
 * (yellow) or already expired (red). Each row offers a "Renew first" CTA
 * that deep-links into the Compliance page so the user can act inline.
 */
const AtRiskGrantsBanner: React.FC<Props> = ({ grantId, hideWhenEmpty = true }) => {
  const navigate = useNavigate();
  const links  = useStore(s => s.complianceGrantLinks);
  const grants = useStore(s => s.csrCards);
  const docs   = useStore(s => s.complianceDocs);

  const items = selectAtRiskGrants(links, grants, docs)
    .filter(it => (grantId ? String(it.grant.id) === String(grantId) : true));

  if (items.length === 0 && hideWhenEmpty) return null;

  return (
    <div
      role="alert"
      style={{
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-lg)',
        background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
        <ShieldAlert size={16} color="var(--color-warning)" />
        Compliance at risk{grantId ? '' : ` — ${items.length} grant${items.length === 1 ? '' : 's'} affected`}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {items.map(it => {
          const isRed = it.tone === 'red';
          const dayLabel = isRed
            ? (it.daysToExpiry < 0 ? `expired ${Math.abs(it.daysToExpiry)}d ago` : 'expired')
            : `expires in ${it.daysToExpiry}d`;
          return (
            <li
              key={it.link.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-card)',
                borderLeft: `3px solid ${isRed ? 'var(--color-danger)' : 'var(--color-warning)'}`,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  {it.grant.company} — {it.grant.project}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                  Blocked on <strong>{it.doc.name}</strong> ({it.doc.type}) · {dayLabel}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                onClick={() => navigate(renewalWorkspacePath(it.doc.id))}
              >
                Renew first <ArrowRight size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AtRiskGrantsBanner;
