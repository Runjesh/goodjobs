import React, { useState } from 'react';
import { LogOut, ChevronDown, Shield } from 'lucide-react';
import { useAuth, ROLE_META } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const UserChip: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const meta = ROLE_META[user.role];

  const handleLogout = () => {
    logout();
    toast('Logged out successfully.', { icon: '👋' });
    navigate('/login');
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.5rem 0.75rem', borderRadius: '0.625rem',
          border: '1px solid var(--color-border-light)',
          background: 'white', cursor: 'pointer', width: '100%',
          transition: 'all 0.15s ease'
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-main)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'white')}
      >
        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: `linear-gradient(135deg, ${meta.color}, ${meta.color}99)`,
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: '0.875rem', flexShrink: 0
        }}>
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '1px' }}>
            <span style={{
              fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px',
              borderRadius: '99px', background: meta.bg, color: meta.color
            }}>
              {meta.icon} {meta.label}
            </span>
          </div>
        </div>
        <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div style={{
            position: 'absolute', bottom: '110%', left: 0, right: 0,
            background: 'white', border: '1px solid var(--color-border-light)',
            borderRadius: '0.75rem', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            zIndex: 100, overflow: 'hidden', padding: '0.5rem'
          }}>
            <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--color-border-light)', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{user.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{user.email}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>{user.ngoName}</div>
            </div>

            <button
              onClick={() => { setOpen(false); navigate('/settings'); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--color-text-secondary)', transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-main)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <Shield size={14} /> Settings & Privacy
            </button>

            <button
              onClick={handleLogout}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--color-danger)', transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default UserChip;
