import { useCallback, useEffect, useRef } from 'react';
import {
  loadGoogleScript,
  getGoogleClientId,
  type GoogleCredentialResponse,
} from '../../lib/googleIdentity';

interface Props {
  onCredential: (c: GoogleCredentialResponse) => void;
  className?: string;
}

/**
 * Renders the official Google Sign-In button via GIS. Requires VITE_GOOGLE_CLIENT_ID.
 */
export function GoogleSignInButton({ onCredential, className }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  const init = useCallback(async () => {
    const clientId = getGoogleClientId();
    if (!clientId) return;
    await loadGoogleScript();
    const el = divRef.current;
    if (!el || !window.google?.accounts?.id) return;
    el.innerHTML = '';
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (resp) => {
        if (resp.credential) cbRef.current(resp);
      },
    });
    window.google.accounts.id.renderButton(el, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      width: Math.min(400, el.offsetWidth || 360),
      shape: 'rectangular',
    });
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  return <div ref={divRef} className={className ?? 'google-signin-slot'} />;
}
