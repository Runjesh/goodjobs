import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GoodJobs (Next)',
  description: 'Nonprofit OS — Next.js shell for FastAPI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          <nav>
            <a href="/">Home</a>
            <a href="/login">Login</a>
            <a href="/settings/ai">AI &amp; Agents</a>
          </nav>
          {children}
        </main>
      </body>
    </html>
  );
}
