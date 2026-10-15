import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Select, DatePicker, Typography, Space, Tag, Tooltip, Card, Row, Col, Statistic,
} from 'antd';
import {
  LoginOutlined, CloseCircleOutlined, EyeOutlined, PlusOutlined,
  SwapOutlined, UploadOutlined, FileExcelOutlined, AuditOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';

const EVENT_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  login_success:   { label: 'Вход',             color: 'green',   icon: <LoginOutlined /> },
  login_fail:      { label: 'Неверный пароль',  color: 'red',     icon: <CloseCircleOutlined /> },
  request_viewed:  { label: 'Просмотр заявки',  color: 'blue',    icon: <EyeOutlined /> },
  request_created: { label: 'Создана заявка',   color: 'cyan',    icon: <PlusOutlined /> },
  status_changed:  { label: 'Смена статуса',    color: 'orange',  icon: <SwapOutlined /> },
  portal_submit:   { label: 'Портал: заявка',   color: 'purple',  icon: <UploadOutlined /> },
  export_excel:    { label: 'Экспорт Excel',    color: 'default', icon: <FileExcelOutlined /> },
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ', executor: 'Исполнитель', customer: 'Заказчик',
};

export default function ActivityLogsPage() {
  const [filters, setFilters] = useState<{
    userId?: number; event?: string; dateFrom?: string; dateTo?: string; page: number;
  }>({ page: 1 });

  const { data, isLoading } = useQuery({
    queryKey: ['activity-logs', filters],
    queryFn: () => api.get('/activity-logs', { params: filters }).then(r => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users').then(r => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['activity-logs-stats-today'],
    queryFn: () => api.get('/activity-logs/stats').then(r => r.data),
  });

  const columns: ColumnsType<any> = [
    {
      title: 'Время', dataIndex: 'createdAt', width: 150,
      render: (v: string) => (
        <span style={{ fontSize: 12, color: '#555' }}>
          {dayjs(v).format('DD.MM.YY HH:mm:ss')}
        </span>
      ),
    },
    {
      title: 'Пользователь', width: 180,
      render: (_: any, r: any) => (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{r.userName || '—'}</div>
          {r.userRole && (
            <Tag style={{ fontSize: 10, marginTop: 2 }} color={
              r.userRole === 'admin' ? 'red' : r.userRole === 'executor' ? 'blue' : 'green'
            }>
              {ROLE_LABELS[r.userRole] || r.userRole}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Событие', width: 200,
      render: (_: any, r: any) => {
        const m = EVENT_META[r.event] || { label: r.event, color: 'default', icon: <AuditOutlined /> };
        return (
          <Tag color={m.color} icon={m.icon} style={{ fontSize: 12 }}>
            {m.label}
          </Tag>
        );
      },
    },
    {
      title: 'Объект', ellipsis: true,
      render: (_: any, r: any) => r.entityLabel
        ? <span style={{ fontSize: 12, color: '#1677ff' }}>{r.entityLabel}</span>
        : <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: 'Детали', width: 160,
      render: (_: any, r: any) => {
        if (r.event === 'status_changed' && r.meta?.to) {
          return <Tag style={{ fontSize: 11 }}>{r.meta.to}</Tag>;
        }
        if (r.event === 'export_excel' && r.meta?.type) {
          return <span style={{ fontSize: 11, color: '#888' }}>{r.meta.type}</span>;
        }
        return null;
      },
    },
    {
      title: 'IP', dataIndex: 'ip', width: 130,
      render: (v: string) => v
        ? <Tooltip title={v}><span style={{ fontSize: 11, color: '#aaa' }}>{v}</span></Tooltip>
        : null,
    },
  ];

  const today = stats?.todayStats;

  return (
    <div className="analytics-glass">
      <Typography.Title level={4} style={{ marginBottom: 16 }}>Журнал активности</Typography.Title>

      {today && (
        <Reveal>
        <Row gutter={[12, 12]} style={{ marginBottom: 20, alignItems: 'stretch' }}>
          {[
            { title: 'Событий сегодня', value: today.total, color: '#e6f4ff', border: '#91caff' },
            { title: 'Входов сегодня',  value: today.logins,  color: '#f6ffed', border: '#b7eb8f' },
            { title: 'Просмотров',      value: today.views,   color: '#fff7e6', border: '#ffd591' },
            { title: 'Экспортов',       value: today.exports, color: '#f9f0ff', border: '#d3adf7' },
          ].map((c, i) => (
            <Col key={i} xs={12} sm={6} style={{ display: 'flex' }}>
              <Card size="small" style={{ background: c.color, border: `1px solid ${c.border}`, width: '100%' }}
                bodyStyle={{ padding: '12px 16px' }}>
                <Statistic title={c.title} value={c.value} valueStyle={{ fontSize: 22 }} />
              </Card>
            </Col>
          ))}
        </Row>
        </Reveal>
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 200 }} placeholder="Пользователь" allowClear
          onChange={v => setFilters(f => ({ ...f, userId: v, page: 1 }))}
          showSearch optionFilterProp="label"
          options={(users as any[]).map((u: any) => ({ value: u.id, label: u.fullName }))}
        />
        <Select
          style={{ width: 200 }} placeholder="Событие" allowClear
          onChange={v => setFilters(f => ({ ...f, event: v, page: 1 }))}
          options={Object.entries(EVENT_META).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <DatePicker.RangePicker
          format="DD.MM.YYYY"
          onChange={(dates: any) => setFilters(f => ({
            ...f,
            dateFrom: dates?.[0]?.format('YYYY-MM-DD'),
            dateTo: dates?.[1]?.format('YYYY-MM-DD'),
            page: 1,
          }))}
        />
      </Space>

      <Reveal delay={0.08}>
      <Table
        dataSource={data?.items || []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{
          current: data?.page || 1,
          pageSize: data?.limit || 50,
          total: data?.total || 0,
          showTotal: (t) => `Всего ${t} записей`,
          onChange: (p) => setFilters(f => ({ ...f, page: p })),
        }}
        scroll={{ x: 900 }}
      />
      </Reveal>
    </div>
  );
}
