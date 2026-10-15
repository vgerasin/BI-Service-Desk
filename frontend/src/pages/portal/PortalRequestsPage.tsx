import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Tag, Typography, Button, Empty, Modal, Form, Input, Select, Upload, Space,
  Segmented, Row, Col,
} from 'antd';
import {
  PlusOutlined, BugOutlined, ToolOutlined, BarChartOutlined, PaperClipOutlined, DeleteOutlined,
  SendOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useNavigate, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import { STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, PRIORITY_LABELS, PRIORITY_COLORS } from '../../types';
import type { ReportRef } from '../../types';
import RichEditor from '../../components/RichEditor';
import { useAuth } from '../../contexts/AuthContext';
import { CLOSED_STATUSES } from '../../utils/requestVisuals';
import '../../analytics-glass.css';

const TYPE_CARDS = [
  {
    value: 'bugfix',
    icon: <BugOutlined style={{ fontSize: 28, color: '#ff4d4f' }} />,
    label: 'Ошибка / Баг',
    desc: 'Что-то не работает или работает неправильно',
    color: '#fff2f0',
    border: '#ffccc7',
  },
  {
    value: 'improvement',
    icon: <ToolOutlined style={{ fontSize: 28, color: '#fa8c16' }} />,
    label: 'Доработка',
    desc: 'Изменение существующего дашборда',
    color: '#fff7e6',
    border: '#ffd591',
  },
  {
    value: 'development',
    icon: <BarChartOutlined style={{ fontSize: 28, color: '#1677ff' }} />,
    label: 'Новый дашборд',
    desc: 'Разработка нового отчёта или дашборда',
    color: '#e6f4ff',
    border: '#91caff',
  },
];

export default function PortalRequestsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  // Survives closing the tab/browser — same storage key as the internal Requests page, so an
  // admin switching between the admin view and "preview as заявитель" keeps the same dashboard
  // in focus instead of the filter resetting.
  const [reportFilter, setReportFilter] = useState<number | undefined>(() => {
    const saved = localStorage.getItem('bi_requests_report_filter');
    return saved ? Number(saved) : undefined;
  });
  const setReportFilterPersist = (v: number | undefined) => {
    setReportFilter(v);
    if (v) localStorage.setItem('bi_requests_report_filter', String(v));
    else localStorage.removeItem('bi_requests_report_filter');
  };

  const [typeModal, setTypeModal] = useState(false);
  const [formModal, setFormModal] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [briefFile, setBriefFile] = useState<UploadFile[]>([]);
  const [tzFile, setTzFile] = useState<UploadFile[]>([]);

  const { data = [], isLoading } = useQuery({
    queryKey: ['portal-requests'],
    queryFn: () => api.get('/requests').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: reports = [] } = useQuery<ReportRef[]>({
    queryKey: ['reports-ref'],
    queryFn: () => api.get('/reports-ref').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: async (values: any) => {
      const res = await api.post('/requests', { ...values, type: selectedType });
      const requestId = res.data.id;
      const uploads: Promise<any>[] = [];
      if (briefFile[0]?.originFileObj) {
        const fd = new FormData(); fd.append('file', briefFile[0].originFileObj!); fd.append('artifactType', 'grif');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
      }
      if (tzFile[0]?.originFileObj) {
        const fd = new FormData(); fd.append('file', tzFile[0].originFileObj!); fd.append('artifactType', 'requirements');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
      }
      for (const f of fileList) {
        if (!f.originFileObj) continue;
        const fd = new FormData(); fd.append('file', f.originFileObj); fd.append('artifactType', 'other');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
      }
      await Promise.all(uploads);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-requests'] });
      setFormModal(false);
      form.resetFields();
      setFileList([]); setBriefFile([]); setTzFile([]);
    },
    onError: () => {},
  });

  const openTypeSelect = () => setTypeModal(true);

  const selectType = (type: string) => {
    setSelectedType(type);
    form.resetFields();
    setFileList([]); setBriefFile([]); setTzFile([]);
    setTypeModal(false);
    setFormModal(true);
  };

  const needsReportId = selectedType === 'bugfix' || selectedType === 'improvement';
  const needsBriefTz = selectedType === 'improvement' || selectedType === 'development';
  const card = TYPE_CARDS.find(c => c.value === selectedType);

  const columns = [
    {
      title: '№', dataIndex: 'number', width: 140,
      render: (v: string, r: any) => (
        <Link to={`/portal/requests/${r.number}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v}</Link>
      ),
    },
    {
      title: 'Наименование', dataIndex: 'name', width: 220, ellipsis: true,
      render: (v: string, r: any) => (
        <Link
          to={`/portal/requests/${r.number}`}
          className={CLOSED_STATUSES.includes(r.status) ? 'req-name-closed' : undefined}
        >
          {v}
        </Link>
      ),
    },
    {
      title: 'Дашборд', dataIndex: ['report', 'name'], width: 180, ellipsis: true,
      render: (v: string) => v ? <Tag color="blue" style={{ margin: 0 }}>{v}</Tag> : <span style={{ color: '#bbb' }}>—</span>,
    },
    { title: 'Тип', dataIndex: 'type', width: 130, render: (v: string) => TYPE_LABELS[v] || v },
    {
      title: 'Статус', dataIndex: 'status', width: 140,
      render: (v: string) => <Tag color={STATUS_COLORS[v]}>{STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: 'Приоритет', dataIndex: 'priority', width: 110,
      render: (v: string) => <Tag color={PRIORITY_COLORS[v]}>{PRIORITY_LABELS[v] || v}</Tag>,
    },
    {
      title: 'Заявитель', dataIndex: ['createdBy', 'fullName'], width: 160, ellipsis: true,
      render: (v: string) => v || <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: 'Исполнитель', dataIndex: ['assignee', 'fullName'], width: 150,
      render: (v: string) => v || <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: 'Создана', dataIndex: 'createdAt', width: 110,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'Плановый срок', dataIndex: 'plannedDate', width: 120,
      render: (v: string, r: any) => {
        if (!v) return <span style={{ color: '#bbb' }}>—</span>;
        const overdue = !['done', 'rejected', 'cancelled'].includes(r.status) && dayjs(v).isBefore(dayjs(), 'day');
        return <span style={{ color: overdue ? '#ff4d4f' : undefined, fontWeight: overdue ? 600 : undefined }}>{dayjs(v).format('DD.MM.YYYY')}</span>;
      },
    },
  ];

  // Portal shows the whole organization's requests (multiple people can submit under one
  // customer account) — filter/scope client-side since the full set is already fetched.
  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data as any[]).filter((r) => {
      if (scope === 'mine' && r.createdBy?.id !== user?.id) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (typeFilter && r.type !== typeFilter) return false;
      if (reportFilter && r.reportId !== reportFilter) return false;
      if (q && !(r.name?.toLowerCase().includes(q) || r.number?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, scope, statusFilter, typeFilter, reportFilter, search, user?.id]);

  return (
    <div className="analytics-glass">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Заявки</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openTypeSelect} size="large">
          Новая заявка
        </Button>
      </div>

      <Row gutter={[8, 8]} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <Segmented
            value={scope}
            onChange={(v) => setScope(v as 'mine' | 'all')}
            options={[{ label: 'Мои заявки', value: 'mine' }, { label: 'Все заявки', value: 'all' }]}
          />
        </Col>
        <Col flex="180px">
          <Input
            placeholder="Поиск по названию/номеру"
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
        </Col>
        <Col>
          <Select
            style={{ width: 140 }}
            placeholder="Статус"
            allowClear
            value={statusFilter}
            onChange={setStatusFilter}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Col>
        <Col>
          <Select
            style={{ width: 140 }}
            placeholder="Тип"
            allowClear
            value={typeFilter}
            onChange={setTypeFilter}
            options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Col>
        <Col>
          <Select
            style={{ width: 180 }}
            placeholder="Дашборд"
            allowClear
            showSearch
            optionFilterProp="label"
            value={reportFilter}
            onChange={setReportFilterPersist}
            options={reports.map((r) => ({ value: r.id, label: r.name }))}
          />
        </Col>
      </Row>

      <Reveal>
      <Table
        dataSource={filteredData}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="middle"
        // Without an explicit min-width, antd crushes the one column with no fixed `width`
        // (Наименование) down to ~0px on any viewport narrower than the sum of the other
        // columns' widths — e.g. a common 1280px laptop screen — hiding the request title
        // entirely instead of scrolling. Matches the same safeguard on the internal
        // RequestsPage.tsx table (scroll={{ x: 1100 }}).
        scroll={{ x: 1460 }}
        rowClassName={(r: any) => CLOSED_STATUSES.includes(r.status) ? 'req-row-closed' : ''}
        locale={{ emptyText: <Empty description="Заявок пока нет — нажмите «Новая заявка», чтобы создать первую" /> }}
        onRow={(r) => ({ onClick: () => navigate(`/portal/requests/${r.number}`), style: { cursor: 'pointer' } })}
      />
      </Reveal>

      {/* Step 1: choose type */}
      <Modal
        title="Выберите тип заявки"
        open={typeModal}
        onCancel={() => setTypeModal(false)}
        footer={null}
        width={580}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '8px 0 4px' }}>
          {TYPE_CARDS.map(c => (
            <div
              key={c.value}
              onClick={() => selectType(c.value)}
              style={{
                border: `2px solid ${c.border}`,
                borderRadius: 10,
                background: c.color,
                padding: '20px 12px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'transform 0.12s, box-shadow 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,.1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
            >
              <div style={{ marginBottom: 8 }}>{c.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{c.label}</div>
              <div style={{ color: '#888', fontSize: 11, lineHeight: 1.4 }}>{c.desc}</div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Step 2: fill form */}
      <Modal
        title={card ? <Space>{card.icon}<span>{card.label}</span></Space> : 'Новая заявка'}
        open={formModal}
        onCancel={() => setFormModal(false)}
        footer={null}
        width={620}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }} onFinish={(v) => createMutation.mutate(v)}>
          <Form.Item name="name" label="Тема заявки" rules={[{ required: true, message: 'Укажите тему' }]}>
            <Input placeholder="Кратко опишите суть запроса" size="large" />
          </Form.Item>

          {needsReportId && (
            <Form.Item name="reportId" label="Дашборд / отчёт"
              rules={selectedType === 'improvement' ? [{ required: true, message: 'Выберите дашборд' }] : []}>
              <Select showSearch placeholder="Выберите из реестра отчётов" allowClear
                filterOption={(input, opt) => (opt?.label as string)?.toLowerCase().includes(input.toLowerCase())}
                options={reports.map((r, i) => ({ value: r.id, label: `${i + 1}. ${r.name}` }))} />
            </Form.Item>
          )}

          <Form.Item name="description" label="Описание" rules={[{ required: true, message: 'Опишите задачу' }]}
            extra={selectedType === 'bugfix' ? 'Что происходит, когда возникло, как воспроизвести' : 'Что нужно сделать, какие данные использовать'}>
            <RichEditor placeholder="Подробное описание..." minHeight={140} />
          </Form.Item>

          {needsBriefTz && (
            <>
              <Form.Item label="Бриф" extra="PDF, Word, Excel">
                <Upload maxCount={1} beforeUpload={() => false} fileList={briefFile}
                  onChange={({ fileList: fl }) => setBriefFile(fl)} onRemove={() => setBriefFile([])}
                  showUploadList={{ showDownloadIcon: false, removeIcon: <DeleteOutlined /> }} accept=".pdf,.doc,.docx,.xls,.xlsx">
                  <Button icon={<PaperClipOutlined />}>Прикрепить бриф</Button>
                </Upload>
              </Form.Item>
              <Form.Item label="Техническое задание" extra="PDF, Word, Excel">
                <Upload maxCount={1} beforeUpload={() => false} fileList={tzFile}
                  onChange={({ fileList: fl }) => setTzFile(fl)} onRemove={() => setTzFile([])}
                  showUploadList={{ showDownloadIcon: false, removeIcon: <DeleteOutlined /> }} accept=".pdf,.doc,.docx,.xls,.xlsx">
                  <Button icon={<PaperClipOutlined />}>Прикрепить ТЗ</Button>
                </Upload>
              </Form.Item>
            </>
          )}

          <Form.Item label={selectedType === 'bugfix' ? 'Вложения' : 'Дополнительные файлы'}
            extra="Скриншоты, примеры, макеты — до 20 МБ">
            <Upload multiple beforeUpload={() => false} fileList={fileList}
              onChange={({ fileList: fl }) => setFileList(fl)}
              onRemove={(f) => setFileList(prev => prev.filter(x => x.uid !== f.uid))}
              showUploadList={{ showDownloadIcon: false, removeIcon: <DeleteOutlined /> }}>
              <Button icon={<PaperClipOutlined />}>Прикрепить файл</Button>
            </Upload>
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
            <Button onClick={() => { setFormModal(false); setTypeModal(true); }}>← Изменить тип</Button>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={createMutation.isPending}>
              Отправить заявку
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
