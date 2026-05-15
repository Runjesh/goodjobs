import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Trash2, X, Settings, Zap, ShieldAlert, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import './NotificationCenter.css';
import { apiFetch } from '../../api/client';
import { notificationTasksHref } from '../../utils/inboxLinks';

interface Notification {
  id: string;
  tasks_path?: string | null;
  /** Typed deep-link the notification points at — preferred over tasks_path. */
  action_route?: string | null;
  type: 'urgent' | 'info' | 'agent';
  title: string;
  message: string;
  time: string;
  read: boolean;
  /** Epoch ms; while in the future the row is hidden from the panel. */
  snoozed_until?: number;
}

/** Hour buckets the user can snooze a row by. */
const SNOOZE_OPTIONS = [
  { label: '1 hour',  ms:        60 * 60 * 1000 },
  { label: '4 hours', ms:    4 * 60 * 60 * 1000 },
  { label: 'Tomorrow', ms:  24 * 60 * 60 * 1000 },
];

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

  const now = Date.now();
  const visibleNotifications = notifications.filter(n => !n.snoozed_until || n.snoozed_until <= now);
  const unreadCount = visibleNotifications.filter(n => !n.read).length;

  const resolveRoute = (n: Notification): string =>
    n.action_route || notificationTasksHref(n);

  const snooze = async (id: string, ms: number) => {
    const hours = ms / (60 * 60 * 1000);
    setNotifications(prev => prev.map(x => x.id === id ? { ...x, snoozed_until: Date.now() + ms } : x));
    try {
      const res = await apiFetch('/notifications/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: id, action: 'snooze', snooze_hours: hours }),
      });
      if (!res.ok) throw new Error('snooze');
    } catch { /* local state still applies in demo */ }
    toast(`Snoozed for ${SNOOZE_OPTIONS.find(o => o.ms === ms)?.label ?? 'a while'}.`, { icon: '⏰' });
  };

  const dismiss = async (id: string) => {
    setNotifications(prev => prev.filter(x => x.id !== id));
    try {
      await apiFetch('/notifications/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: id, action: 'dismiss' }),
      });
    } catch { /* ignore */ }
  };

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
              onClick={() => { navigate('/settings'); onClose(); }}
              title="Settings"
            >
              <Settings size={14} />
            </button>
            <button className="action-btn-small" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        <div className="notif-list">
          {visibleNotifications.length === 0 ? (
            <div className="notif-empty">You're all caught up!</div>
          ) : (
            visibleNotifications.map(n => (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                className={`notif-item ${n.read ? 'read' : 'unread'}`}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  navigate(resolveRoute(n));
                  onClose();
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(resolveRoute(n));
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
                  <div
                    className="notif-item-actions"
                    style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}
                    onClick={e => e.stopPropagation()}
                  >
                    {SNOOZE_OPTIONS.map(o => (
                      <button
                        key={o.label}
                        className="action-btn-small"
                        type="button"
                        title={`Snooze ${o.label}`}
                        onClick={() => snooze(n.id, o.ms)}
                        style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      >
                        <Clock size={10} /> {o.label}
                      </button>
                    ))}
                    <button
                      className="action-btn-small"
                      type="button"
                      title="Dismiss"
                      onClick={() => dismiss(n.id)}
                      style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem' }}
                    >
                      Dismiss
                    </button>
                  </div>
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
