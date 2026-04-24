import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, Heart, IndianRupee, QrCode, CreditCard, Smartphone, X } from 'lucide-react';
import toast from 'react-hot-toast';
import './DonationPage.css';
import { apiFetch } from '../../api/client';

const presets = [500, 1000, 2000, 5000, 10000];
const causes = ['General Fund', 'Education', 'Healthcare', 'Women Empowerment'];

const DonationPage: React.FC = () => {
  const { campaignSlug } = useParams();
  const [amount, setAmount] = useState(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [cause, setCause] = useState(causes[0]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pan, setPan] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [processing, setProcessing] = useState(false);

  const finalAmount = customAmount ? Number(customAmount) : amount;

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) { toast.error('Please fill in your name and email.'); return; }
    setProcessing(true);
    try {
      // For now we simulate payment success, but we DO trigger the backend webhook
      // so agent flows (receipts/nurture) can run in dev.
      await new Promise(r => setTimeout(r, 1200));
      await apiFetch('/webhook/donation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'donation_received',
          donor_id: email,
          donor_name: isAnonymous ? 'Anonymous' : name,
          donation_amount: finalAmount,
          preferred_language: 'English',
        }),
      });
      setStep('success');
    } catch {
      toast.error('Payment recorded, but backend agent trigger failed.');
      setStep('success');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload80G = () => {
    toast.success('80G receipt PDF downloading...', { icon: '📄' });
  };

  if (step === 'success') {
    return (
      <div className="donation-page">
        <div className="donation-success">
          <div className="success-icon">🎉</div>
          <h1>Thank you, {name}!</h1>
          <p>Your donation of <strong>₹{finalAmount.toLocaleString()}</strong> to India NGO Trust has been received.</p>
          <div className="success-details">
            <div className="success-detail-row"><span>Transaction ID</span><span style={{ fontFamily: 'monospace' }}>TRX-{Date.now().toString().slice(-6)}</span></div>
            <div className="success-detail-row"><span>Campaign</span><span>{campaignSlug || 'General Fund'}</span></div>
            <div className="success-detail-row"><span>Fund</span><span>{cause}</span></div>
            <div className="success-detail-row"><span>80G Deduction</span><span style={{ color: 'var(--color-success)', fontWeight: 600 }}>₹{Math.round(finalAmount * 0.5).toLocaleString()} eligible</span></div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleDownload80G}>
            <ShieldCheck size={16} /> Download 80G Certificate
          </button>
          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
            A receipt has been sent to {email}
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
            <div className="donation-ngo-name">India NGO Trust</div>
            <div className="donation-ngo-reg">12A: 2019-20-R-1234 | 80G: AA/12345/2019</div>
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
                <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '1.25rem' }}>₹12,50,000</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>of ₹20,00,000 goal</span>
              </div>
              <div style={{ background: '#e2e8f0', height: 8, borderRadius: 999, overflow: 'hidden', marginTop: '0.5rem' }}>
                <div style={{ width: '62.5%', height: '100%', background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))', borderRadius: 999 }}></div>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>342 donors • 62.5% funded</div>
            </div>
          </div>

          {/* UPI QR */}
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

            {/* Amount presets */}
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

            {/* Cause */}
            <div className="input-group" style={{ marginBottom: '1rem' }}>
              <label className="input-label">Donate Towards</label>
              <select className="input-field" value={cause} onChange={e => setCause(e.target.value)}>
                {causes.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            {/* Donor info */}
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
            <div className="input-group" style={{ marginBottom: '0.5rem' }}>
              <label className="input-label">PAN (for 80G certificate)</label>
              <input type="text" className="input-field" placeholder="ABCDE1234F (optional)" value={pan} onChange={e => setPan(e.target.value.toUpperCase())} maxLength={10} />
            </div>
            <div className="flex items-center gap-2" style={{ marginBottom: '1.5rem' }}>
              <input type="checkbox" id="anon" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} />
              <label htmlFor="anon" style={{ fontSize: '0.875rem' }}>Donate anonymously</label>
            </div>

            {/* Payment Method */}
            <div className="amount-label">Payment Method</div>
            <div className="payment-methods">
              {[{ id: 'upi', label: 'UPI', icon: <Smartphone size={18} /> }, { id: 'card', label: 'Card', icon: <CreditCard size={18} /> }, { id: 'netbanking', label: 'Net Banking', icon: <IndianRupee size={18} /> }].map(m => (
                <button key={m.id} type="button"
                  className={`payment-method-btn ${payMethod === m.id ? 'active' : ''}`}
                  onClick={() => setPayMethod(m.id as any)}>
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

export default DonationPage;
