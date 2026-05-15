import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, Heart, IndianRupee, QrCode, CreditCard, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import './DonationPage.css';
import { useStore } from '../../store/useStore';
import DonationCompletionDrawer from '../../components/Donor/DonationCompletionDrawer';
import type { DonationCompletionSnapshot } from '../../utils/donationCompletion';
import { finishDonationWorkflow, handleDonationThanked } from '../../utils/donationWorkflow';

const presets = [500, 1000, 2000, 5000, 10000];
const causes = ['General Fund', 'Education', 'Healthcare', 'Women Empowerment'];

const DonationPage: React.FC = () => {
  const { campaignSlug } = useParams();
  const { ngoDetails, complianceDocs } = useStore();
  const eightyGRegNo = complianceDocs.find(d => /80g/i.test(d.type || d.name || ''))?.registration_number ?? '';

  const [amount, setAmount] = useState(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [cause, setCause] = useState(causes[0]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pan, setPan] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [pincode, setPincode] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [message, setMessage] = useState('');
  const [consentImpact, setConsentImpact] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [processing, setProcessing] = useState(false);
  const [completion, setCompletion] = useState<DonationCompletionSnapshot | null>(null);
  const [ngoName, setNgoName] = useState<string>('GoodJobs NGO');

  const finalAmount = customAmount ? Number(customAmount) : amount;

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAnonymous && (!name || !email)) { toast.error('Please fill in your name and email.'); return; }
    setProcessing(true);
    try {
      const snap = await finishDonationWorkflow({
        source: 'public',
        donorName: isAnonymous ? 'Anonymous' : name.trim(),
        donorEmail: isAnonymous ? undefined : email,
        donorPhone: isAnonymous ? undefined : phone,
        donorPan: pan || undefined,
        amount: finalAmount,
        method: payMethod === 'upi' ? 'UPI' : payMethod === 'card' ? 'Card' : 'NetBanking',
        campaignSlug: campaignSlug || null,
        cause,
        campaignTitle: cause,
        description: message || cause,
        isAnonymous,
        addressLine1: isAnonymous ? null : addressLine1 || null,
        city: isAnonymous ? null : city || null,
        state: isAnonymous ? null : stateField || null,
        pincode: isAnonymous ? null : pincode || null,
        companyName: isAnonymous ? null : companyName || null,
        message: message || null,
        consentImpact,
      });
      setNgoName(useStore.getState().ngoDetails.name || 'GoodJobs NGO');
      setCompletion(snap);
      setStep('success');
    } catch {
      toast.error('Failed to record donation.');
    } finally {
      setProcessing(false);
    }
  };

  if (step === 'success') {
    const thanksName = isAnonymous ? 'Friend' : name.trim() || 'there';
    return (
      <div className="donation-page">
        <div className="donation-success">
          <div className="success-icon">🎉</div>
          <h1>Thank you, {thanksName}!</h1>
          <p>Your donation of <strong>₹{finalAmount.toLocaleString()}</strong> to {ngoName} has been recorded.</p>
          {completion && (
            <DonationCompletionDrawer
              variant="inline"
              snapshot={completion}
              donorPan={pan}
              ngoName={ngoName || ngoDetails.name || 'GoodJobs NGO'}
              ngoPan={ngoDetails.pan || ''}
              eightyGRegNo={eightyGRegNo}
              onActions={{
                onClose: () => setCompletion(null),
                onSnapshotChange: setCompletion,
                onMarkThanked: () => handleDonationThanked(completion),
              }}
            />
          )}
          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
            {isAnonymous
              ? 'Anonymous gifts are receipted per NGO policy — contact the organisation if you need documentation.'
              : `Receipt and updates will use ${email}${phone ? ` and ${phone}` : ''}.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="donation-page">
      <div className="donation-header">
        <div className="donation-ngo-brand">
          <div className="donation-logo">GJ</div>
          <div>
            <div className="donation-ngo-name">GoodJobs</div>
            <div className="donation-ngo-reg">Infrastructure for Social Good</div>
          </div>
        </div>
        <div className="donation-verified-badge">
          <ShieldCheck size={14} /> GiveIndia Verified
        </div>
      </div>

      <div className="donation-body">
        <div className="donation-left">
          <div className="donation-campaign-card">
            <div className="campaign-banner" style={{ background: 'linear-gradient(135deg, #a855f7, #ec4899)', height: 160, borderRadius: 12, marginBottom: '1rem', display: 'flex', alignItems: 'flex-end', padding: '1rem' }}>
              <span className="badge" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>ACTIVE CAMPAIGN</span>
            </div>
            <h2 style={{ fontSize: '1.375rem', marginBottom: '0.5rem' }}>
              {campaignSlug?.replace(/-/g, ' ') || 'Digital Literacy for Rural Girls'}
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Your donation will directly fund digital education for underprivileged girls in rural Maharashtra, Rajasthan, and Bihar.
            </p>
            <div className="donation-progress-section">
              <div className="dp-stats">
                <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '1.25rem' }}>—</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Campaign stats not configured</span>
              </div>
              <div style={{ background: '#e2e8f0', height: 8, borderRadius: 999, overflow: 'hidden', marginTop: '0.5rem' }}>
                <div style={{ width: '0%', height: '100%', background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))', borderRadius: 999 }} />
              </div>
            </div>
          </div>

          <div className="upi-qr-box">
            <QrCode size={64} color="var(--color-primary)" />
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Scan to Pay via UPI</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>Works with PhonePe, GPay, Paytm, BHIM</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--color-primary)', marginTop: '0.25rem' }}>indiangotrust@sbi</div>
            </div>
          </div>
        </div>

        <div className="donation-right">
          <form onSubmit={handleDonate}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Make a Donation</h3>

            <div className="amount-label">Select Amount</div>
            <div className="amount-presets">
              {presets.map(p => (
                <button key={p} type="button"
                  className={`amount-preset ${!customAmount && amount === p ? 'active' : ''}`}
                  onClick={() => { setAmount(p); setCustomAmount(''); }}>
                  ₹{p.toLocaleString()}
                </button>
              ))}
            </div>
            <input
              type="number"
              className="input-field"
              placeholder="Enter custom amount (₹)"
              value={customAmount}
              onChange={e => setCustomAmount(e.target.value)}
              style={{ marginTop: '0.75rem', marginBottom: '1.5rem' }}
            />

            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Donate Towards</label>
              <select className="input-field" value={cause} onChange={e => setCause(e.target.value)}>
                {causes.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Full Name</label>
                <input required={!isAnonymous} type="text" className="input-field" placeholder="Ravi Kumar" value={name} onChange={e => setName(e.target.value)} disabled={isAnonymous} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Email</label>
                <input required={!isAnonymous} type="email" className="input-field" placeholder="ravi@email.com" value={email} onChange={e => setEmail(e.target.value)} disabled={isAnonymous} />
              </div>
            </div>
            <div className="input-group" style={{ marginBottom: '0.75rem' }}>
              <label className="input-label">Mobile (for payment / receipt SMS)</label>
              <input type="tel" className="input-field" placeholder="+91 …" value={phone} onChange={e => setPhone(e.target.value)} disabled={isAnonymous} />
            </div>
            <div className="input-group" style={{ marginBottom: '0.5rem' }}>
              <label className="input-label">PAN (for 80G certificate)</label>
              <input type="text" className="input-field" placeholder="ABCDE1234F (optional)" value={pan} onChange={e => setPan(e.target.value.toUpperCase())} maxLength={10} disabled={isAnonymous} />
            </div>
            <div className="input-group" style={{ marginBottom: '0.75rem' }}>
              <label className="input-label">Donating as a company? (optional)</label>
              <input type="text" className="input-field" placeholder="Legal name as on PAN / invoice" value={companyName} onChange={e => setCompanyName(e.target.value)} disabled={isAnonymous} />
            </div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
              Postal address (recommended for 80G receipt)
            </div>
            <div className="input-group" style={{ marginBottom: '0.75rem' }}>
              <label className="input-label">Address line</label>
              <input type="text" className="input-field" placeholder="Flat / street" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} disabled={isAnonymous} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">City</label>
                <input type="text" className="input-field" value={city} onChange={e => setCity(e.target.value)} disabled={isAnonymous} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">State</label>
                <input type="text" className="input-field" value={stateField} onChange={e => setStateField(e.target.value)} disabled={isAnonymous} />
              </div>
            </div>
            <div className="input-group" style={{ marginBottom: '0.75rem' }}>
              <label className="input-label">PIN code</label>
              <input type="text" className="input-field" placeholder="6 digits" value={pincode} onChange={e => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={isAnonymous} />
            </div>
            <div className="input-group" style={{ marginBottom: '0.75rem' }}>
              <label className="input-label">Message to the NGO (optional)</label>
              <textarea className="input-field" rows={2} placeholder="In memory of… / please use for…" value={message} onChange={e => setMessage(e.target.value)} />
            </div>
            <div className="flex items-center gap-2" style={{ marginBottom: '1rem' }}>
              <input type="checkbox" id="impact" checked={consentImpact} onChange={e => setConsentImpact(e.target.checked)} disabled={isAnonymous} />
              <label htmlFor="impact" style={{ fontSize: '0.875rem' }}>Send occasional impact updates (email)</label>
            </div>
            <div className="flex items-center gap-2" style={{ marginBottom: '1.5rem' }}>
              <input type="checkbox" id="anon" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} />
              <label htmlFor="anon" style={{ fontSize: '0.875rem' }}>Donate anonymously</label>
            </div>

            <div className="amount-label">Payment Method</div>
            <div className="payment-methods">
              {[{ id: 'upi', label: 'UPI', icon: <Smartphone size={18} /> }, { id: 'card', label: 'Card', icon: <CreditCard size={18} /> }, { id: 'netbanking', label: 'Net Banking', icon: <IndianRupee size={18} /> }].map(m => (
                <button key={m.id} type="button"
                  className={`payment-method-btn ${payMethod === m.id ? 'active' : ''}`}
                  onClick={() => setPayMethod(m.id as 'upi' | 'card' | 'netbanking')}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>

            <button type="submit" className="btn btn-primary donate-submit" disabled={processing}>
              {processing ? (
                <span className="auth-spinner" />
              ) : (
                <><Heart size={18} fill="white" /> Donate ₹{finalAmount.toLocaleString()}</>
              )}
            </button>

            <div className="donation-trust-row">
              <ShieldCheck size={14} color="var(--color-success)" />
              <span>256-bit SSL encrypted. PCI DSS compliant. Razorpay powered.</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

function div({ className, children, style }: { className?: string; children?: React.ReactNode; style?: React.CSSProperties }) {
  return <div className={className} style={style}>{children}</div>;
}

export default DonationPage;
