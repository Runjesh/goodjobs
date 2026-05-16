export type GoogleCredentialResponse = { credential: string; select_by?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (resp: GoogleCredentialResponse) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export function loadGoogleScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-goodjobs-gis]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google script failed')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.dataset.goodjobsGis = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Sign-In'));
    document.head.appendChild(s);
  });
}

export function getGoogleClientId(): string | undefined {
  const id = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  return id || undefined;
}

/** Decode JWT payload from Google ID token (UX only — API verifies). */
export function decodeGoogleCredentialPayload(credential: string): {
  email?: string;
  name?: string;
  email_verified?: boolean;
} | null {
  try {
    const [, payload] = credential.split('.');
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(json) as Record<string, unknown>;
    return {
      email: typeof data.email === 'string' ? data.email : undefined,
      name: typeof data.name === 'string' ? data.name : undefined,
      email_verified: data.email_verified === true,
    };
  } catch {
    return null;
  }
}
