import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Upload, Users, Building2, MessageCircle, ArrowRight, Sparkles, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './FirstRunEmptyState.css';

interface ImportPath {
  id: string;
  Icon: React.ElementType;
  title: string;
  blurb: string;
  cta: string;
  path: string;
  est: string;
  color: string;
}

const PATHS: ImportPath[] = [
  {
    id: 'donors',
    Icon: Users,
    title: 'Import your donors',
    blurb: 'Upload a CSV from Tally, Razorpay, or your spreadsheet. We will auto-detect 80G fields, PANs, and lapsed donors.',
    cta: 'Import donor CSV',
    path: '/crm?import=1',
    est: '≈ 5 min · 1 CSV',
    color: '#0F766E',
  },
  {
    id: 'beneficiaries',
    Icon: FileSpreadsheet,
    title: 'Bring your beneficiaries',
    blurb: 'Upload a CSV or paste from your MIS. Aadhaar fields are stored encrypted (DPDP-compliant).',
    cta: 'Import beneficiaries',
    path: '/programs?import=1',
    est: '≈ 5 min · CSV or paste',
    color: '#7C3AED',
  },
  {
    id: 'csr',
    Icon: Building2,
    title: 'Add your live CSR pipeline',
    blurb: 'Drop in companies you are pitching, sign-stage MoUs, and live grants. We will pre-fill Schedule VII tags.',
    cta: 'Open CSR pipeline',
    path: '/csr',
    est: '≈ 3 min · 5–10 cards',
    color: '#D97706',
  },
];

const FirstRunEmptyState: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <motion.div
      className="firstrun-shell"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="firstrun-hero">
        <div className="firstrun-hero-eyebrow">
          <Sparkles size={13} /> Day one
        </div>
        <h2 className="firstrun-hero-title">
          Welcome to GoodJobs, {firstName}.
        </h2>
        <p className="firstrun-hero-sub">
          Your organisation has <strong>no donors, beneficiaries, or grants</strong> yet.
          Pick the fastest path to bring your real data in — most teams finish in under
          15 minutes.
        </p>
      </div>

      <div className="firstrun-paths">
        {PATHS.map((p, i) => {
          const Icon = p.Icon;
          return (
            <motion.button
              key={p.id}
              className="firstrun-path-card"
              onClick={() => navigate(p.path)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * (i + 1), duration: 0.25 }}
              style={{ '--path-color': p.color } as React.CSSProperties}
            >
              <div className="firstrun-path-icon" style={{ background: `${p.color}1a`, color: p.color }}>
                <Icon size={20} />
              </div>
              <div className="firstrun-path-body">
                <div className="firstrun-path-title-row">
                  <span className="firstrun-path-step">Step {i + 1}</span>
                  <h3 className="firstrun-path-title">{p.title}</h3>
                </div>
                <p className="firstrun-path-blurb">{p.blurb}</p>
                <div className="firstrun-path-foot">
                  <span className="firstrun-path-est">{p.est}</span>
                  <span className="firstrun-path-cta" style={{ color: p.color }}>
                    {p.cta} <ArrowRight size={13} />
                  </span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="firstrun-aside">
        <div className="firstrun-aside-row">
          <Upload size={14} />
          <span>
            <strong>No CSV?</strong> You can also enter your first 5 donors manually
            from <button className="firstrun-link" onClick={() => navigate('/crm')}>CRM → Add donor</button>.
          </span>
        </div>
        <div className="firstrun-aside-row">
          <MessageCircle size={14} />
          <span>
            <strong>WhatsApp data entry</strong> for field staff is set up
            from <button className="firstrun-link" onClick={() => navigate('/settings')}>Settings → Integrations</button>.
          </span>
        </div>
      </div>

      <p className="firstrun-foot-note">
        Once you have data, this page becomes your daily Priority Queue with
        AI-suggested next actions, donor lifecycle alerts, and grant deadlines.
      </p>
    </motion.div>
  );
};

export default FirstRunEmptyState;
