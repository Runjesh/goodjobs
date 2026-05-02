import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, CheckCircle2, Clock } from 'lucide-react';
import type { WizardData } from '../../../utils/wizard';

type Value = NonNullable<WizardData['connectWhatsapp']>;

interface Props {
  value: WizardData['connectWhatsapp'];
  onChange: (next: Value) => void;
  setComplete: (b: boolean) => void;
}

const PHONE_RE = /^\+?\d[\d\s-]{6,}\d$/;
const MOCK_OTP = '424242';

const WhatsAppStep: React.FC<Props> = ({ value, onChange, setComplete }) => {
  const v: Value = value ?? {};
  const [stage, setStage] = useState<'enter' | 'code' | 'done'>(v.verified ? 'done' : 'enter');
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  const phoneValid = PHONE_RE.test((v.phone ?? '').trim());

  // Step complete only when WhatsApp is verified.
  useEffect(() => {
    setComplete(stage === 'done' && !!v.verified);
  }, [stage, v.verified, setComplete]);

  const sendCode = () => {
    if (!phoneValid) {
      setError('Enter a valid phone number with country code (e.g. +91 98200 12345).');
      return;
    }
    setError(null);
    setStage('code');
    setTimeout(() => codeRefs.current[0]?.focus(), 50);
  };

  const handleCodeChange = (i: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...code];
    next[i] = val;
    setCode(next);
    if (val && i < 5) codeRefs.current[i + 1]?.focus();
    if (next.every((d) => d.length === 1)) {
      const joined = next.join('');
      if (joined === MOCK_OTP) {
        onChange({ ...v, verified: true });
        setStage('done');
        setError(null);
      } else {
        setError(`Wrong code — for this demo, the code is ${MOCK_OTP}.`);
      }
    }
  };

  const handleCodeKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) codeRefs.current[i - 1]?.focus();
  };

  const reset = () => {
    onChange({ ...v, verified: false });
    setCode(['', '', '', '', '', '']);
    setStage('enter');
  };

  return (
    <>
      <p style={{ marginTop: '-0.5rem', color: 'var(--color-text-secondary)', fontSize: '0.92rem' }}>
        Connect a WhatsApp number so field staff can log services by simply messaging.
        Your AI Copilot extracts beneficiary, service type, date and outcome from each note.
      </p>

      <div>
        <label className="wizard-field-label" htmlFor="wa-phone">WhatsApp Business number</label>
        <input
          id="wa-phone"
          className="wizard-input"
          placeholder="+91 98200 12345"
          value={v.phone ?? ''}
          onChange={(e) => {
            onChange({ ...v, phone: e.target.value, verified: false });
            if (stage !== 'enter') setStage('enter');
          }}
          disabled={stage === 'done'}
        />
        <div className="wizard-field-hint">Must be a number registered for WhatsApp Business.</div>
      </div>

      {stage === 'enter' && (
        <button type="button" className="wizard-btn wizard-btn-primary" onClick={sendCode} style={{ width: 'max-content' }}>
          <MessageCircle size={14} /> Send verification code
        </button>
      )}

      {stage === 'code' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>
            We sent a 6-digit code to <strong>{v.phone}</strong>.
            <span className="wizard-wa-status pending" style={{ marginLeft: '0.5rem' }}>
              <Clock size={12} /> Mock code: <strong>{MOCK_OTP}</strong>
            </span>
          </div>
          <div className="wizard-wa-codebox">
            {code.map((d, i) => (
              <input
                key={i}
                ref={(el) => { codeRefs.current[i] = el; }}
                className="wizard-wa-codeinput"
                value={d}
                onChange={(e) => handleCodeChange(i, e.target.value)}
                onKeyDown={(e) => handleCodeKey(i, e)}
                inputMode="numeric"
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
              />
            ))}
          </div>
          {error && <div style={{ color: '#DC2626', fontSize: '0.82rem' }}>{error}</div>}
          <button type="button" className="wizard-btn wizard-btn-ghost" style={{ width: 'max-content', padding: 0 }} onClick={reset}>
            ← Use a different number
          </button>
        </div>
      )}

      {stage === 'done' && (
        <div className="wizard-wa-status ok">
          <CheckCircle2 size={14} /> Verified — your team can start logging via WhatsApp.
        </div>
      )}

      {error && stage === 'enter' && (
        <div style={{ color: '#DC2626', fontSize: '0.82rem' }}>{error}</div>
      )}
    </>
  );
};

export default WhatsAppStep;
