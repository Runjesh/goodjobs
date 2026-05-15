import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus, ClipboardCheck, Tags, ReceiptText, RefreshCw, FileText,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { renewalWorkspacePath } from '../../utils/complianceRenewal';

interface Tile {
  id: string;
  label: string;
  sub: string;
  path: string;
  icon: React.ElementType;
  color: string;
}

const DoThisNowLauncher: React.FC = () => {
  const navigate = useNavigate();
  const complianceDocs = useStore(s => s.complianceDocs);
  const transactions = useStore(s => s.transactions);
  const grantReports = useStore(s => s.grantReports);

  const expiringDoc = useMemo(
    () => complianceDocs.find(d => d.status === 'Expiring Soon' || d.status === 'Expired'),
    [complianceDocs],
  );
  const pendingReceipts = useMemo(
    () => transactions.filter((t) => {
      const row = t as { receipt_status?: string; receipt_number?: string };
      return row.receipt_status === 'pending' || !row.receipt_number;
    }).length,
    [transactions],
  );
  const grantReport = grantReports[0];

  const tiles: Tile[] = [
    {
      id: 'enroll',
      label: 'Enroll beneficiary',
      sub: 'Open intake with consent + household',
      path: '/programs?action=enroll',
      icon: UserPlus,
      color: '#059669',
    },
    {
      id: 'mis',
      label: 'Review MIS submissions',
      sub: 'Verify field captures awaiting approval',
      path: '/programs?tab=mis&filter=verify',
      icon: ClipboardCheck,
      color: '#0F766E',
    },
    {
      id: 'classify',
      label: 'Classify transactions',
      sub: 'Tag expenses to grants & programmes',
      path: '/finance?view=exceptions',
      icon: Tags,
      color: '#d97706',
    },
    {
      id: 'receipts',
      label: pendingReceipts > 0 ? `Send ${pendingReceipts} pending receipts` : 'Send pending receipts',
      sub: 'Issue 80G and close donation loop',
      path: '/finance?view=receipts',
      icon: ReceiptText,
      color: '#7c3aed',
    },
    {
      id: 'renewal',
      label: 'Renew expiring document',
      sub: expiringDoc ? expiringDoc.name : 'No urgent renewals',
      path: expiringDoc ? renewalWorkspacePath(expiringDoc.id) : '/compliance?alert=true',
      icon: RefreshCw,
      color: '#c2410c',
    },
    {
      id: 'report',
      label: 'Draft grant report',
      sub: grantReport ? grantReport.title : 'Readiness-first AI draft',
      path: grantReport
        ? `/reports?action=draft&report=${encodeURIComponent(grantReport.id)}`
        : '/reports?action=draft&type=funder',
      icon: FileText,
      color: '#0891b2',
    },
  ];

  return (
    <motion.section
      className="do-this-now"
      aria-label="Do this now"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="today-section-title">Do this now</h2>
      <div className="do-this-now-grid">
        {tiles.map(tile => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.id}
              type="button"
              className="do-this-now-tile"
              onClick={() => navigate(tile.path)}
              style={{ '--tile-color': tile.color } as React.CSSProperties}
            >
              <span className="do-this-now-icon" style={{ background: `${tile.color}18`, color: tile.color }}>
                <Icon size={18} />
              </span>
              <span className="do-this-now-label">{tile.label}</span>
              <span className="do-this-now-sub">{tile.sub}</span>
            </button>
          );
        })}
      </div>
    </motion.section>
  );
};

export default DoThisNowLauncher;
