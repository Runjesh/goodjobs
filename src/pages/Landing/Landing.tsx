import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView, useMotionValue, useSpring, AnimatePresence } from 'framer-motion';
import {
  Sparkles, ShieldCheck, Users, BarChart3, FileText, Zap,
  ArrowRight, Check, ChevronRight, Globe, Lock, Cpu,
  Heart, TrendingUp, MessageSquare, ClipboardList, Wallet,
  Building2, Star, Menu, X, Play, IndianRupee, Clock,
  AlertTriangle, BadgeCheck, Boxes, Wifi
} from 'lucide-react';
import './Landing.css';

/* ── Animated counter ─────────────────────────────────────────────────────── */
const Counter: React.FC<{ to: number; prefix?: string; suffix?: string; decimals?: number }> = ({
  to, prefix = '', suffix = '', decimals = 0,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 18 });
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (inView) mv.set(to);
  }, [inView, mv, to]);

  useEffect(() => spring.on('change', v =>
    setDisplay(v.toFixed(decimals))
  ), [spring, decimals]);

  return <span ref={ref}>{prefix}{display}{suffix}</span>;
};

/* ── Scroll-reveal wrapper ────────────────────────────────────────────────── */
const Reveal: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({
  children, delay = 0, className,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
};

/* ── Nav ──────────────────────────────────────────────────────────────────── */
const Nav: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <header className={`lp-nav${scrolled ? ' lp-nav--scrolled' : ''}`}>
      <div className="lp-nav-inner">
        <a href="#hero" className="lp-nav-brand">
          <span className="lp-nav-logo-mark"><Heart size={16} /></span>
          GoodJobs
        </a>

        <nav className="lp-nav-links">
          <a href="#features">Features</a>
          <a href="#compliance">Compliance</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
        </nav>

        <div className="lp-nav-actions">
          <Link to="/login" className="lp-btn-ghost">Sign in</Link>
          <Link to="/signup" className="lp-btn-primary-sm">Start free trial</Link>
        </div>

        <button className="lp-nav-hamburger" onClick={() => setMobileOpen(o => !o)}>
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="lp-nav-mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
          >
            <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
            <a href="#compliance" onClick={() => setMobileOpen(false)}>Compliance</a>
            <a href="#how" onClick={() => setMobileOpen(false)}>How it works</a>
            <a href="#pricing" onClick={() => setMobileOpen(false)}>Pricing</a>
            <Link to="/login" onClick={() => setMobileOpen(false)}>Sign in</Link>
            <Link to="/signup" className="lp-btn-primary-sm" onClick={() => setMobileOpen(false)}>Start free trial →</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

/* ── Hero ─────────────────────────────────────────────────────────────────── */
const TICKER = [
  '"Asha Foundation filed 3 funder reports this month using AI drafts"',
  '"₹2.4L in 80G receipts generated automatically — zero manual work"',
  '"CSR compliance checklist completed 2 weeks before audit"',
  '"Tata Trusts grant report drafted in under 10 minutes from live data"',
  '"Field team synced 47 records after 4 hours offline"',
];

const Hero: React.FC = () => {
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTickerIdx(i => (i + 1) % TICKER.length), 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="hero" className="lp-hero">
      {/* Mesh gradient orbs */}
      <div className="lp-hero-orb lp-hero-orb--1" />
      <div className="lp-hero-orb lp-hero-orb--2" />
      <div className="lp-hero-orb lp-hero-orb--3" />

      <div className="lp-container lp-hero-inner">
        <motion.div
          className="lp-hero-badge"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <Sparkles size={13} />
          India's first AI-powered Nonprofit OS
          <span className="lp-hero-badge-dot" />
          <span>Now in beta</span>
        </motion.div>

        <motion.h1
          className="lp-hero-headline"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          Run your NGO like a<br />
          <span className="lp-hero-headline-accent">well-funded enterprise</span>
        </motion.h1>

        <motion.p
          className="lp-hero-sub"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          FCRA compliance, AI-driven workflows, donor CRM, and 80G automation —
          built for Indian nonprofits who want more impact with less admin.
        </motion.p>

        <motion.div
          className="lp-hero-ctas"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link to="/signup" className="lp-btn-hero-primary">
            Start 30-day free trial
            <ArrowRight size={17} />
          </Link>
          <a href="#how" className="lp-btn-hero-ghost">
            <span className="lp-play-icon"><Play size={13} /></span>
            See how it works
          </a>
        </motion.div>

        <motion.div
          className="lp-hero-social"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.42 }}
        >
          <div className="lp-hero-avatars">
            {['A','R','P','S','D'].map((l, i) => (
              <span key={i} className="lp-hero-avatar" style={{ '--i': i } as React.CSSProperties}>{l}</span>
            ))}
          </div>
          <span>Trusted by <strong>50+ NGOs</strong> across India · No credit card required</span>
        </motion.div>

        {/* Ticker */}
        <motion.div
          className="lp-hero-ticker"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={tickerIdx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
            >
              {TICKER[tickerIdx]}
            </motion.span>
          </AnimatePresence>
        </motion.div>

        {/* Dashboard screenshot mockup */}
        <motion.div
          className="lp-hero-screen-wrap"
          initial={{ opacity: 0, y: 48, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="lp-hero-screen">
            <div className="lp-screen-bar">
              <span /><span /><span />
              <div className="lp-screen-url">app.goodjobs.in · Dashboard</div>
            </div>
            <div className="lp-screen-body">
              {/* Mini dashboard preview */}
              <div className="lp-screen-sidebar">
                <div className="lp-screen-logo"><Heart size={14} /> GoodJobs</div>
                {['Today','Programs','Finance','Agent HQ','CRM','Insights'].map((l,i) => (
                  <div key={l} className={`lp-screen-nav-item${i===0?' lp-screen-nav-item--active':''}`}>{l}</div>
                ))}
              </div>
              <div className="lp-screen-main">
                <div className="lp-screen-topbar">
                  <span className="lp-screen-greeting">Good morning, Anjali 👋</span>
                  <span className="lp-screen-date">Today · 6 May 2026</span>
                </div>
                <div className="lp-screen-kpis">
                  {[
                    { label: 'Beneficiaries', val: '1,284', delta: '+12', color: 'teal' },
                    { label: 'FCRA Overhead', val: '17.3%', delta: '-0.4%', color: 'green' },
                    { label: 'Grant Utilisation', val: '68%', delta: 'On track', color: 'amber' },
                    { label: 'Pending Receipts', val: '7', delta: 'Action', color: 'violet' },
                  ].map(k => (
                    <div key={k.label} className={`lp-screen-kpi lp-screen-kpi--${k.color}`}>
                      <span className="lp-screen-kpi-label">{k.label}</span>
                      <span className="lp-screen-kpi-val">{k.val}</span>
                      <span className="lp-screen-kpi-delta">{k.delta}</span>
                    </div>
                  ))}
                </div>
                <div className="lp-screen-cards">
                  <div className="lp-screen-card lp-screen-card--agent">
                    <div className="lp-screen-card-header">
                      <Cpu size={11} /> <span>Agent HQ · 3 pending</span>
                    </div>
                    <div className="lp-screen-intent">
                      <span className="lp-screen-intent-risk lp-screen-intent-risk--low">Low risk</span>
                      <span>Generate 80G receipt for Amit Sharma — ₹25,000</span>
                    </div>
                    <div className="lp-screen-intent-actions">
                      <button className="lp-screen-btn lp-screen-btn--approve">Approve</button>
                      <button className="lp-screen-btn lp-screen-btn--modify">Modify</button>
                    </div>
                  </div>
                  <div className="lp-screen-card lp-screen-card--fcra">
                    <div className="lp-screen-card-header">
                      <ShieldCheck size={11} /> <span>FCRA Admin Overhead</span>
                    </div>
                    <div className="lp-screen-gauge-track">
                      <div className="lp-screen-gauge-fill" style={{ width: '17.3%' }} />
                    </div>
                    <span className="lp-screen-gauge-label">17.3% · Headroom: 2.7%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="lp-hero-screen-glow" />
        </motion.div>
      </div>
    </section>
  );
};

/* ── Trust bar ────────────────────────────────────────────────────────────── */
const TrustBar: React.FC = () => (
  <section className="lp-trust">
    <div className="lp-container">
      <p className="lp-trust-label">Trusted by impact-driven teams across India</p>
      <div className="lp-trust-logos">
        {[
          'Asha Foundation','Pratham','GiveIndia','Akshara Foundation',
          'CRY India','Smile Foundation','iCall','Teach for India',
        ].map(name => (
          <span key={name} className="lp-trust-logo">{name}</span>
        ))}
      </div>
    </div>
  </section>
);

/* ── Stats ────────────────────────────────────────────────────────────────── */
const Stats: React.FC = () => (
  <section className="lp-stats">
    <div className="lp-container">
      <div className="lp-stats-grid">
        {[
          { to: 50,  suffix: '+',    prefix: '',   label: 'NGOs onboarded',        icon: <Building2 size={20} /> },
          { to: 12,  suffix: 'Cr+',  prefix: '₹',  label: 'receipts auto-generated', decimals: 0, icon: <IndianRupee size={20} /> },
          { to: 10,  suffix: ' min', prefix: '',   label: 'avg. funder report time', icon: <Clock size={20} /> },
          { to: 99.9,suffix: '%',    prefix: '',   label: 'FCRA compliance rate',   decimals: 1, icon: <BadgeCheck size={20} /> },
        ].map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08} className="lp-stat-card">
            <div className="lp-stat-icon">{s.icon}</div>
            <div className="lp-stat-num">
              <Counter to={s.to} prefix={s.prefix} suffix={s.suffix} decimals={s.decimals ?? 0} />
            </div>
            <div className="lp-stat-label">{s.label}</div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ── Features bento ───────────────────────────────────────────────────────── */
const FEATURES = [
  {
    id: 'agent',
    size: 'large',
    icon: <Cpu size={22} />,
    label: 'Agent HQ · AI Copilot',
    title: 'AI that acts — with your approval',
    desc: 'Human-in-the-loop intent cards with risk badges, evidence packs, and one-tap approve/modify/reject. Every AI action is auditable and reversible.',
    tags: ['HITL', 'Risk scoring', 'Audit trail', 'Offline queue'],
    accent: 'violet',
  },
  {
    id: 'finance',
    size: 'medium',
    icon: <Wallet size={22} />,
    label: 'Finance & FCRA',
    title: 'Real-time FCRA overhead gauge',
    desc: 'Live 4-level gauge, 80G PDF receipts, bulk ZIP, expense tagging to grant budget heads.',
    tags: ['80G receipts', 'FCRA 20% cap', 'Journal entries'],
    accent: 'teal',
  },
  {
    id: 'crm',
    size: 'medium',
    icon: <Users size={22} />,
    label: 'Donor CRM',
    title: 'Donor intelligence with WhatsApp reach',
    desc: 'Full donor profiles, giving history, real-time WhatsApp delivery receipts and AI-crafted outreach.',
    tags: ['WhatsApp API', 'Delivery receipts', '80G trail'],
    accent: 'teal',
  },
  {
    id: 'programs',
    size: 'small',
    icon: <ClipboardList size={22} />,
    label: 'Programs & M&E',
    title: 'Beneficiary tracking with outcome measurement',
    desc: 'CSV import with duplicate detection, SROI calculations, and funder-formatted export.',
    tags: ['SROI', 'KPI benchmarks'],
    accent: 'emerald',
  },
  {
    id: 'compliance',
    size: 'small',
    icon: <ShieldCheck size={22} />,
    label: 'Compliance',
    title: 'Never miss a deadline again',
    desc: 'Expiry alerts cascade to linked grants. Auto-flagged CSR-1 reminders. DPDP data export.',
    tags: ['DPDP 2023', 'CSR-1', 'Grant cascade'],
    accent: 'amber',
  },
  {
    id: 'insights',
    size: 'small',
    icon: <BarChart3 size={22} />,
    label: 'Insights',
    title: 'Sector-benchmarked KPIs',
    desc: 'AI interpretation, staff-wise data quality breakdown, and one-click funder CSV export.',
    tags: ['Benchmarks', 'AI interpretation'],
    accent: 'blue',
  },
  {
    id: 'csr',
    size: 'small',
    icon: <TrendingUp size={22} />,
    label: 'CSR Pipeline',
    title: 'AI win-probability on every deal',
    desc: 'Kanban with stage scores, idle-day penalty, compliance doc health, and MoU→Live auto-tasks.',
    tags: ['AI scoring', 'Prospect DB'],
    accent: 'violet',
  },
  {
    id: 'volunteers',
    size: 'small',
    icon: <Heart size={22} />,
    label: 'Volunteers',
    title: 'Hours, roles, and programme linkage',
    desc: 'Volunteer assignments tracked by role, hours logged, and surfaced in Programme Effort Summary.',
    tags: ['Effort tracking', 'Programme link'],
    accent: 'rose',
  },
];

const Features: React.FC = () => (
  <section id="features" className="lp-features">
    <div className="lp-container">
      <Reveal className="lp-section-header">
        <span className="lp-section-eyebrow"><Boxes size={13} /> Everything you need</span>
        <h2 className="lp-section-title">One OS for your entire NGO</h2>
        <p className="lp-section-sub">
          From first donor contact to funder report, every workflow lives in one place — connected, intelligent, and audit-ready.
        </p>
      </Reveal>

      <div className="lp-bento">
        {FEATURES.map((f, i) => (
          <Reveal key={f.id} delay={i * 0.05} className={`lp-bento-card lp-bento-card--${f.size} lp-bento-card--${f.accent}`}>
            <div className="lp-bento-icon">{f.icon}</div>
            <div className="lp-bento-eyebrow">{f.label}</div>
            <h3 className="lp-bento-title">{f.title}</h3>
            <p className="lp-bento-desc">{f.desc}</p>
            <div className="lp-bento-tags">
              {f.tags.map(t => <span key={t} className="lp-bento-tag">{t}</span>)}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ── Compliance section ────────────────────────────────────────────────────── */
const Compliance: React.FC = () => (
  <section id="compliance" className="lp-compliance">
    <div className="lp-container lp-compliance-inner">
      <Reveal className="lp-compliance-text">
        <span className="lp-section-eyebrow lp-section-eyebrow--light"><Globe size={13} /> India-first by design</span>
        <h2 className="lp-section-title lp-section-title--light">
          Built for India's regulatory reality
        </h2>
        <p className="lp-section-sub lp-section-sub--light">
          Not a generic nonprofit tool adapted for India. GoodJobs was designed from the ground up
          for FCRA rules, DPDP obligations, and CSR compliance cycles.
        </p>
        <Link to="/signup" className="lp-btn-hero-primary" style={{ marginTop: '2rem', display: 'inline-flex' }}>
          See compliance features <ArrowRight size={16} />
        </Link>
      </Reveal>

      <div className="lp-compliance-cards">
        {[
          {
            icon: <ShieldCheck size={24} />,
            title: 'FCRA Compliance',
            desc: 'Real-time admin overhead gauge with 4 alert levels. Never exceed the 20% cap. Automatic FCRA-tagged transaction classification.',
            badge: 'Live gauge',
          },
          {
            icon: <FileText size={24} />,
            title: '80G Receipts',
            desc: 'One-click PDF receipts with NGO cert number, PAN, amount in words, and your registered signature block. Bulk ZIP for year-end.',
            badge: 'PDF auto-gen',
          },
          {
            icon: <Lock size={24} />,
            title: 'DPDP Act 2023',
            desc: 'Full data export on request. Role-based data access controls. Consent-tracked beneficiary records.',
            badge: 'Privacy-ready',
          },
          {
            icon: <AlertTriangle size={24} />,
            title: 'CSR-1 & Reporting',
            desc: 'Auto-tasks when a grant goes live: file CSR-1 within 7 days. Compliance doc expiry cascades to linked grants as risk flags.',
            badge: 'Auto-alerts',
          },
        ].map((c, i) => (
          <Reveal key={c.title} delay={i * 0.07} className="lp-compliance-card">
            <div className="lp-compliance-card-icon">{c.icon}</div>
            <div>
              <div className="lp-compliance-card-badge">{c.badge}</div>
              <h3 className="lp-compliance-card-title">{c.title}</h3>
              <p className="lp-compliance-card-desc">{c.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ── How it works ─────────────────────────────────────────────────────────── */
const HowItWorks: React.FC = () => (
  <section id="how" className="lp-how">
    <div className="lp-container">
      <Reveal className="lp-section-header">
        <span className="lp-section-eyebrow"><Zap size={13} /> Simple by design</span>
        <h2 className="lp-section-title">Up and running in one afternoon</h2>
        <p className="lp-section-sub">No IT team required. No six-month implementation. Real data, real workflows, same day.</p>
      </Reveal>

      <div className="lp-steps">
        {[
          {
            num: '01',
            icon: <MessageSquare size={26} />,
            title: 'Connect your data',
            desc: 'Import beneficiaries via CSV, sync donors from spreadsheets, or have field staff submit updates over WhatsApp — even offline. Data reconciles automatically when back online.',
            tags: ['CSV import', 'WhatsApp-first', 'Offline sync'],
          },
          {
            num: '02',
            icon: <Sparkles size={26} />,
            title: 'AI drafts everything',
            desc: 'Agent HQ surfaces intent cards — draft funder reports, flag grant utilisation risks, schedule 80G receipts, alert on FCRA headroom — each with risk score and evidence pack.',
            tags: ['Intent cards', 'Risk scoring', 'Evidence packs'],
          },
          {
            num: '03',
            icon: <Check size={26} />,
            title: 'You approve, it executes',
            desc: 'One tap to approve, modify, or reject. Every action is logged with full audit trail. Queue offline approvals and they sync the moment you\'re back online.',
            tags: ['Human-in-the-loop', 'Audit trail', 'Offline queue'],
          },
        ].map((step, i) => (
          <Reveal key={step.num} delay={i * 0.1} className="lp-step">
            <div className="lp-step-num">{step.num}</div>
            <div className="lp-step-icon">{step.icon}</div>
            <h3 className="lp-step-title">{step.title}</h3>
            <p className="lp-step-desc">{step.desc}</p>
            <div className="lp-step-tags">
              {step.tags.map(t => <span key={t} className="lp-step-tag">{t}</span>)}
            </div>
            {i < 2 && <div className="lp-step-connector"><ChevronRight size={18} /></div>}
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ── Testimonials ─────────────────────────────────────────────────────────── */
const TESTIMONIALS = [
  {
    quote: "GoodJobs cut our funder report time from two days to under an hour. The AI pulls live programme data and I just review and send.",
    name: 'Kavya Menon',
    role: 'Executive Director',
    org: 'Asha Foundation, Bengaluru',
    rating: 5,
  },
  {
    quote: "The FCRA gauge alone is worth it. We used to calculate admin overhead manually in Excel every month. Now it's live, real-time, and colour-coded.",
    name: 'Rajan Sharma',
    role: 'Finance Officer',
    org: 'Pratham, Mumbai',
  },
  {
    quote: "Our field staff submit via WhatsApp in Kannada. By the time I open my laptop, their entries are already parsed and waiting for my review in Agent HQ.",
    name: 'Suresh Pillai',
    role: 'Programs Manager',
    org: 'Jan Sewa Trust, Mysuru',
    rating: 5,
  },
];

const Testimonials: React.FC = () => (
  <section className="lp-testimonials">
    <div className="lp-container">
      <Reveal className="lp-section-header">
        <span className="lp-section-eyebrow"><Star size={13} /> Real teams, real outcomes</span>
        <h2 className="lp-section-title">Hear from the field</h2>
      </Reveal>

      <div className="lp-testimonials-grid">
        {TESTIMONIALS.map((t, i) => (
          <Reveal key={t.name} delay={i * 0.09} className="lp-testimonial-card">
            <div className="lp-testimonial-stars">
              {Array.from({ length: t.rating ?? 5 }).map((_, j) => (
                <Star key={j} size={13} fill="currentColor" />
              ))}
            </div>
            <p className="lp-testimonial-quote">"{t.quote}"</p>
            <div className="lp-testimonial-author">
              <div className="lp-testimonial-avatar">{t.name[0]}</div>
              <div>
                <div className="lp-testimonial-name">{t.name}</div>
                <div className="lp-testimonial-role">{t.role} · {t.org}</div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ── Pricing ──────────────────────────────────────────────────────────────── */
const Pricing: React.FC = () => (
  <section id="pricing" className="lp-pricing">
    <div className="lp-container">
      <Reveal className="lp-section-header">
        <span className="lp-section-eyebrow"><IndianRupee size={13} /> Simple pricing</span>
        <h2 className="lp-section-title">Start free. Scale when ready.</h2>
        <p className="lp-section-sub">No hidden fees. No per-module charges. One price for your whole team.</p>
      </Reveal>

      <div className="lp-pricing-grid">
        {/* Starter */}
        <Reveal delay={0} className="lp-pricing-card">
          <div className="lp-pricing-tier">Starter</div>
          <div className="lp-pricing-price">
            <span className="lp-pricing-amount">Free</span>
            <span className="lp-pricing-period">30-day trial</span>
          </div>
          <p className="lp-pricing-desc">Everything you need to evaluate GoodJobs with your real data.</p>
          <ul className="lp-pricing-features">
            {[
              'Up to 50 beneficiaries',
              'All modules included',
              'Agent HQ with 20 AI actions/mo',
              '80G receipt generation',
              'FCRA overhead monitor',
              'WhatsApp outreach (demo)',
              'Email support',
            ].map(f => (
              <li key={f}><Check size={14} />{f}</li>
            ))}
          </ul>
          <Link to="/signup" className="lp-btn-outline-full">Start free trial</Link>
        </Reveal>

        {/* Pro */}
        <Reveal delay={0.08} className="lp-pricing-card lp-pricing-card--pro">
          <div className="lp-pricing-popular">Most popular</div>
          <div className="lp-pricing-tier">Pro</div>
          <div className="lp-pricing-price">
            <span className="lp-pricing-currency">₹</span>
            <span className="lp-pricing-amount">4,999</span>
            <span className="lp-pricing-period">/ month</span>
          </div>
          <p className="lp-pricing-desc">The full platform for growing NGOs with active field teams.</p>
          <ul className="lp-pricing-features">
            {[
              'Unlimited beneficiaries',
              'Unlimited AI actions',
              'Real WhatsApp Business API',
              'DPDP data export',
              'Scheduled auto-exports',
              'CSR pipeline with AI scoring',
              'Priority support + onboarding',
              'Custom 80G receipt templates',
            ].map(f => (
              <li key={f}><Check size={14} />{f}</li>
            ))}
          </ul>
          <Link to="/signup" className="lp-btn-hero-primary" style={{ width: '100%', justifyContent: 'center' }}>
            Start free trial <ArrowRight size={16} />
          </Link>
          <p className="lp-pricing-note">No credit card during trial · Cancel anytime</p>
        </Reveal>

        {/* Enterprise */}
        <Reveal delay={0.14} className="lp-pricing-card">
          <div className="lp-pricing-tier">Enterprise</div>
          <div className="lp-pricing-price">
            <span className="lp-pricing-amount">Custom</span>
          </div>
          <p className="lp-pricing-desc">Multi-chapter NGOs, foundations managing multiple grantees, or government partnerships.</p>
          <ul className="lp-pricing-features">
            {[
              'Multi-NGO management console',
              'Custom AI model fine-tuning',
              'Dedicated WhatsApp number',
              'SSO / SAML integration',
              'On-prem deployment option',
              'SLA-backed 99.9% uptime',
              'Dedicated success manager',
            ].map(f => (
              <li key={f}><Check size={14} />{f}</li>
            ))}
          </ul>
          <a href="mailto:hello@goodjobs.in" className="lp-btn-outline-full">Talk to us</a>
        </Reveal>
      </div>
    </div>
  </section>
);

/* ── Final CTA ────────────────────────────────────────────────────────────── */
const FinalCTA: React.FC = () => (
  <section className="lp-final-cta">
    <div className="lp-final-cta-orb lp-final-cta-orb--1" />
    <div className="lp-final-cta-orb lp-final-cta-orb--2" />
    <div className="lp-container lp-final-cta-inner">
      <Reveal>
        <div className="lp-final-cta-badge"><Wifi size={13} /> Online · Offline · Everywhere</div>
        <h2 className="lp-final-cta-title">
          Your NGO deserves<br />infrastructure this good
        </h2>
        <p className="lp-final-cta-sub">
          Join 50+ organizations already running smarter with GoodJobs.
          Start your 30-day trial today — no card, no commitment.
        </p>
        <div className="lp-final-cta-actions">
          <Link to="/signup" className="lp-btn-hero-primary lp-btn-hero-primary--white">
            Start free trial <ArrowRight size={17} />
          </Link>
          <Link to="/login" className="lp-btn-hero-ghost lp-btn-hero-ghost--light">
            Sign in instead
          </Link>
        </div>
      </Reveal>
    </div>
  </section>
);

/* ── Footer ───────────────────────────────────────────────────────────────── */
const Footer: React.FC = () => (
  <footer className="lp-footer">
    <div className="lp-container">
      <div className="lp-footer-top">
        <div className="lp-footer-brand">
          <div className="lp-footer-logo"><Heart size={16} /> GoodJobs</div>
          <p className="lp-footer-tagline">Infrastructure for social good.<br />Built in India, for India.</p>
          <div className="lp-footer-badge-row">
            <span className="lp-footer-badge"><ShieldCheck size={11} /> FCRA-ready</span>
            <span className="lp-footer-badge"><Lock size={11} /> DPDP compliant</span>
            <span className="lp-footer-badge"><BadgeCheck size={11} /> 80G certified</span>
          </div>
        </div>

        <div className="lp-footer-links-wrap">
          {[
            {
              heading: 'Product',
              links: [['Features','#features'],['Compliance','#compliance'],['Pricing','#pricing'],['Agent HQ','#features'],['Roadmap','#']],
            },
            {
              heading: 'Resources',
              links: [['Documentation','#'],['FCRA Guide','#'],['80G Guide','#'],['DPDP Checklist','#'],['Blog','#']],
            },
            {
              heading: 'Company',
              links: [['About','#'],['Contact','mailto:hello@goodjobs.in'],['Privacy Policy','#'],['Terms of Use','#']],
            },
          ].map(col => (
            <div key={col.heading} className="lp-footer-col">
              <div className="lp-footer-col-heading">{col.heading}</div>
              {col.links.map(([label, href]) => (
                <a key={label} href={href} className="lp-footer-link">{label}</a>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="lp-footer-bottom">
        <span>© 2026 GoodJobs Technologies Pvt Ltd · CIN: U74999MH2024PTC000001</span>
        <span>Made with <Heart size={11} /> in Bengaluru</span>
      </div>
    </div>
  </footer>
);

/* ── Page ─────────────────────────────────────────────────────────────────── */
const Landing: React.FC = () => (
  <div className="lp-root">
    <Nav />
    <Hero />
    <TrustBar />
    <Stats />
    <Features />
    <Compliance />
    <HowItWorks />
    <Testimonials />
    <Pricing />
    <FinalCTA />
    <Footer />
  </div>
);

export default Landing;
