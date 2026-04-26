import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** SPA document navigations — must match React Router paths or offline navigations fall back incorrectly. */
const NAV_FALLBACK_ALLOWLIST = [
  /^\/$/,
  /^\/(login|tasks|fundraising|crm|finance|programs|csr|volunteers|compliance|agent-hq|settings)(\/.*)?$/,
  /^\/give\/[^/]+$/,
];

function apiPathMatcher(segment: string) {
  const base = segment.startsWith('/') ? segment : `/${segment}`;
  return ({ url }: { url: URL }) => {
    const p = url.pathname;
    return p === base || p.startsWith(`${base}/`);
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'GoodJobs — Infrastructure for Social Good',
        short_name: 'GoodJobs',
        description: "The operating system for India's social sector",
        start_url: '/tasks',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f172a',
        theme_color: '#6366f1',
        lang: 'en-IN',
        scope: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        shortcuts: [
          { name: 'Inbox', short_name: 'Inbox', url: '/tasks', description: 'Unified inbox' },
          { name: 'Donate', short_name: 'Donate', url: '/fundraising', description: 'Fundraising' },
          { name: 'Add Donor', short_name: 'Donor', url: '/crm', description: 'Donor CRM' },
        ],
        categories: ['productivity', 'finance', 'utilities'],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [...NAV_FALLBACK_ALLOWLIST],
        runtimeCaching: [
          {
            // Use path-prefix match only — `.includes('/inbox')` also matched `/src/utils/inboxLinks.ts`.
            urlPattern: apiPathMatcher('inbox'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'inbox-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 24, maxAgeSeconds: 3600 },
            },
          },
          {
            urlPattern: apiPathMatcher('morning-brief'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'brief-cache',
              expiration: { maxEntries: 16, maxAgeSeconds: 1800 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/analytics/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'analytics-cache',
              expiration: { maxEntries: 24, maxAgeSeconds: 3600 },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [...NAV_FALLBACK_ALLOWLIST],
      },
    }),
  ],
});
