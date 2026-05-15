import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Sun, ClipboardList, Wallet, BarChart2, FileText, Cpu, Settings,
  MoreHorizontal, X, HeartHandshake, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const PRIMARY_NAV = [
  { path: '/',          icon: Sun,          label: 'Today',    module: 'dashboard' },
  { path: '/programs',  icon: ClipboardList,label: 'Beneficiaries', module: 'programs' },
  { path: '/funding',   icon: Wallet,       label: 'Money',       module: 'funding' },
  { path: '/insights',  icon: BarChart2,    label: 'Insights', module: 'insights' },
];

const MORE_ITEMS = [
  { path: '/reports',   icon: FileText,     label: 'Reports',  module: 'reports' },
  { path: '/agent-hq',  icon: Cpu,          label: 'AI',       module: 'agent-hq' },
  { path: '/settings',  icon: Settings,     label: 'Settings', module: 'settings' },
];

const BottomNav: React.FC = () => {
  const { can } = useAuth();
  const [showMore, setShowMore] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const isMoreActive = MORE_ITEMS.some(i => location.pathname.startsWith(i.path));

  return (
    <>
      <nav className="bottom-nav" role="navigation" aria-label="Primary navigation">
        {PRIMARY_NAV.map(item => {
          const Icon = item.icon;
          const hasAccess = can(item.module, 'canView');
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `bottom-nav-item ${isActive ? 'active' : ''} ${!hasAccess ? 'locked' : ''}`
              }
              aria-label={item.label}
              onClick={(e) => { if (!hasAccess) e.preventDefault(); }}
            >
              <Icon size={22} className="bottom-nav-icon" />
              <span className="bottom-nav-label">{item.label}</span>
            </NavLink>
          );
        })}

        <button
          className={`bottom-nav-item ${isMoreActive || showMore ? 'active' : ''}`}
          aria-label="More"
          onClick={() => setShowMore(v => !v)}
        >
          {showMore ? <X size={22} className="bottom-nav-icon" /> : <MoreHorizontal size={22} className="bottom-nav-icon" />}
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>

      {showMore && (
        <div className="more-sheet-overlay open" onClick={() => setShowMore(false)}>
          <div className="more-sheet" onClick={e => e.stopPropagation()}>
            <div className="more-sheet-handle" />
            <div className="more-sheet-title">More</div>
            <div className="more-sheet-grid">
              {MORE_ITEMS.map(item => {
                const Icon = item.icon;
                const hasAccess = can(item.module, 'canView');
                const isActive = location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.path}
                    className={`more-sheet-item ${isActive ? 'active' : ''} ${!hasAccess ? 'locked' : ''}`}
                    onClick={() => {
                      if (!hasAccess) return;
                      navigate(item.path);
                      setShowMore(false);
                    }}
                  >
                    <div className="more-sheet-icon">
                      <Icon size={20} />
                    </div>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BottomNav;
