import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, HeartHandshake, Users, Cpu, CheckSquare
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const PRIMARY_NAV = [
  { path: '/',            icon: LayoutDashboard, label: 'Dashboard',  module: 'dashboard'  },
  { path: '/fundraising', icon: HeartHandshake,  label: 'Raising',    module: 'fundraising' },
  { path: '/crm',         icon: Users,           label: 'Donors',     module: 'crm'        },
  { path: '/tasks',       icon: CheckSquare,     label: 'Tasks',      module: 'tasks'  },
  { path: '/agent-hq',    icon: Cpu,             label: 'Copilot',    module: 'agent-hq'  },
];

const BottomNav: React.FC = () => {
  const { can } = useAuth();

  return (
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
          >
            <Icon size={22} className="bottom-nav-icon" />
            <span className="bottom-nav-label">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
};

export default BottomNav;
