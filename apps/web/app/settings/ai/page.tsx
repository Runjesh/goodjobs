'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getAccessToken, type LlmKeyStatus } from '@/lib/fastapi';

export default function AiSettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<LlmKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/settings/llm');
        if (!res.ok) {
          if (!cancelled) setMsg('Could not load LLM settings (sign in as ED to save keys).');
          return;
        }
        const data = (await res.json()) as LlmKeyStatus;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setMsg('Network error loading settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  async function saveKey() {
    setMsg(null);
    const k = keyInput.trim();
    if (!k.startsWith('sk-') || k.length < 20) {
      setMsg('Paste a valid OpenAI secret key (starts with sk-).');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openai_api_key: k }),
      });
      const errBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (errBody as { detail?: string }).detail;
        setMsg(typeof detail === 'string' ? detail : 'Save failed.');
        return;
      }
      setKeyInput('');
      setStatus(errBody as LlmKeyStatus);
      setMsg('Key saved. Agents and RAG embeddings can use the live model.');
    } catch {
      setMsg('Could not reach API.');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setMsg(null);
    setSaving(true);
    try {
      const res = await apiFetch('/settings/llm', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg('Remove failed.');
        return;
      }
      setStatus(data as LlmKeyStatus);
      setMsg('Organisation key removed.');
    } catch {
      setMsg('Could not reach API.');
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) {
    return (
      <>
        <h1>AI &amp; Agents</h1>
        <p className="lead">Loading…</p>
      </>
    );
  }

  if (!getAccessToken()) {
    return (
      <>
        <h1>AI &amp; Agents</h1>
        <p className="lead">
          <a href="/login">Sign in</a> first (Executive Director role required to save keys).
        </p>
      </>
    );
  }

  return (
    <>
      <h1>AI &amp; Agents</h1>
      <p className="lead">
        OpenAI key for this organisation — same API as Vite <strong>Settings → AI &amp; Agents</strong>.
      </p>

      {loading ? <p className="lead">Loading status…</p> : null}

      {!loading ? (
        <div className="card">
          {status?.configured ? (
            <p>
              <strong>Status:</strong> configured ({status.source}){status.masked ? ` — ${status.masked}` : ''}
            </p>
          ) : (
            <p style={{ color: 'var(--muted)' }}>No OpenAI key configured for this workspace (or only server env).</p>
          )}

          <label htmlFor="apikey">OpenAI API key</label>
          <input
            id="apikey"
            type="password"
            autoComplete="off"
            placeholder="sk-…"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />

          <div className="row">
            <button type="button" onClick={saveKey} disabled={saving}>
              {saving ? 'Saving…' : 'Save key'}
            </button>
            <button type="button" className="danger" onClick={clearKey} disabled={saving || status?.source !== 'organisation'}>
              Remove organisation key
            </button>
          </div>

          {msg ? (
            <p
              className={
                msg.includes('failed') || msg.includes('Could not') || msg.includes('Network')
                  ? 'msg error'
                  : 'msg ok'
              }
              role="status"
            >
              {msg}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
