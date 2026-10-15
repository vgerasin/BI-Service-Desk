import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Tag, Space, Input, Select, Modal, Form, Checkbox,
  Typography, Row, Col, message, Upload, Popconfirm, Tooltip, Segmented,
} from 'antd';
import RichEditor from '../components/RichEditor';
import EmployeePicker, { EmployeeOption } from '../components/EmployeePicker';
import { useFeatures } from '../hooks/useFeatures';
import {
  PlusOutlined, SearchOutlined, UploadOutlined, DownloadOutlined, DeleteOutlined, CloseOutlined,
  TeamOutlined, SwapOutlined, BugOutlined, ToolOutlined, BarChartOutlined, AppstoreOutlined,
  QuestionCircleOutlined, CloudSyncOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd';
import dayjs from 'dayjs';
import api from '../api/client';
import { downloadExcel } from '../api/downloadExcel';
import { shortFullName, requesterDisplay, shortCompanyName } from '../utils/formatName';
import { CLOSED_STATUSES, urgencyDotColor, UrgencyColor } from '../utils/requestVisuals';
import { useAuth } from '../contexts/AuthContext';
import {
  BiRequest, RequestStatus, RequestType, Priority,
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, PRIORITY_LABELS, PRIORITY_COLORS, UserRole,
} from '../types';
import Reveal from '../components/Reveal';
import '../requests-glass.css';

const LEGEND_ITEMS: { color: Exclude<UrgencyColor, null>; label: string }[] = [
  { color: 'blue', label: 'новая / без исполнителя' },
  { color: 'orange', label: 'горит срок (≤3 дней или на проверке)' },
  { color: 'red', label: 'критический приоритет / просрочена' },
  { color: 'grey', label: 'выполненная' },
];

const URGENCY_LEGEND_STYLE: Record<Exclude<UrgencyColor, null>, { bg: string; border: string }> = {
  blue: { bg: 'rgba(0, 122, 255, 0.12)', border: 'rgba(0, 122, 255, 0.35)' },
  orange: { bg: 'rgba(255, 159, 10, 0.14)', border: 'rgba(255, 159, 10, 0.4)' },
  red: { bg: 'rgba(255, 59, 48, 0.12)', border: 'rgba(255, 59, 48, 0.35)' },
  grey: { bg: 'rgba(60, 60, 67, 0.12)', border: 'rgba(60, 60, 67, 0.3)' },
};

export default function RequestsPage() {
  const navigate = useNavigate();
  const features = useFeatures();
  const qc = useQueryClient();
  const { user } = useAuth();
  // Same "view as executor" preview mode as AppLayout.tsx (sessionStorage, not a prop/context) —
  // an admin previewing the executor cabinet must see admin-only bits (create button, assignee
  // fields, the dashboard-refresh banner...) hidden too, not just the real JWT role checked.
  const viewMode = sessionStorage.getItem('bi_view_mode') || 'admin';
  const isAdmin = user?.role === UserRole.ADMIN && viewMode === 'admin';
  // Seeds status/overdue from KPI tile links on the dashboard (e.g. /requests?status=in_progress)
  // — read once on mount, not kept in sync afterwards (filters are local state from then on).
  const [searchParams] = useSearchParams();
  const [filters, setFiltersRaw] = useState<any>(() => {
    const initial: any = {};
    if (searchParams.get('status')) initial.status = searchParams.get('status');
    if (searchParams.get('overdue') === 'true') initial.overdue = true;
    // "Дашборд" filter survives closing the tab/browser — a person usually keeps coming back
    // to check on the same one or two dashboards, not re-picking it every visit.
    const savedReportId = localStorage.getItem('bi_requests_report_filter');
    if (savedReportId) initial.reportId = Number(savedReportId);
    return initial;
  });
  // Admin oversees everyone's work, so "Все заявки" comes first and is the default; executors
  // care about their own assignments first, so "Мои заявки" stays first/default for them.
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sorter, setSorter] = useState<{ field?: string; order?: 'ascend' | 'descend' }>({});
  // Legend dots (Новая/Горит срок/Критическая/Выполненная) double as a multi-select filter.
  // The category is computed client-side (urgencyDotColor combines status+priority+plannedDate,
  // no single matching DB column), so when it's active we fetch the whole filtered set in one
  // page and paginate it ourselves instead of asking the server — same "filter/sort the full set
  // in memory" approach already used for row ordering below, just extended to this filter too.
  const [urgencyFilter, setUrgencyFilter] = useState<Exclude<UrgencyColor, null>[]>([]);
  const toggleUrgency = (color: Exclude<UrgencyColor, null>) => {
    setUrgencyFilter(prev => (prev.includes(color) ? prev.filter(c => c !== color) : [...prev, color]));
    setPage(1);
  };
  // Resets to page 1 whenever a filter changes, so the user doesn't land on an empty page.
  const setFilters = (updater: (f: any) => any) => { setFiltersRaw(updater); setPage(1); };
  const [typeModal, setTypeModal] = useState(false);
  const [formModal, setFormModal] = useState(false);
  const [adminSelectedType, setAdminSelectedType] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [pendingGrif, setPendingGrif] = useState<File | null>(null);
  const [pendingReqs, setPendingReqs] = useState<File | null>(null);
  const [pendingFiles, setPendingFiles] = useState<UploadFile[]>([]);
  const [onBehalf, setOnBehalf] = useState(false);
  const [onBehalfEmployee, setOnBehalfEmployee] = useState<EmployeeOption | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [batchContractorModal, setBatchContractorModal] = useState(false);
  const [batchStatusModal, setBatchStatusModal] = useState(false);
  const [batchForm] = Form.useForm();

  const { data: requestsResp, isLoading } = useQuery({
    queryKey: ['requests', filters, scope, page, pageSize, sorter, urgencyFilter],
    queryFn: () => api.get('/requests', {
      params: {
        ...filters, mine: scope === 'mine' ? 'true' : undefined,
        // With an urgency filter active, fetch everything in one shot and paginate client-side
        // below — the server has no notion of this derived category to filter/count by.
        page: urgencyFilter.length > 0 ? 1 : page,
        pageSize: urgencyFilter.length > 0 ? 5000 : pageSize,
        sortField: sorter.field, sortOrder: sorter.order,
      },
    }).then(r => r.data),
  });
  const rawRequests = requestsResp?.data ?? [];
  const urgencyFiltered = urgencyFilter.length > 0
    ? rawRequests.filter((r: any) => {
      const c = urgencyDotColor(r);
      return c && urgencyFilter.includes(c);
    })
    : rawRequests;
  const requests = urgencyFilter.length > 0
    ? urgencyFiltered.slice((page - 1) * pageSize, page * pageSize)
    : urgencyFiltered;
  const total = urgencyFilter.length > 0 ? urgencyFiltered.length : (requestsResp?.total ?? 0);
  const { data: reportsRef = [] } = useQuery({ queryKey: ['reports-ref'], queryFn: () => api.get('/reports-ref').then(r => r.data) });
  // "Исполнитель" assigns an internal staff member (assigneeId) — contractors are a separate
  // concept used only for Act generation, not shown here.
  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data.filter((u: any) => u.role !== UserRole.CUSTOMER)),
    enabled: user?.role === UserRole.ADMIN,
  });
  // Admin-only: distributes requests for failed dashboard refreshes themselves — executors no
  // longer see this block at all (see AnalyticsPage.tsx EXECUTOR_TAB_KEYS for the matching change).
  const { data: refreshSummary } = useQuery({
    queryKey: ['dashboard-refresh-today-summary'],
    queryFn: () => api.get('/dashboard-refresh-logs/today-summary').then(r => r.data),
    enabled: isAdmin && features.dashboardRefresh,
  });

  const ADMIN_TYPE_CARDS = [
    { value: 'bugfix', icon: <BugOutlined style={{ fontSize: 26, color: '#ff4d4f' }} />, label: 'Ошибка / Баг', desc: 'Что-то не работает', color: '#fff2f0', border: '#ffccc7' },
    { value: 'improvement', icon: <ToolOutlined style={{ fontSize: 26, color: '#fa8c16' }} />, label: 'Доработка', desc: 'Изменение дашборда', color: '#fff7e6', border: '#ffd591' },
    { value: 'development', icon: <BarChartOutlined style={{ fontSize: 26, color: '#1677ff' }} />, label: 'Новый дашборд', desc: 'Разработка нового отчёта', color: '#e6f4ff', border: '#91caff' },
    { value: 'other', icon: <QuestionCircleOutlined style={{ fontSize: 26, color: '#722ed1' }} />, label: 'Прочее', desc: 'Другой тип задачи', color: '#f9f0ff', border: '#d3adf7' },
  ];

  const selectAdminType = (type: string) => {
    setAdminSelectedType(type);
    form.resetFields();
    setPendingGrif(null);
    setPendingReqs(null);
    setPendingFiles([]);
    setOnBehalf(false);
    setOnBehalfEmployee(null);
    setTypeModal(false);
    setFormModal(true);
  };

  const createMutation = useMutation({
    mutationFn: async (dto: any) => {
      const res = await api.post('/requests', dto);
      const requestId = res.data.id;
      const uploads: Promise<any>[] = [];
      if (pendingGrif) {
        const fd = new FormData(); fd.append('file', pendingGrif); fd.append('artifactType', 'grif');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd));
      }
      if (pendingReqs) {
        const fd = new FormData(); fd.append('file', pendingReqs); fd.append('artifactType', 'requirements');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd));
      }
      for (const f of pendingFiles) {
        if (!f.originFileObj) continue;
        const fd = new FormData(); fd.append('file', f.originFileObj); fd.append('artifactType', 'other');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd));
      }
      await Promise.all(uploads);
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      setFormModal(false);
      form.resetFields();
      setPendingGrif(null);
      setPendingReqs(null);
      setPendingFiles([]);
      setOnBehalf(false);
      setOnBehalfEmployee(null);
      setAdminSelectedType(null);
      message.success('Заявка создана');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/requests/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); message.success('Заявка удалена'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка'),
  });

  const batchMutation = useMutation({
    mutationFn: (dto: { action: string; payload: any }) =>
      api.post('/requests/batch', { ids: selectedKeys, ...dto }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      setSelectedKeys([]);
      setBatchContractorModal(false);
      setBatchStatusModal(false);
      batchForm.resetFields();
      message.success(`Обновлено: ${data.success}${data.failed > 0 ? `, пропущено: ${data.failed}` : ''}`);
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка'),
  });


  const sortOrderFor = (key: string) => (sorter.field === key ? sorter.order : undefined);

  const columns: ColumnsType<BiRequest> = [
    {
      title: '', key: 'urgency', width: 20,
      render: (_: any, r: any) => {
        const color = urgencyDotColor(r);
        return color ? <span className={`req-dot req-dot-${color}`} /> : null;
      },
    },
    {
      title: '№', dataIndex: 'number', key: 'number', width: 130,
      sorter: true, sortOrder: sortOrderFor('number'),
      render: (v, r) => <Link to={`/requests/${r.number}`}>{v}</Link>,
    },
    {
      title: 'Наименование', dataIndex: 'name', key: 'name', ellipsis: true,
      sorter: true, sortOrder: sortOrderFor('name'),
      render: (v, r: any) => (
        <div style={{ minWidth: 0 }}>
          <Link
            to={`/requests/${r.number}`}
            className={CLOSED_STATUSES.includes(r.status) ? 'req-name-closed' : undefined}
            style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {v}
          </Link>
          {(r.report?.name || requesterDisplay(r).name) && (
            <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {r.report?.name && (
                <Tag
                  color="blue"
                  style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); navigate(`/admin/reports-ref/${r.reportId}`); }}
                >
                  {r.report.name}
                </Tag>
              )}
              {requesterDisplay(r).name && (
                <Tooltip title={requesterDisplay(r).via ? `Заявка оформлена: ${requesterDisplay(r).via}` : undefined}>
                  <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
                    {shortFullName(requesterDisplay(r).name)}
                    {requesterDisplay(r).via && <> · от {shortFullName(requesterDisplay(r).via)}</>}
                  </Tag>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Тип', dataIndex: 'type', key: 'type', width: 120,
      sorter: true, sortOrder: sortOrderFor('type'),
      render: (v) => TYPE_LABELS[v],
    },
    {
      title: 'Статус', dataIndex: 'status', key: 'status', width: 150,
      sorter: true, sortOrder: sortOrderFor('status'),
      render: (v) => <Tag color={STATUS_COLORS[v]}>{STATUS_LABELS[v]}</Tag>,
    },
    {
      title: 'Приоритет', dataIndex: 'priority', key: 'priority', width: 120,
      sorter: true, sortOrder: sortOrderFor('priority'),
      render: (v) => <Tag color={PRIORITY_COLORS[v]}>{PRIORITY_LABELS[v]}</Tag>,
    },
    {
      title: 'Исполнитель', dataIndex: ['assignee', 'fullName'], key: 'assignee', width: 150,
      sorter: true, sortOrder: sortOrderFor('assignee'),
      render: (v: any) => v || '—',
    },
    // Кто платит за эту заявку (см. billing-companies) — админу важно видеть распределение
    // между юрлицами до того, как формировать акты, остальным ролям это не нужно.
    ...(isAdmin ? [{
      title: 'Юрлицо', dataIndex: 'billingCompany', key: 'billingCompany', width: 150,
      ellipsis: true,
      render: (v: any) => v ? (
        <Tooltip title={v.name}>
          <Tag style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {v.shortName || shortCompanyName(v.name)}
          </Tag>
        </Tooltip>
      ) : <span style={{ color: '#bbb' }}>—</span>,
    }] : []),
    {
      title: 'Создана', dataIndex: 'createdAt', key: 'createdAt', width: 110,
      sorter: true, sortOrder: sortOrderFor('createdAt'),
      render: (v) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Плановый срок', dataIndex: 'plannedDate', key: 'plannedDate', width: 120,
      sorter: true, sortOrder: sortOrderFor('plannedDate'),
      render: (v, r) => {
        if (!v) return '—';
        const overdue = !['done', 'rejected', 'cancelled'].includes(r.status) && dayjs(v).isBefore(dayjs());
        return <span style={{ color: overdue ? '#ff4d4f' : undefined }}>{dayjs(v).format('DD.MM.YYYY')}</span>;
      },
    },
    ...(user?.role === UserRole.ADMIN ? [{
      title: '',
      width: 50,
      render: (_: any, r: any) => (
        <Popconfirm
          title="Удалить заявку?"
          description="Все данные заявки (файлы, трудозатраты, история) будут удалены без возможности восстановления."
          onConfirm={() => deleteMutation.mutate(r.id)}
          okText="Удалить"
          okButtonProps={{ danger: true }}
          cancelText="Отмена"
        >
          <Button size="small" danger icon={<DeleteOutlined />} title="Удалить заявку" />
        </Popconfirm>
      ),
    }] as any : []),
  ];

  const failuresToday = refreshSummary?.today ?? 0;
  const refreshDelta = refreshSummary ? (refreshSummary.today - refreshSummary.yesterday) : 0;

  return (
    <div className="requests-glass">
      {features.dashboardRefresh && refreshSummary && (
        <div
          onClick={() => navigate('/analytics?tab=dashboard-refresh')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 14,
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer', position: 'relative',
            background: failuresToday > 0 ? '#fff2f0' : '#f6ffed',
            border: `1px solid ${failuresToday > 0 ? '#ffccc7' : '#b7eb8f'}`,
          }}
        >
          <CloudSyncOutlined style={{ fontSize: 18, color: failuresToday > 0 ? '#ff4d4f' : '#52c41a' }} />
          <span style={{ fontSize: 12, color: '#595959' }}>Сбой обновления дашбордов сегодня</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: failuresToday > 0 ? '#ff4d4f' : '#52c41a' }}>
            {failuresToday}
          </span>
          {refreshDelta !== 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              padding: '0 6px', borderRadius: 8, fontSize: 11, fontWeight: 600,
              background: refreshDelta > 0 ? '#fff2f0' : '#f6ffed',
              border: `1px solid ${refreshDelta > 0 ? '#ffccc7' : '#b7eb8f'}`,
              color: refreshDelta > 0 ? '#cf1322' : '#389e0d',
            }}>
              {refreshDelta > 0 ? <ArrowUpOutlined style={{ fontSize: 9 }} /> : <ArrowDownOutlined style={{ fontSize: 9 }} />}
              {Math.abs(refreshDelta)}
            </span>
          )}
        </div>
      )}
      <div className="req-toolbar">
        <div className="req-toolbar-row">
          <Typography.Title level={4} style={{ margin: 0 }}>Заявки</Typography.Title>
          <div className="req-legend-row">
            {LEGEND_ITEMS.map(({ color, label }) => {
              const active = urgencyFilter.includes(color);
              const style = URGENCY_LEGEND_STYLE[color];
              return (
                <span
                  key={color}
                  className={`req-legend-item${active ? ' req-legend-item-active' : ''}`}
                  style={active ? { background: style.bg, borderColor: style.border } : undefined}
                  onClick={() => toggleUrgency(color)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleUrgency(color); } }}
                  role="button"
                  tabIndex={0}
                >
                  <span className={`req-dot req-dot-${color}`} />{label}
                </span>
              );
            })}
            {urgencyFilter.length > 0 && (
              <span className="req-legend-clear" onClick={() => setUrgencyFilter([])}>Сбросить</span>
            )}
          </div>
          <Space>
            <Tooltip title="Экспорт в Excel">
              <Button
                icon={<DownloadOutlined />}
                onClick={() => downloadExcel('/requests/export', 'requests.xlsx',
                  Object.fromEntries(Object.entries(filters).filter(([_, v]) => v != null && v !== ''))
                )}
              />
            </Tooltip>
            {isAdmin && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setTypeModal(true)}>
                Создать заявку
              </Button>
            )}
          </Space>
        </div>
      </div>

      <Row gutter={[8, 8]} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <Segmented
            value={scope}
            onChange={(v) => { setScope(v as 'mine' | 'all'); setPage(1); }}
            options={isAdmin
              ? [{ label: 'Все заявки', value: 'all' }, { label: 'Мои заявки', value: 'mine' }]
              : [{ label: 'Мои заявки', value: 'mine' }, { label: 'Все заявки', value: 'all' }]}
          />
        </Col>
        <Col xs={24} sm={8} md={5}>
          <Input placeholder="Поиск по названию/номеру" prefix={<SearchOutlined />}
            onChange={e => setFilters((f: any) => ({ ...f, search: e.target.value || undefined }))} allowClear />
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select style={{ width: '100%' }} placeholder="Статус" allowClear
            value={filters.status}
            onChange={v => setFilters((f: any) => ({ ...f, status: v }))}>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <Select.Option key={k} value={k}>{l}</Select.Option>)}
          </Select>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select style={{ width: '100%' }} placeholder="Приоритет" allowClear
            onChange={v => setFilters((f: any) => ({ ...f, priority: v }))}>
            {Object.entries(PRIORITY_LABELS).map(([k, l]) => <Select.Option key={k} value={k}>{l}</Select.Option>)}
          </Select>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Select
            style={{ width: '100%' }} placeholder="Дашборд" allowClear showSearch
            value={filters.reportId}
            optionFilterProp="label"
            onChange={v => {
              setFilters((f: any) => ({ ...f, reportId: v }));
              if (v) localStorage.setItem('bi_requests_report_filter', String(v));
              else localStorage.removeItem('bi_requests_report_filter');
            }}
            options={reportsRef.map((r: any) => ({ value: r.id, label: r.name }))}
          />
        </Col>
        {(user?.role === UserRole.ADMIN) && (
          <Col xs={12} sm={6} md={3}>
            <Select style={{ width: '100%' }} placeholder="Исполнитель" allowClear
              onChange={v => setFilters((f: any) => ({ ...f, assigneeId: v }))}>
              {assignableUsers.map((u: any) => <Select.Option key={u.id} value={u.id}>{u.fullName}</Select.Option>)}
            </Select>
          </Col>
        )}
      </Row>

      <Reveal>
      <Table
        dataSource={requests}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="middle"
        rowClassName={(r: any) => CLOSED_STATUSES.includes(r.status) ? 'req-row-closed' : ''}
        pagination={{
          current: page, pageSize, total, showSizeChanger: true,
          showTotal: (t) => `Всего: ${t}`,
        }}
        onChange={(pagination, _filters, sorterResult) => {
          if (pagination.current) setPage(pagination.current);
          if (pagination.pageSize) setPageSize(pagination.pageSize);
          const s = Array.isArray(sorterResult) ? sorterResult[0] : sorterResult;
          const field = s?.columnKey as string | undefined;
          const order = (s?.order || undefined) as 'ascend' | 'descend' | undefined;
          setSorter(prev => (prev.field === field && prev.order === order) ? prev : { field, order });
        }}
        scroll={{ x: 1100 }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
        }}
      />
      </Reveal>

      {/* Bulk action bar */}
      {selectedKeys.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a1a', borderRadius: 12, padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)', zIndex: 1000, whiteSpace: 'nowrap',
        }}>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
            Выбрано: {selectedKeys.length}
          </span>
          <div style={{ width: 1, height: 20, background: '#444' }} />
          {user?.role === UserRole.ADMIN && (
            <Button
              size="small"
              icon={<TeamOutlined />}
              onClick={() => setBatchContractorModal(true)}
              style={{ background: '#262626', border: '1px solid #444', color: '#fff' }}
            >
              Исполнитель
            </Button>
          )}
          <Button
            size="small"
            icon={<SwapOutlined />}
            onClick={() => setBatchStatusModal(true)}
            style={{ background: '#262626', border: '1px solid #444', color: '#fff' }}
          >
            Статус
          </Button>
          <Button
            size="small"
            icon={<CloseOutlined />}
            onClick={() => setSelectedKeys([])}
            style={{ background: 'transparent', border: '1px solid #555', color: '#aaa' }}
          >
            Снять
          </Button>
        </div>
      )}

      {/* Batch: assign contractor */}
      <Modal
        title={`Назначить исполнителя (${selectedKeys.length} заявок)`}
        open={batchContractorModal}
        onCancel={() => { setBatchContractorModal(false); batchForm.resetFields(); }}
        onOk={() => batchForm.submit()}
        confirmLoading={batchMutation.isPending}
      >
        <Form form={batchForm} layout="vertical" onFinish={(v) =>
          batchMutation.mutate({ action: 'assign_assignee', payload: { assigneeId: v.assigneeId } })
        }>
          <Form.Item name="assigneeId" label="Исполнитель" rules={[{ required: true, message: 'Выберите исполнителя' }]}>
            <Select allowClear showSearch optionFilterProp="children" placeholder="Выбрать...">
              {assignableUsers.map((u: any) => <Select.Option key={u.id} value={u.id}>{u.fullName}</Select.Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Batch: change status */}
      <Modal
        title={`Изменить статус (${selectedKeys.length} заявок)`}
        open={batchStatusModal}
        onCancel={() => { setBatchStatusModal(false); batchForm.resetFields(); }}
        onOk={() => batchForm.submit()}
        confirmLoading={batchMutation.isPending}
      >
        <Form form={batchForm} layout="vertical" onFinish={(v) =>
          batchMutation.mutate({ action: 'change_status', payload: { status: v.status } })
        }>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            Заявки, для которых переход недопустим, будут пропущены.
          </Typography.Text>
          <Form.Item name="status" label="Новый статус" rules={[{ required: true, message: 'Выберите статус' }]}>
            <Select placeholder="Выбрать...">
              {Object.entries(STATUS_LABELS).map(([k, l]) => (
                <Select.Option key={k} value={k}>{l}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Step 1: select type */}
      <Modal
        title="Выберите тип заявки"
        open={typeModal}
        onCancel={() => setTypeModal(false)}
        footer={null}
        width={560}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '8px 0 4px' }}>
          {ADMIN_TYPE_CARDS.map(c => (
            <div
              key={c.value}
              onClick={() => selectAdminType(c.value)}
              style={{
                border: `2px solid ${c.border}`, borderRadius: 10, background: c.color,
                padding: '18px 14px', cursor: 'pointer', transition: 'transform 0.12s, box-shadow 0.12s',
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,.1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
            >
              <div style={{ flexShrink: 0, marginTop: 2 }}>{c.icon}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{c.label}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Step 2: fill form */}
      {(() => {
        const card = ADMIN_TYPE_CARDS.find(c => c.value === adminSelectedType);
        const needsReport = adminSelectedType === 'bugfix' || adminSelectedType === 'improvement';
        const needsDocs = adminSelectedType === 'improvement' || adminSelectedType === 'development';
        return (
          <Modal
            title={card ? <Space>{card.icon}<span>{card.label}</span></Space> : 'Новая заявка'}
            open={formModal}
            onCancel={() => {
              setFormModal(false); setPendingGrif(null); setPendingReqs(null);
              setOnBehalf(false); setOnBehalfEmployee(null);
            }}
            onOk={() => {
              if (onBehalf && !onBehalfEmployee) {
                message.error('Выберите заявителя из списка сотрудников');
                return;
              }
              form.submit();
            }}
            confirmLoading={createMutation.isPending}
            width={640}
            destroyOnClose
          >
            <Form
              form={form}
              layout="vertical"
              onFinish={(v) => createMutation.mutate({
                ...v,
                type: adminSelectedType,
                plannedDate: v.plannedDate ? v.plannedDate.format('YYYY-MM-DD') : undefined,
                onBehalfOfName: onBehalf && onBehalfEmployee ? onBehalfEmployee.fullName : undefined,
                onBehalfOfEmail: onBehalf && onBehalfEmployee ? onBehalfEmployee.email : undefined,
              })}
            >
              <Form.Item name="name" label="Тема заявки" rules={[{ required: true, message: 'Укажите тему' }]}>
                <Input placeholder="Кратко опишите суть" size="large" />
              </Form.Item>

              {features.hrDirectory && (
              <Form.Item style={{ marginBottom: onBehalf ? 8 : 16 }}>
                <Checkbox
                  checked={onBehalf}
                  onChange={e => { setOnBehalf(e.target.checked); if (!e.target.checked) setOnBehalfEmployee(null); }}
                >
                  Заявитель — другой сотрудник
                </Checkbox>
              </Form.Item>
              )}
              {features.hrDirectory && onBehalf && (
                <Form.Item
                  label="Заявитель"
                  required
                  validateStatus={!onBehalfEmployee ? 'warning' : undefined}
                  help={!onBehalfEmployee ? 'Начните вводить фамилию и выберите из списка — уведомления по заявке будут приходить ему' : undefined}
                >
                  <EmployeePicker value={onBehalfEmployee} onChange={setOnBehalfEmployee} />
                </Form.Item>
              )}

              {isAdmin ? (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="priority" label="Приоритет" rules={[{ required: true }]} initialValue="medium">
                      <Select>
                        {Object.entries(PRIORITY_LABELS).map(([k, l]) => <Select.Option key={k} value={k}>{l}</Select.Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="assigneeId" label="Исполнитель">
                      <Select allowClear showSearch optionFilterProp="children" placeholder="Не назначен">
                        {assignableUsers.map((u: any) => <Select.Option key={u.id} value={u.id}>{u.fullName}</Select.Option>)}
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                // Priority/executor triage is the admin's call — everyone else just submits
                // the request and gets a sensible default (medium, unassigned).
                <Form.Item name="priority" initialValue="medium" hidden><Input /></Form.Item>
              )}

              {needsReport && (
                <Form.Item
                  name="reportId"
                  label="Дашборд / Отчёт"
                  rules={adminSelectedType === 'improvement' ? [{ required: true, message: 'Выберите дашборд' }] : []}
                >
                  <Select allowClear showSearch optionFilterProp="children" placeholder="Выберите из реестра">
                    {reportsRef.map((r: any, i: number) => (
                      <Select.Option key={r.id} value={r.id}>{i + 1}. {r.name}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              )}

              <Form.Item name="description" label="Описание">
                <RichEditor minHeight={100} placeholder="Подробное описание задачи..." />
              </Form.Item>

              {needsDocs && (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="Бриф" style={{ marginBottom: 0 }}>
                      <Upload
                        beforeUpload={(file) => { setPendingGrif(file); return false; }}
                        onRemove={() => setPendingGrif(null)}
                        maxCount={1}
                        fileList={pendingGrif ? [{ uid: '-1', name: pendingGrif.name, status: 'done' as const }] : []}
                      >
                        <Button icon={<UploadOutlined />} size="small">Выбрать файл</Button>
                      </Upload>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Требования / ТЗ" style={{ marginBottom: 0 }}>
                      <Upload
                        beforeUpload={(file) => { setPendingReqs(file); return false; }}
                        onRemove={() => setPendingReqs(null)}
                        maxCount={1}
                        fileList={pendingReqs ? [{ uid: '-1', name: pendingReqs.name, status: 'done' as const }] : []}
                      >
                        <Button icon={<UploadOutlined />} size="small">Выбрать файл</Button>
                      </Upload>
                    </Form.Item>
                  </Col>
                </Row>
              )}

              <Form.Item label="Дополнительные файлы" extra="Скриншоты, примеры, макеты — можно выбрать сразу несколько">
                <Upload
                  multiple
                  beforeUpload={() => false}
                  fileList={pendingFiles}
                  onChange={({ fileList: fl }) => setPendingFiles(fl)}
                  onRemove={(f) => setPendingFiles(prev => prev.filter(x => x.uid !== f.uid))}
                  showUploadList={{ showDownloadIcon: false, removeIcon: <DeleteOutlined /> }}
                >
                  <Button icon={<UploadOutlined />} size="small">Прикрепить файл</Button>
                </Upload>
              </Form.Item>
            </Form>

            <div style={{ paddingTop: 8, marginTop: 4 }}>
              <Button
                size="small"
                type="link"
                style={{ padding: 0, color: '#888' }}
                onClick={() => { setFormModal(false); setTypeModal(true); }}
              >
                ← Изменить тип заявки
              </Button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
