import React, { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import Layout from './components/Layout/Layout';
import PageLoading from './components/ui/PageLoading';
import { Toaster } from 'react-hot-toast';

const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Tasks = lazy(() => import('./pages/Tasks/Tasks'));
const Fundraising = lazy(() => import('./pages/Fundraising/Fundraising'));
const CRM = lazy(() => import('./pages/CRM/CRM'));
const Compliance = lazy(() => import('./pages/Compliance/Compliance'));
const Finance = lazy(() => import('./pages/Finance/Finance'));
const CSR = lazy(() => import('./pages/CSR/CSR'));
const Programs = lazy(() => import('./pages/Programs/Programs'));
const Volunteers = lazy(() => import('./pages/Volunteers/Volunteers'));
const AgentHQ = lazy(() => import('./pages/AgentHQ/AgentHQ'));
const Login = lazy(() => import('./pages/Auth/Login'));
const DonationPage = lazy(() => import('./pages/DonationPage/DonationPage'));
const Settings = lazy(() => import('./pages/Settings/Settings'));

function App() {
  return (
    <AuthProvider>
      <Toaster
        position="top-center"
        containerStyle={{ top: 'calc(var(--header-height) + 8px)' }}
        toastOptions={{
          duration: 4000,
          style: {
            fontSize: '0.875rem',
            fontWeight: 500,
            background: 'var(--color-bg-elevated)',
            color: 'var(--color-text-primary)',
            border: '1px solid color-mix(in srgb, var(--color-border) 80%, transparent)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-lg)',
            padding: '0.75rem 1.125rem',
            maxWidth: 'min(28rem, calc(100vw - 2rem))',
          },
          success: {
            iconTheme: { primary: 'var(--color-success)', secondary: 'var(--color-bg-card)' },
          },
          error: {
            iconTheme: { primary: 'var(--color-danger)', secondary: 'var(--color-bg-card)' },
          },
        }}
      />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/give/:campaignSlug" element={<DonationPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<ProtectedRoute module="tasks"><Tasks /></ProtectedRoute>} />
            <Route path="agent-hq" element={<ProtectedRoute module="agent-hq"><AgentHQ /></ProtectedRoute>} />
            <Route path="fundraising" element={<ProtectedRoute module="fundraising"><Fundraising /></ProtectedRoute>} />
            <Route path="crm" element={<ProtectedRoute module="crm"><CRM /></ProtectedRoute>} />
            <Route path="finance" element={<ProtectedRoute module="finance"><Finance /></ProtectedRoute>} />
            <Route path="programs" element={<ProtectedRoute module="programs"><Programs /></ProtectedRoute>} />
            <Route path="csr" element={<ProtectedRoute module="csr"><CSR /></ProtectedRoute>} />
            <Route path="volunteers" element={<ProtectedRoute module="volunteers"><Volunteers /></ProtectedRoute>} />
            <Route path="compliance" element={<ProtectedRoute module="compliance"><Compliance /></ProtectedRoute>} />
            <Route path="settings" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

export default App;
