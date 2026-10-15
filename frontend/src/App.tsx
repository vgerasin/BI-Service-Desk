import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import PageTitleManager from './components/PageTitleManager';
import LoginPage from './pages/LoginPage';
import RequestsPage from './pages/RequestsPage';
import RequestDetailPage from './pages/RequestDetailPage';
import TimeEntriesPage from './pages/TimeEntriesPage';
import AnalyticsPage from './pages/AnalyticsPage';
import TeamPage from './pages/admin/TeamPage';
import CatalogPage from './pages/admin/CatalogPage';
import SystemPage from './pages/admin/SystemPage';
import ReportDetailPage from './pages/admin/ReportDetailPage';
import ActsPage from './pages/admin/ActsPage';
import PortalRequestsPage from './pages/portal/PortalRequestsPage';
import ContractorActPage from './pages/ContractorActPage';
import ProfilePage from './pages/ProfilePage';
import SurveyPage from './pages/SurveyPage';
import HelpPage from './pages/HelpPage';
import ChangelogPage from './pages/ChangelogPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
import { UserRole } from './types';
import { useAuth } from './contexts/AuthContext';

function IndexRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.role === UserRole.CUSTOMER ? '/portal' : '/requests'} replace />;
}

dayjs.locale('ru');

export default function App() {
  return (
    <ConfigProvider
      locale={ruRU}
      theme={{
        token: {
          colorPrimary: '#007AFF',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <PageTitleManager />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<SsoCallbackPage />} />
            <Route path="/survey/:token" element={<SurveyPage />} />
            <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<IndexRedirect />} />
              {/* Portal routes for customer role */}
              <Route path="portal" element={<PortalRequestsPage />} />
              <Route path="portal/new" element={<Navigate to="/portal" replace />} />
              <Route path="portal/requests/:id" element={<RequestDetailPage />} />
              <Route path="dashboard" element={<Navigate to="/analytics" replace />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="requests/:id" element={<RequestDetailPage />} />
              <Route path="time-entries" element={<TimeEntriesPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="act" element={<ContractorActPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="help" element={<HelpPage />} />
              <Route path="changelog" element={<ChangelogPage />} />
              {/* Admin area: three hubs instead of eleven separate pages */}
              <Route path="admin/team" element={<TeamPage />} />
              <Route path="admin/catalog" element={<CatalogPage />} />
              <Route path="admin/reports-ref/:id" element={<ReportDetailPage />} />
              <Route path="admin/system" element={
                <ProtectedRoute roles={[UserRole.ADMIN]}><SystemPage /></ProtectedRoute>
              } />
              <Route path="admin/acts" element={
                <ProtectedRoute roles={[UserRole.ADMIN]}><ActsPage /></ProtectedRoute>
              } />
              {/* Old URLs keep working */}
              <Route path="admin/users" element={<Navigate to="/admin/team" replace />} />
              <Route path="admin/contractors" element={<Navigate to="/admin/team?tab=contractors" replace />} />
              <Route path="admin/customers" element={<Navigate to="/admin/team?tab=customers" replace />} />
              <Route path="admin/employees" element={<Navigate to="/admin/team?tab=employees" replace />} />
              <Route path="admin/reports-ref" element={<Navigate to="/admin/catalog" replace />} />
              <Route path="admin/data-sources" element={<Navigate to="/admin/catalog?tab=sources" replace />} />
              <Route path="admin/lineage" element={<Navigate to="/admin/catalog?tab=lineage" replace />} />
              <Route path="admin/known-errors" element={<Navigate to="/admin/catalog?tab=errors" replace />} />
              <Route path="admin/settings" element={<Navigate to="/admin/system" replace />} />
              <Route path="admin/dictionaries" element={<Navigate to="/admin/system?tab=dictionaries" replace />} />
              <Route path="admin/activity-logs" element={<Navigate to="/admin/system?tab=activity" replace />} />
              <Route path="admin/backup" element={<Navigate to="/admin/system?tab=backup" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}
