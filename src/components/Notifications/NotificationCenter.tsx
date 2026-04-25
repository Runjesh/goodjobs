import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Trash2, X, Settings, Zap, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import './NotificationCenter.css';
import { apiFetch } from '../../api/client';
import { notificationTasksHref } from '../../utils/inboxLinks';

interface Notification {
  id: string;
  tasks_path?: string | null;
  type: 'urgent' | 'info' | 'agent';
  title: string;
  message: string;
  time: string;
  read: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const NotificationCenter: React.FC<Props> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const run = async () => {
      try {
        const res = await apiFetch('/notifications');
        if (!res.ok) throw new Error('load');
        const data = await res.json();
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      } catch {
        setNotifications([]);
      }
    };
    run();
  }, [isOpen]);

  if (!isOpen) return null;

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = async () => {
    try {
      const res = await apiFetch('/notifications/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      });
      if (!res.ok) throw new Error('mark');
      setNotifications(notifications.map(n => ({ ...n, read: true })));
      toast.success('All notifications marked as read.');
    } catch {
      toast.error('Failed to mark notifications read.');
    }
  };

  const clearAll = async () => {
    try {
      const res = await apiFetch('/notifications/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_all' }),
      });
      if (!res.ok) throw new Error('clear');
      setNotifications([]);
    } catch {
      toast.error('Failed to clear notifications.');
    }
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
            <button
              className="action-btn-small"
              onClick={() => { window.location.hash = '/settings'; onClose(); }}
              title="Settings"
            >
              <Settings size={14} />
            </button>
            <button className="action-btn-small" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        <div className="notif-list">
          {notifications.length === 0 ? (
            <div className="notif-empty">You're all caught up!</div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                className={`notif-item ${n.read ? 'read' : 'unread'}`}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  navigate(notificationTasksHref(n));
                  onClose();
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(notificationTasksHref(n));
                    onClose();
                  }
                }}
              >
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
