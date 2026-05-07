import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const msg = this.state.error?.message ?? 'Unknown error';
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '2rem',
          gap: '1rem',
          textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#fef2f2', color: '#dc2626',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', maxWidth: 420, lineHeight: 1.6 }}>
              This page ran into an unexpected error. The team has been notified.
            </p>
            {import.meta.env.DEV && (
              <pre style={{
                marginTop: '1rem', padding: '0.75rem 1rem',
                background: '#fef2f2', border: '1px solid #fca5a5',
                borderRadius: 8, fontSize: '0.72rem', color: '#dc2626',
                textAlign: 'left', maxWidth: 560, overflowX: 'auto', whiteSpace: 'pre-wrap',
              }}>
                {msg}
              </pre>
            )}
          </div>
          <button
            onClick={this.reset}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.5rem 1.25rem',
              background: 'var(--color-primary)', color: 'white',
              border: 'none', borderRadius: 8, fontWeight: 600,
              fontSize: '0.875rem', cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
