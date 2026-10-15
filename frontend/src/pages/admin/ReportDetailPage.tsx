import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Card, Descriptions, Tag, Button, Spin, Typography, Space, Popconfirm, message, Row, Col, Table, Empty,
  Tabs, Select, DatePicker, Statistic,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, DeleteOutlined, LinkOutlined,
  CheckCircleOutlined, CloseCircleOutlined, DatabaseOutlined, FileExcelOutlined, GlobalOutlined,
  HistoryOutlined, ToolOutlined, CheckSquareOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import ReportEditModal from '../../components/ReportEditModal';
import { STATUS_LABELS, STATUS_COLORS } from '../../types';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const ENV_LABELS: Record<string, string> = {
  dev: 'Разработка', test: 'Тестирование', prod: 'Продуктив',
};
const DS_TYPE_LABELS: Record<string, string> = {
  db: 'База данных', excel: 'Excel', google_doc: 'Google Doc', api: 'API', other: 'Прочее',
};
const DS_TYPE_COLORS: Record<string, string> = {
  db: 'blue', excel: 'green', google_doc: 'orange', api: 'purple', other: 'default',
};
const DB_LABELS: Record<string, string> = {
  mssql: 'MS SQL', postgresql: 'PostgreSQL', oracle: 'Oracle', mysql: 'MySQL', other: 'Другая',
};
const DS_ICONS: Record<string, React.ReactNode> = {
  db: <DatabaseOutlined />, excel: <FileExcelOutlined />,
  google_doc: <GlobalOutlined />, api: <GlobalOutlined />, other: <GlobalOutlined />,
};
const STATUS_OPTIONS: Record<string, { label: string; color: string }> = {
  active: { label: 'Активен', color: 'success' },
  archived: { label: 'Архивирован', color: 'default' },
  development: { label: 'В разработке', color: 'processing' },
};

function BoolTag({ value }: { value: boolean }) {
  return value
    ? <Tag icon={<CheckCircleOutlined />} color="success">Да</Tag>
    : <Tag icon={<CloseCircleOutlined />} color="default">Нет</Tag>;
}

// Power BI Report Server links come through percent-encoded ("%D0%94..." for Cyrillic folder/
// report names) — decode for display and drop the boilerplate "/Reports/powerbi/" routing
// prefix so what's shown is just "Папка / Название отчёта", not the raw encoded URL. The href
// itself is untouched, so navigation still uses the exact original link.
function formatPbiLink(url: string): string {
  try {
    const u = new URL(url);
    let path = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, '');
    path = path.replace(/^Reports\/powerbi\//i, '');
    return path ? path.split('/').join(' / ') : url;
  } catch {
    return url;
  }
}

// "Трудозатраты" tab — all time entries logged against requests linked to this dashboard,
// filterable by исполнитель/период. Reuses the same /time-entries endpoint (and its existing
// role-based scoping — an executor here still only sees their own entries, admin sees everyone's
// plus cost) that backs the main Журнал трудозатрат page, just pinned to this one reportId.
function DashboardTimeEntriesTab({ reportId }: { reportId: number }) {
  const navigate = useNavigate();
  const [contractorIds, setContractorIds] = useState<number[]>([]);
  const [dateRange, setDateRange] = useState<{ dateFrom?: string; dateTo?: string }>({});

  const { data: contractors = [] } = useQuery({
    queryKey: ['contractors'],
    queryFn: () => api.get('/contractors').then(r => r.data),
  });

  // Joined into a comma-separated string, same convention as the main Журнал трудозатрат page —
  // sidesteps axios's array-param serialization, backend parses the same comma list either way.
  const contractorParam = contractorIds.length ? contractorIds.join(',') : undefined;

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['time-entries', { reportId, contractorIds, ...dateRange }],
    queryFn: () => api.get('/time-entries', {
      params: { reportId, contractorId: contractorParam, ...dateRange },
    }).then(r => r.data.filter((e: any) => e.contractorId)),
  });

  const totalHours = entries.reduce((s: number, e: any) => s + Number(e.hours) * Number(e.quantity || 1), 0);
  const totalCost = entries.reduce((s: number, e: any) => s + Number(e.cost || 0), 0);
  const hasCost = totalCost > 0;

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={hasCost ? 8 : 12}>
          <Card size="small"><Statistic title="Итого часов" value={totalHours.toFixed(1)} suffix="ч" /></Card>
        </Col>
        {hasCost && (
          <Col span={8}>
            <Card size="small">
              <Statistic title="Итого стоимость" value={totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} suffix="₽" />
            </Card>
          </Col>
        )}
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        <DatePicker.RangePicker
          format="DD.MM.YYYY"
          onChange={(dates: [Dayjs, Dayjs] | null) => setDateRange({
            dateFrom: dates?.[0]?.format('YYYY-MM-DD'),
            dateTo: dates?.[1]?.format('YYYY-MM-DD'),
          })}
        />
        <Select
          style={{ minWidth: 220, maxWidth: 420 }} placeholder="Исполнитель" allowClear showSearch
          mode="multiple" maxTagCount="responsive"
          optionFilterProp="label"
          value={contractorIds}
          onChange={v => setContractorIds(v)}
          options={contractors.map((c: any) => ({ value: c.id, label: c.name }))}
        />
      </Space>

      <Table
        dataSource={entries}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description="Нет трудозатрат по выбранным фильтрам" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        columns={[
          { title: 'Дата', dataIndex: 'date', width: 100, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
          {
            title: 'Заявка', width: 200, ellipsis: true,
            render: (_: any, r: any) => (
              <Link to={`/requests/${r.requestNumber}`}>{r.requestNumber} — {r.requestName}</Link>
            ),
          },
          { title: 'Исполнитель', dataIndex: 'contractorName', width: 160, ellipsis: true, render: (v: string) => v || '—' },
          {
            title: 'Наименование работ', ellipsis: true,
            render: (_: any, r: any) => r.workName || r.workKind || '—',
          },
          { title: 'Часы', dataIndex: 'hours', width: 70, align: 'right' as const, render: (v: any) => Number(v).toFixed(1) },
          { title: 'Кол-во', dataIndex: 'quantity', width: 70, align: 'right' as const, render: (v: any) => Number(v || 1).toFixed(0) },
          ...(hasCost ? [{
            title: 'Стоимость', dataIndex: 'cost', width: 120, align: 'right' as const,
            render: (v: any, r: any) => Number(v) > 0
              ? <span style={{ fontWeight: 600, color: '#1677ff' }}>{Number(v).toLocaleString()} {r.currency}</span>
              : <span style={{ color: '#ccc' }}>—</span>,
          }] : []),
        ]}
      />
    </div>
  );
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editModalOpen, setEditModalOpen] = useState(false);

  const { data: report, isLoading } = useQuery({
    queryKey: ['reports-ref', id],
    queryFn: () => api.get(`/reports-ref/${id}`).then(r => r.data),
  });
  useDocumentTitle(report?.name);

  const { data: versions = [] } = useQuery({
    queryKey: ['reports-ref', id, 'versions'],
    queryFn: () => api.get(`/reports-ref/${id}/versions`).then(r => r.data),
  });

  const { data: statusHistory = [] } = useQuery({
    queryKey: ['reports-ref', id, 'status-history'],
    queryFn: () => api.get(`/reports-ref/${id}/status-history`).then(r => r.data),
  });

  const { data: relatedRequests = [] } = useQuery({
    queryKey: ['reports-ref', id, 'requests'],
    queryFn: () => api.get('/requests', { params: { reportId: id } }).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/reports-ref/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-ref'] });
      message.success('Удалено');
      navigate('/admin/reports-ref');
    },
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!report) return <Typography.Text type="secondary">Запись не найдена</Typography.Text>;

  const status = STATUS_OPTIONS[report.status] || { label: report.status, color: 'default' };
  const currentWork = relatedRequests.filter((r: any) => !['done', 'rejected', 'cancelled'].includes(r.status));
  const doneWork = relatedRequests.filter((r: any) => r.status === 'done');

  return (
    <div style={{ maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/reports-ref')}>Назад</Button>
          <Typography.Title level={4} style={{ margin: 0 }}>{report.name}</Typography.Title>
          <Tag color={status.color}>{status.label}</Tag>
        </Space>
        <Space>
          {report.pbiLink && (
            <Button icon={<LinkOutlined />} href={report.pbiLink} target="_blank">
              Открыть в Power BI
            </Button>
          )}
          <Button icon={<EditOutlined />} onClick={() => setEditModalOpen(true)}>
            Редактировать
          </Button>
          <Popconfirm
            title="Удалить дашборд?"
            description="Это действие нельзя отменить"
            okText="Удалить"
            okButtonProps={{ danger: true }}
            cancelText="Отмена"
            onConfirm={() => deleteMutation.mutate()}
          >
            <Button danger icon={<DeleteOutlined />} loading={deleteMutation.isPending}>Удалить</Button>
          </Popconfirm>
        </Space>
      </div>

      <Tabs
        items={[
          {
            key: 'overview',
            label: 'Обзор',
            children: (
      <Row gutter={16}>
        <Col span={17}>
        <Reveal>
        <Row gutter={16}>
        <Col span={24}>
          <Card title="Общие сведения" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Наименование" span={2}>{report.name}</Descriptions.Item>
              <Descriptions.Item label="Версия">{report.version || '—'}</Descriptions.Item>
              <Descriptions.Item label="Среда">{ENV_LABELS[report.environment] || report.environment || '—'}</Descriptions.Item>
              <Descriptions.Item label="Статус">
                <Tag color={status.color}>{status.label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Дата публикации">
                {report.publishedAt ? dayjs(report.publishedAt).format('DD.MM.YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Workspace Power BI" span={2}>{report.workspace || '—'}</Descriptions.Item>
              <Descriptions.Item label="Ссылка на отчёт" span={2}>
                {report.pbiLink
                  ? <a href={report.pbiLink} target="_blank" rel="noreferrer"><LinkOutlined style={{ marginRight: 4 }} />{formatPbiLink(report.pbiLink)}</a>
                  : '—'}
              </Descriptions.Item>
              {report.description && (
                <Descriptions.Item label="Описание / Назначение" span={2}>{report.description}</Descriptions.Item>
              )}
              {report.requestNumber && (
                <Descriptions.Item label="Источник (заявка)" span={2}>
                  <a href={`/requests/${report.requestNumber}`}>{report.requestNumber} — {report.requestName}</a>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="Владение и аудитория" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Владелец (бизнес)">{report.ownerName || report.owner || '—'}</Descriptions.Item>
              <Descriptions.Item label="Разработчик BI">{report.techOwner || '—'}</Descriptions.Item>
              <Descriptions.Item label="Владелец данных">{report.dataOwner || '—'}</Descriptions.Item>
              <Descriptions.Item label="Кол-во пользователей">{report.userCount ?? '—'}</Descriptions.Item>
              {report.targetAudience && (
                <Descriptions.Item label="Целевая аудитория">{report.targetAudience}</Descriptions.Item>
              )}
              {report.useCase && (
                <Descriptions.Item label="Сценарий использования">{report.useCase}</Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="Технические параметры" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small" bordered>
              {report.dataSource && (
                <Descriptions.Item label="Источники данных">{report.dataSource}</Descriptions.Item>
              )}
              <Descriptions.Item label="Частота обновления">{report.updateFrequency || '—'}</Descriptions.Item>
              <Descriptions.Item label="SLA обновления">
                {report.slaRefreshHours != null ? `${report.slaRefreshHours} ч` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Row-Level Security">
                <BoolTag value={!!report.hasRLS} />
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="Приёмка" size="small">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Чеклист тестирования">
                <BoolTag value={!!report.checklistDone} />
              </Descriptions.Item>
              <Descriptions.Item label="Протокол приёмки подписан">
                <BoolTag value={!!report.protocolSigned} />
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col span={24}>
          <Card
            title={<Space><HistoryOutlined style={{ color: '#1677ff' }} />История изменений ({versions.length})</Space>}
            size="small"
            style={{ marginBottom: 16 }}
          >
            {versions.length === 0 ? (
              <Typography.Text type="secondary">
                Пока нет записей. Версия фиксируется автоматически, когда заявка на разработку/доработку
                этого дашборда переходит в статус «Выполнена».
              </Typography.Text>
            ) : (
              <Table
                dataSource={versions}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  { title: 'Версия', dataIndex: 'version', width: 90, render: (v: string) => <Tag color="blue">{v || '—'}</Tag> },
                  { title: 'Дата', dataIndex: 'createdAt', width: 120, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
                  {
                    title: 'Заявка', dataIndex: 'requestNumber', width: 160,
                    render: (v: string, r: any) => v ? <a href={`/requests/${r.requestNumber}`}>{v} — {r.requestName}</a> : '—',
                  },
                  { title: 'Что изменилось', dataIndex: 'changeSummary', render: (v: string) => v || '—' },
                ]}
              />
            )}
          </Card>
        </Col>

        {statusHistory.length > 0 && (
          <Col span={24}>
            <Card
              title={<Space><HistoryOutlined style={{ color: '#fa8c16' }} />История смены статуса ({statusHistory.length})</Space>}
              size="small"
              style={{ marginBottom: 16 }}
            >
              <Table
                dataSource={statusHistory}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  { title: 'Дата', dataIndex: 'createdAt', width: 120, render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
                  {
                    title: 'Изменение', width: 220,
                    render: (_: any, r: any) => (
                      <Space size={6}>
                        <Tag color={(STATUS_OPTIONS[r.oldStatus] || {}).color || 'default'}>
                          {STATUS_OPTIONS[r.oldStatus]?.label || r.oldStatus}
                        </Tag>
                        →
                        <Tag color={(STATUS_OPTIONS[r.newStatus] || {}).color || 'default'}>
                          {STATUS_OPTIONS[r.newStatus]?.label || r.newStatus}
                        </Tag>
                      </Space>
                    ),
                  },
                  { title: 'Причина', dataIndex: 'reason' },
                  { title: 'Кто изменил', dataIndex: 'changedByName', width: 160, render: (v: string) => v || '—' },
                ]}
              />
            </Card>
          </Col>
        )}

        {report.dataSources?.length > 0 && (
          <Col span={24}>
            <Card
              title={<Space><DatabaseOutlined style={{ color: '#1677ff' }} />Источники данных ({report.dataSources.length})</Space>}
              size="small"
            >
              <Table
                dataSource={report.dataSources}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  { title: 'Код', dataIndex: 'code', width: 90, render: (v: string) => v ? <Tag>{v}</Tag> : '—' },
                  {
                    title: 'Название', dataIndex: 'name',
                    render: (v: string, r: any) => (
                      <Space>{DS_ICONS[r.type]}<span style={{ fontWeight: 500 }}>{v}</span></Space>
                    ),
                  },
                  {
                    title: 'Тип', dataIndex: 'type', width: 120,
                    render: (v: string) => <Tag color={DS_TYPE_COLORS[v]}>{DS_TYPE_LABELS[v] || v}</Tag>,
                  },
                  {
                    title: 'СУБД', dataIndex: 'dbEngine', width: 110,
                    render: (v: string) => v ? <Tag>{DB_LABELS[v] || v}</Tag> : '—',
                  },
                  {
                    title: 'Сервер / БД', width: 220,
                    render: (_: any, r: any) => {
                      const parts = [r.dbServer, r.dbName].filter(Boolean).join(' / ');
                      return parts || (r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a> : '—');
                    },
                  },
                  { title: 'Описание', dataIndex: 'description', render: (v: string) => v || '—' },
                ]}
              />
            </Card>
          </Col>
        )}
        </Row>
        </Reveal>
        </Col>

        <Col span={7}>
        <Reveal delay={0.08}>
          <Card
            title={<Space><ToolOutlined style={{ color: '#fa8c16' }} />Текущие работы ({currentWork.length})</Space>}
            size="small"
            style={{ marginBottom: 16 }}
          >
            {currentWork.length === 0 ? (
              <Empty description="Нет активных заявок" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {currentWork.map((r: any) => (
                  <div key={r.id}>
                    <Link to={`/requests/${r.number}`} style={{ fontSize: 13 }}>
                      {r.number} — {r.name}
                    </Link>
                    <div><Tag color={STATUS_COLORS[r.status]} style={{ marginTop: 2 }}>{STATUS_LABELS[r.status] || r.status}</Tag></div>
                  </div>
                ))}
              </Space>
            )}
          </Card>

          <Card
            title={<Space><CheckSquareOutlined style={{ color: '#52c41a' }} />Готово ({doneWork.length})</Space>}
            size="small"
          >
            {doneWork.length === 0 ? (
              <Empty description="Пока ничего не выполнено" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {doneWork.map((r: any) => (
                  <div key={r.id}>
                    <Link to={`/requests/${r.number}`} style={{ fontSize: 13 }}>
                      {r.number} — {r.name}
                    </Link>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                      {r.closedAt ? dayjs(r.closedAt).format('DD.MM.YYYY') : ''}
                    </div>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Reveal>
        </Col>
      </Row>
            ),
          },
          {
            key: 'time-entries',
            label: <span><ClockCircleOutlined style={{ marginRight: 6 }} />Трудозатраты</span>,
            children: <DashboardTimeEntriesTab reportId={Number(id)} />,
          },
        ]}
      />

      <ReportEditModal
        open={editModalOpen}
        editing={report}
        onClose={() => setEditModalOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['reports-ref', id] });
          qc.invalidateQueries({ queryKey: ['reports-ref', id, 'status-history'] });
        }}
      />
    </div>
  );
}
