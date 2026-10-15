import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout, Avatar, Dropdown, Space, Button, Tag, Alert, Tooltip } from 'antd';
import {
  FileTextOutlined, DashboardOutlined, ClockCircleOutlined,
  BarChartOutlined, TeamOutlined, UserOutlined,
  ProjectOutlined, UnorderedListOutlined, LogoutOutlined,
  DownOutlined, CloudDownloadOutlined, SettingOutlined,
  DatabaseOutlined, ApartmentOutlined, QuestionCircleOutlined,
  EyeOutlined, ArrowLeftOutlined, BugOutlined, AuditOutlined, FileWordOutlined, IdcardOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { UserRole, ROLE_LABELS } from '../types';
import NotificationBell from './NotificationBell';
import TelegramLinkPrompt from './TelegramLinkPrompt';
import api from '../api/client';
import { CURRENT_VERSION } from '../changelog';
import { shortFullName } from '../utils/formatName';
import BrandMark from './BrandMark';

const { Header, Content } = Layout;

const headerIconBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(120,120,128,0.08)',
};

// Build time is stamped into the bundle by vite.config.ts's `define` — an always-accurate
// "when was this actually built" signal, shown in the tooltip rather than a hand-maintained date.
function VersionBadge({ onClick }: { onClick: () => void }) {
  const buildTime = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : undefined;
  return (
    <Tooltip title={buildTime ? `История изменений · сборка от ${new Date(buildTime).toLocaleString('ru-RU')}` : 'История изменений'}>
      <Tag
        onClick={onClick}
        style={{
          cursor: 'pointer', margin: 0, marginRight: 8, fontSize: 11,
          color: '#666', background: 'rgba(120,120,128,0.08)', border: 'none',
          borderRadius: 8, padding: '4px 9px', lineHeight: '18px',
        }}
      >
        v{CURRENT_VERSION}
      </Tag>
    </Tooltip>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isCustomer = user?.role === UserRole.CUSTOMER;
  const isExecutor = user?.role === UserRole.EXECUTOR;
  const isAdmin = user?.role === UserRole.ADMIN;

  type ViewMode = 'admin' | 'executor' | 'portal';
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (sessionStorage.getItem('bi_view_mode') as ViewMode) || 'admin',
  );

  const switchToView = (mode: ViewMode) => {
    sessionStorage.setItem('bi_view_mode', mode);
    setViewMode(mode);
    navigate(mode === 'portal' ? '/portal' : '/requests');
  };

  const returnToAdmin = () => switchToView('admin');

  // Admin-only extras (Дашборд, Аналитика, Справочники) are shown only in the real admin view
  const effectiveIsAdmin = isAdmin && viewMode === 'admin';

  // Contractor logins are regular executor accounts linked by email (see ContractorsService).
  // A subordinate (users.managerId set) gets none back — no act access even for themselves,
  // their team lead generates it. Only a lead's own + direct reports' contractors come back.
  const { data: myTeam = [] } = useQuery({
    queryKey: ['my-team'],
    queryFn: () => api.get('/acts/my-team').then(r => r.data),
    enabled: isExecutor,
  });

  const initials = user?.fullName
    ? user.fullName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const isActive = (key: string) =>
    location.pathname === key || location.pathname.startsWith(key + '/');
  const isAdminActive = location.pathname.startsWith('/admin') && !location.pathname.startsWith('/admin/acts');

  const navItems = [
    { key: '/requests', icon: <FileTextOutlined />, label: 'Заявки' },
    { key: '/time-entries', icon: <ClockCircleOutlined />, label: 'Трудозатраты' },
    effectiveIsAdmin && { key: '/analytics', icon: <BarChartOutlined />, label: 'Аналитика' },
    effectiveIsAdmin && { key: '/admin/acts', icon: <FileWordOutlined />, label: 'Акты' },
    // Contractor logins with a non-empty team (self, or self + direct reports for a lead) see
    // it; an admin in "preview as executor" mode also sees it (picking someone to preview).
    ((myTeam.length > 0) || (isAdmin && viewMode === 'executor'))
      && { key: '/act', icon: <FileWordOutlined />, label: 'Акт' },
  ].filter(Boolean) as { key: string; icon: React.ReactNode; label: string }[];

  // Everything that used to be eleven separate pages now lives in three tabbed ones.
  const adminItems = [
    { key: '/admin/team', label: 'Команда и заказчики', icon: <TeamOutlined /> },
    { key: '/admin/catalog', label: 'Каталог данных', icon: <DatabaseOutlined /> },
    { key: '/admin/system', label: 'Система', icon: <SettingOutlined /> },
  ] as { key: string; label: string; icon: React.ReactNode }[];

  const userMenuItems = [
    { key: 'profile', icon: <SettingOutlined />, label: 'Профиль' },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Выйти', danger: true },
  ];

  // ── Portal layout for customers OR admin portal-preview mode ────────────
  if (isCustomer || viewMode === 'portal') {
    return (
      <Layout style={{ minHeight: '100vh', background: '#eef1f6' }}>
        {/* Only for a real customer session — an admin previewing the portal would otherwise
            see a prompt reflecting their own (admin) Telegram link status, not the customer's. */}
        {isCustomer && <TelegramLinkPrompt />}
        {/* Preview banner for admins */}
        {isAdmin && viewMode === 'portal' && (
          <Alert
            message={
              <span>
                <EyeOutlined style={{ marginRight: 6 }} />
                Режим просмотра: <strong>Кабинет заявителя</strong> — так видит интерфейс пользователь-заказчик
              </span>
            }
            type="warning"
            action={
              <Button size="small" icon={<ArrowLeftOutlined />} onClick={returnToAdmin}>
                Вернуться в панель
              </Button>
            }
            style={{ borderRadius: 0, padding: '6px 24px' }}
            banner
          />
        )}
        <Header style={{
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          padding: '0 24px', height: 56,
          display: 'flex', alignItems: 'center', gap: 0,
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 8px 24px -14px rgba(16,24,40,.16)',
          position: 'sticky', top: 0, zIndex: 100, lineHeight: 'normal',
        }}>
          <div
            onClick={() => navigate('/portal')}
            style={{ display: 'flex', alignItems: 'center', gap: 14, marginRight: 24, cursor: 'pointer', flexShrink: 0 }}
          >
            <BrandMark subtitle="Портал заявок" />
          </div>

          <div style={{ flex: 1 }} />

          <VersionBadge onClick={() => navigate('/changelog')} />
          <Button
            type="text"
            icon={<QuestionCircleOutlined style={{ fontSize: 18, color: '#666' }} />}
            onClick={() => navigate('/help')}
            style={{ ...headerIconBtnStyle, marginRight: 8 }}
            title="Справка"
          />
          <Dropdown menu={{
            items: [
              { key: 'logout', icon: <LogoutOutlined />, label: 'Выйти', danger: true },
            ],
            onClick: ({ key }) => { if (key === 'logout') logout(); },
          }}>
            <Space style={{
              cursor: 'pointer', flexShrink: 0, padding: '5px 12px 5px 6px',
              borderRadius: 12, background: 'rgba(0,0,0,0.035)',
            }}>
              <div style={{ textAlign: 'right', lineHeight: 1.35 }}>
                <div title={user?.fullName} style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{shortFullName(user?.fullName)}</div>
                <Tag color={viewMode === 'portal' && isAdmin ? 'orange' : 'blue'} style={{ fontSize: 10, margin: 0, lineHeight: '16px' }}>
                  {viewMode === 'portal' && isAdmin ? 'Просмотр как заявитель' : 'Портал заказчика'}
                </Tag>
              </div>
              <Avatar size={32} style={{
                background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)', fontSize: 12, fontWeight: 700,
                border: '2px solid rgba(255,255,255,0.9)', boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
              }}>
                {user?.fullName?.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() || '?'}
              </Avatar>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24 }}><Outlet /></Content>
      </Layout>
    );
  }

  // ── Internal staff layout (executor cabinet, or admin cabinet) ──────────
  return (
    <Layout style={{ minHeight: '100vh', background: '#eef1f6' }}>
      <TelegramLinkPrompt />
      {/* Preview banner when an admin is previewing the executor cabinet */}
      {isAdmin && viewMode === 'executor' && (
        <Alert
          message={
            <span>
              <EyeOutlined style={{ marginRight: 6 }} />
              Режим просмотра: <strong>Кабинет исполнителя</strong> — так видит интерфейс сотрудник-исполнитель
            </span>
          }
          type="warning"
          action={
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={returnToAdmin}>
              Вернуться в панель
            </Button>
          }
          style={{ borderRadius: 0, padding: '6px 24px' }}
          banner
        />
      )}
      <Header style={{
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 8px 24px -14px rgba(16,24,40,.16)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        lineHeight: 'normal',
      }}>
        {/* Logo + System Name */}
        <div
          onClick={() => navigate('/requests')}
          style={{ display: 'flex', alignItems: 'center', gap: 14, marginRight: 24, cursor: 'pointer', flexShrink: 0 }}
        >
          <BrandMark />
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
          {navItems.map(item => (
            <Button
              key={item.key}
              type={isActive(item.key) ? 'primary' : 'text'}
              icon={item.icon}
              onClick={() => navigate(item.key)}
              style={{
                borderRadius: 10,
                fontWeight: isActive(item.key) ? 600 : 400,
                color: isActive(item.key) ? '#fff' : '#555',
                fontSize: 13,
                height: 34,
                padding: '0 13px',
                background: isActive(item.key) ? 'linear-gradient(180deg, #3AA0FF 0%, #007AFF 55%, #0064D6 100%)' : undefined,
                borderColor: isActive(item.key) ? 'transparent' : undefined,
                boxShadow: isActive(item.key) ? '0 1px 2px rgba(0,0,0,0.12), 0 4px 10px rgba(0,122,255,0.28)' : undefined,
              }}
            >
              {item.label}
            </Button>
          ))}

          {(effectiveIsAdmin) && (
            <Dropdown
              menu={{
                items: adminItems.map(i => ({
                  key: i.key,
                  label: i.label,
                  icon: i.icon,
                  onClick: () => navigate(i.key),
                })),
              }}
              trigger={['click']}
            >
              <Button
                type={isAdminActive ? 'primary' : 'text'}
                icon={<TeamOutlined />}
                style={{
                  borderRadius: 10,
                  fontWeight: isAdminActive ? 600 : 400,
                  color: isAdminActive ? '#fff' : '#555',
                  fontSize: 13,
                  height: 34,
                  padding: '0 13px',
                  background: isAdminActive ? 'linear-gradient(180deg, #3AA0FF 0%, #007AFF 55%, #0064D6 100%)' : undefined,
                  borderColor: isAdminActive ? 'transparent' : undefined,
                  boxShadow: isAdminActive ? '0 1px 2px rgba(0,0,0,0.12), 0 4px 10px rgba(0,122,255,0.28)' : undefined,
                }}
              >
                Управление <DownOutlined style={{ fontSize: 10, marginLeft: 2 }} />
              </Button>
            </Dropdown>
          )}
        </div>

        {/* Right side: notifications, view-as, help, user — one consistent glass toolbar group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <NotificationBell />

          {/* View-as switcher (admin only): preview executor or applicant cabinets */}
          {isAdmin && viewMode === 'admin' && (
            <Dropdown
              menu={{
                items: [
                  { key: 'executor', icon: <FileTextOutlined />, label: 'Кабинет исполнителя' },
                  { key: 'portal', icon: <UserOutlined />, label: 'Кабинет заявителя' },
                ],
                onClick: ({ key }) => switchToView(key as ViewMode),
              }}
              trigger={['click']}
            >
              <Button
                type="text"
                icon={<EyeOutlined style={{ fontSize: 16, color: '#666' }} />}
                style={headerIconBtnStyle}
                title="Просмотр от лица другой роли"
              />
            </Dropdown>
          )}

          <VersionBadge onClick={() => navigate('/changelog')} />

          {/* Help */}
          <Button
            type="text"
            icon={<QuestionCircleOutlined style={{ fontSize: 17, color: '#666' }} />}
            onClick={() => navigate('/help')}
            style={headerIconBtnStyle}
            title="Справка"
          />

          {/* User */}
          <Dropdown menu={{
            items: userMenuItems,
            onClick: ({ key }) => {
              if (key === 'logout') logout();
              if (key === 'profile') navigate('/profile');
            },
          }}>
            <Space style={{
              cursor: 'pointer', flexShrink: 0, padding: '5px 12px 5px 6px',
              borderRadius: 12, background: 'rgba(0,0,0,0.035)', marginLeft: 4,
            }}>
              <Avatar
                size={32}
                style={{
                  background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                  border: '2px solid rgba(255,255,255,0.9)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                }}
              >
                {initials}
              </Avatar>
              <div style={{ textAlign: 'left', lineHeight: 1.35 }}>
                <div title={user?.fullName} style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{shortFullName(user?.fullName)}</div>
                <div style={{ fontSize: 11, color: '#999' }}>{ROLE_LABELS[user?.role || '']}</div>
              </div>
            </Space>
          </Dropdown>
        </div>
      </Header>

      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
