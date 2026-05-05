import React, { useState, useRef, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { useAuth, ROLE_META, ROLE_PERMISSIONS, type UserRole } from '../../context/AuthContext';
import type { Permission } from '../../context/AuthContext';

interface PermissionGateProps {
  /** Module to check permission on (e.g. "finance", "programs"). */
  module: string;
  /** Permission action required (default: "canEdit"). */
  action?: keyof Omit<Permission, 'module'>;
  /** Role label shown in the tooltip — inferred from the first role that has the permission if omitted. */
  requiredRole?: UserRole;
  children: React.ReactElement;
}

const ROLE_ORDER: UserRole[] = ['ed', 'finance', 'programs', 'field', 'board'];

function inferRequiredRole(module: string, action: keyof Omit<Permission, 'module'>): UserRole {
  for (const role of ROLE_ORDER) {
    const perm = ROLE_PERMISSIONS[role]?.find((p) => p.module === module);
    if (perm && perm[action]) return role;
  }
  return 'ed';
}

/**
 * Wraps a single child element. When the current user lacks the specified
 * permission, the child is rendered disabled and a tooltip on hover explains
 * which role is required.
 *
 * Usage:
 *   <PermissionGate module="finance" action="canEdit">
 *     <button onClick={...}>Post journal entry</button>
 *   </PermissionGate>
 */
const PermissionGate: React.FC<PermissionGateProps> = ({
  module,
  action = 'canEdit',
  requiredRole,
  children,
}) => {
  const { can } = useAuth();
  const allowed = can(module, action);
  const [showTip, setShowTip] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!showTip) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowTip(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTip]);

  if (allowed) return children;

  const role: UserRole = requiredRole ?? inferRequiredRole(module, action);
  const roleLabel = ROLE_META[role]?.label ?? role;

  const child = React.cloneElement(children, {
    disabled: true,
    'aria-disabled': true,
    style: { ...(children.props.style ?? {}), opacity: 0.45, cursor: 'not-allowed' },
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setShowTip(true);
    },
  });

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      {child}
      {showTip && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1e293b',
            color: '#f8fafc',
            fontSize: '0.72rem',
            fontWeight: 500,
            padding: '0.35rem 0.6rem',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            pointerEvents: 'none',
          }}
        >
          <Lock size={10} />
          Requires {roleLabel} access
        </span>
      )}
    </span>
  );
};

export default PermissionGate;
