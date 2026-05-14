import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import { Lock, ArrowLeft } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  module?: string;
}

// Module-specific helpful context
const MODULE_CONTEXT: Record<string, { owner: string; tip: string }> = {
  funding:     { owner: 'Finance or ED', tip: 'Ask your Finance Officer to share a specific report or grant view.' },
  finance:     { owner: 'Finance team',  tip: 'Financial data requires Finance Officer or ED access.' },
  insights:    { owner: 'Programs or ED', tip: 'M&E data is viewable by Program Managers and above.' },
  reports:     { owner: 'Programs or ED', tip: 'Report drafts can be shared as PDFs with board members.' },
  compliance:  { owner: 'Finance or ED', tip: 'Compliance documents are managed by the Finance team.' },
  crm:         { owner: 'Finance or ED', tip: 'Donor data requires Finance Officer or ED access.' },
  fundraising: { owner: 'Finance or ED', tip: 'Fundraising campaigns are managed by Finance or ED.' },
  csr:         { owner: 'Programs or ED', tip: 'CSR pipeline is handled by Program Managers.' },
  'agent-hq':  { owner: 'ED or Finance',  tip: 'Copilot agent tasks require ED or Finance approval rights.' },
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, module }) => {
  const { isAuthenticated, can, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (module && !can(module, 'canView')) {
    const ctx = MODULE_CONTEXT[module];
    const meta = user ? ROLE_META[user.role] : null;

    return (
      <div className="permission-denied">
        <div className="permission-denied-card">
          <div className="permission-denied-icon">
            <Lock size={24} />
          </div>
          <h2 className="permission-denied-title">Access Restricted</h2>
          <p className="permission-denied-body">
            {ctx
              ? `This section is managed by your ${ctx.owner}. ${ctx.tip}`
              : 'Your current role does not have permission to view this module.'}
          </p>
          {meta && (
            <div className="permission-denied-role">
              You are signed in as <strong>{meta.icon} {meta.label}</strong>
            </div>
          )}
          <div className="permission-denied-actions">
            <button
              className="permission-denied-back"
              onClick={() => window.history.back()}
            >
              <ArrowLeft size={14} /> Go back
            </button>
            <a href="/" className="permission-denied-home">
              Back to Today
            </a>
          </div>
        </div>

        <style>{`
          .permission-denied {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 60vh;
            padding: 2rem;
          }
          .permission-denied-card {
            background: var(--color-bg-card);
            border: 1px solid var(--color-border-light);
            border-radius: var(--radius-xl);
            padding: 2.5rem 2rem;
            max-width: 420px;
            width: 100%;
            text-align: center;
            box-shadow: var(--shadow-sm);
          }
          .permission-denied-icon {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: #fef3c7;
            color: #d97706;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.25rem;
          }
          .permission-denied-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--color-text-primary);
            margin-bottom: 0.75rem;
          }
          .permission-denied-body {
            font-size: 0.9375rem;
            color: var(--color-text-secondary);
            line-height: 1.6;
            margin-bottom: 1rem;
          }
          .permission-denied-role {
            display: inline-block;
            padding: 0.375rem 0.875rem;
            background: var(--color-bg-main);
            border: 1px solid var(--color-border-light);
            border-radius: var(--radius-full);
            font-size: 0.8125rem;
            color: var(--color-text-secondary);
            margin-bottom: 1.5rem;
          }
          .permission-denied-actions {
            display: flex;
            gap: 0.75rem;
            justify-content: center;
            flex-wrap: wrap;
          }
          .permission-denied-back {
            display: inline-flex;
            align-items: center;
            gap: 0.375rem;
            padding: 0.5rem 1rem;
            background: var(--color-bg-main);
            border: 1px solid var(--color-border-light);
            border-radius: var(--radius-lg);
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--color-text-secondary);
            cursor: pointer;
            transition: all var(--transition-fast);
          }
          .permission-denied-back:hover {
            background: var(--color-bg-elevated);
            color: var(--color-text-primary);
          }
          .permission-denied-home {
            display: inline-flex;
            align-items: center;
            padding: 0.5rem 1rem;
            background: var(--color-primary);
            border-radius: var(--radius-lg);
            font-size: 0.875rem;
            font-weight: 600;
            color: white;
            text-decoration: none;
            transition: background var(--transition-fast);
          }
          .permission-denied-home:hover { background: var(--color-primary-hover); }
        `}</style>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
