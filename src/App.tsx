import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import Layout from './components/Layout/Layout';
import Dashboard from './pages/Dashboard/Dashboard';
import Tasks from './pages/Tasks/Tasks';
import Fundraising from './pages/Fundraising/Fundraising';
import CRM from './pages/CRM/CRM';
import Compliance from './pages/Compliance/Compliance';
import Finance from './pages/Finance/Finance';
import CSR from './pages/CSR/CSR';
import Programs from './pages/Programs/Programs';
import Volunteers from './pages/Volunteers/Volunteers';
import AgentHQ from './pages/AgentHQ/AgentHQ';
import Login from './pages/Auth/Login';
import DonationPage from './pages/DonationPage/DonationPage';
import Settings from './pages/Settings/Settings';
import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-center" toastOptions={{ duration: 4000, style: { fontSize: '0.875rem' } }} />
      <Routes>
        {/* Public routes — no auth required */}
        <Route path="/login" element={<Login />} />
        <Route path="/give/:campaignSlug" element={<DonationPage />} />

        {/* Protected app routes — inside Layout shell */}
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<Dashboard />} />
          <Route path="tasks"       element={<ProtectedRoute module="tasks"><Tasks /></ProtectedRoute>} />
          <Route path="agent-hq"    element={<ProtectedRoute module="agent-hq"><AgentHQ /></ProtectedRoute>} />
          <Route path="fundraising" element={<ProtectedRoute module="fundraising"><Fundraising /></ProtectedRoute>} />
          <Route path="crm"         element={<ProtectedRoute module="crm"><CRM /></ProtectedRoute>} />
          <Route path="finance"     element={<ProtectedRoute module="finance"><Finance /></ProtectedRoute>} />
          <Route path="programs"    element={<ProtectedRoute module="programs"><Programs /></ProtectedRoute>} />
          <Route path="csr"         element={<ProtectedRoute module="csr"><CSR /></ProtectedRoute>} />
          <Route path="volunteers"  element={<ProtectedRoute module="volunteers"><Volunteers /></ProtectedRoute>} />
          <Route path="compliance"  element={<ProtectedRoute module="compliance"><Compliance /></ProtectedRoute>} />
          <Route path="settings"    element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

export default App;
