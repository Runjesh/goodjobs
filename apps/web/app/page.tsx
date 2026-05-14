export default function HomePage() {
  return (
    <>
      <h1>GoodJobs — Next.js</h1>
      <p className="lead">
        This app shares JWT storage keys with the Vite client (<code>access_token</code> /{' '}
        <code>sevasuite_auth</code>) so you can sign in here and call the same FastAPI routes.
        Default API: <code>NEXT_PUBLIC_API_BASE_URL</code> → <code>http://localhost:8000</code>.
      </p>
      <div className="card">
        <strong>Quick start</strong>
        <ol style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem', color: 'var(--muted)' }}>
          <li>Run FastAPI on port 8000.</li>
          <li>Copy <code>.env.example</code> → <code>.env.local</code> if you need a different API URL.</li>
          <li>
            <code>npm install</code> then <code>npm run dev</code> (port 3001).
          </li>
          <li>
            <a href="/login">Login</a> then configure <a href="/settings/ai">OpenAI key</a>.
          </li>
        </ol>
      </div>
    </>
  );
}
