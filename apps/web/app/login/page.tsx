'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getApiBaseUrl } from '@/lib/fastapi';

type LoginResponse = {
  access_token: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  ngo_id: string;
  ngo_name: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as LoginResponse & { detail?: string };
      if (!res.ok) {
        setMsg(typeof data.detail === 'string' ? data.detail : 'Login failed.');
        return;
      }
      const role = (data.role || 'ed').toLowerCase();
      const auth = {
        token: data.access_token,
        email: data.email,
        name: data.name,
        ngoName: data.ngo_name,
        ngoId: data.ngo_id,
        id: data.user_id,
        role,
        avatar: '',
      };
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('sevasuite_auth', JSON.stringify(auth));
      router.push('/settings/ai');
    } catch {
      setMsg(`Could not reach API at ${getApiBaseUrl()}.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1>Sign in</h1>
      <p className="lead">Uses FastAPI <code>POST /auth/login</code> (same as Vite).</p>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="password" style={{ marginTop: '1rem' }}>
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="row">
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        {msg ? (
          <p className="msg error" role="alert">
            {msg}
          </p>
        ) : null}
      </form>
    </>
  );
}
