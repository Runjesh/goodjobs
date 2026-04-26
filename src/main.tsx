import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

/** Dev-only: visit any URL with `?unregister-sw=1` to drop Workbox registrations and caches, then reload (no manual DevTools step). */
async function unregisterServiceWorkersAndCaches(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}

function mountApp(): void {
  registerSW({ immediate: true });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('unregister-sw') === '1') {
  void unregisterServiceWorkersAndCaches().then(() => {
    const u = new URL(window.location.href);
    u.searchParams.delete('unregister-sw');
    window.location.replace(u.pathname + u.search + u.hash);
  });
} else {
  mountApp();
}
