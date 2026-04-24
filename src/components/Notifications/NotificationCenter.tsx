import React, { useState } from 'react';
import { Bell, Check, Trash2, X, Settings, Zap, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import './NotificationCenter.css';

interface Notification {
  id: string;
  type: 'urgent' | 'info' | 'agent';
  title: string;
  message: string;
  time: string;
  read: boolean;
}

const mockNotifications: Notification[] = [
  { id: '1', type: 'urgent', title: 'FCRA Alert', message: 'Admin overhead reached 18%. Approaching 20% limit.', time: '10m ago', read: false },
  { id: '2', type: 'agent', title: 'CSR Pipeline Agent', message: 'Automated 3 follow-ups to Tata Trusts.', time: '2h ago', read: false },
  { id: '3', type: 'info', title: 'Daily Digest Available', message: '12 new donations logged. 3 pending approvals.', time: '5h ago', read: true },
  { id: '4', type: 'info', title: 'Board Briefing Sent', message: 'Morning brief delivered to 5 trustees.', time: '1d ago', read: true },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const NotificationCenter: React.FC<Props> = ({ isOpen, onClose }) => {
  const [notifications, setNotifications] = useState(mockNotifications);

  if (!isOpen) return null;

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
    toast.success('All notifications marked as read.');
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'urgent': return <ShieldAlert size={16} className="text-danger" />;
      case 'agent': return <Zap size={16} className="text-primary" />;
      default: return <Bell size={16} className="text-tertiary" />;
    }
  };

  return (
    <>
      <div className="notif-overlay" onClick={onClose} />
      <div className="notif-panel">
        <div className="notif-header">
          <div>
            <h2 className="notif-title">Smart Notifications</h2>
            <p className="notif-subtitle">
              {unreadCount} unread • AI batched
            </p>
          </div>
          <div className="flex gap-2">
            <button className="action-btn-small" onClick={markAllRead} title="Mark all read"><Check size={14} /></button>
            <button className="action-btn-small" onClick={() => toast('Notification preferences opened.')} title="Settings"><Settings size={14} /></button>
            <button className="action-btn-small" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        <div className="notif-list">
          {notifications.length === 0 ? (
            <div className="notif-empty">You're all caught up!</div>
          ) : (
            notifications.map(n => (
              <div key={n.id} className={`notif-item ${n.read ? 'read' : 'unread'}`}>
                <div className={`notif-icon-wrap ${n.type}`}>{getIcon(n.type)}</div>
                <div className="notif-content">
                  <div className="notif-item-header">
                    <h4>{n.title}</h4>
                    <span className="notif-time">{n.time}</span>
                  </div>
                  <p>{n.message}</p>
                </div>
                {!n.read && <div className="notif-dot" />}
              </div>
            ))
          )}
        </div>

        {notifications.length > 0 && (
          <div className="notif-footer">
            <button className="btn-ghost" onClick={clearAll} style={{ width: '100%', fontSize: '0.8rem' }}>
              <Trash2 size={14} /> Clear All
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default NotificationCenter;
