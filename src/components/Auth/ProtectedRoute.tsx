import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  module?: string;
}

/**
 * ProtectedRoute — gates any route behind authentication.
 * If a `module` prop is provided, also checks view permission for that module.
 * Unauthenticated → /login
 * Authenticated but no permission → 403 screen
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, module }) => {
  const { isAuthenticated, can } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (module && !can(module, 'canView')) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '60vh', gap: '1rem', textAlign: 'center', padding: '2rem'
      }}>
        <div style={{ fontSize: '3rem' }}>🔒</div>
        <h2 style={{ fontWeight: 700, fontSize: '1.25rem' }}>Access Restricted</h2>
        <p style={{ color: 'var(--color-text-secondary)', maxWidth: 400 }}>
          Your current role does not have permission to view this module.
          Contact your Executive Director to request access.
        </p>
        <div style={{
          padding: '0.75rem 1.25rem', background: '#fef3c7', borderRadius: '0.5rem',
          fontSize: '0.8rem', color: '#92400e', border: '1px solid #fcd34d'
        }}>
          💡 Tip: You can switch roles by logging out and selecting a different role.
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
