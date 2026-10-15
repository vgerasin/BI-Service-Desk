import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Modal, Form, Input, Select, Tag, Space,
  Typography, Popconfirm, message, Drawer, Descriptions, Badge,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, BugOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';

const STATUS_OPTS = [
  { value: 'open', label: 'Открыта', color: 'red' },
  { value: 'in_progress', label: 'В работе', color: 'orange' },
  { value: 'resolved', label: 'Решена', color: 'green' },
  { value: 'wont_fix', label: 'Не исправляем', color: 'default' },
];

const PRIORITY_OPTS = [
  { value: 'critical', label: 'Критический', color: '#ff4d4f' },
  { value: 'high', label: 'Высокий', color: '#fa8c16' },
  { value: 'medium', label: 'Средний', color: '#1677ff' },
  { value: 'low', label: 'Низкий', color: '#8c8c8c' },
];

function statusColor(s: string) {
  return STATUS_OPTS.find(o => o.value === s)?.color || 'default';
}
function statusLabel(s: string) {
  return STATUS_OPTS.find(o => o.value === s)?.label || s;
}
function priorityLabel(s: string) {
  return PRIORITY_OPTS.find(o => o.value === s)?.label || s;
}
function priorityColor(s: string) {
  return PRIORITY_OPTS.find(o => o.value === s)?.color || '#bbb';
}

export default function KnownErrorsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['known-errors', filterStatus, search],
    queryFn: () => api.get('/known-errors', { params: { status: filterStatus, search: search || undefined } }).then(r => r.data),
  });

  const { data: linkedRequests = [] } = useQuery({
    queryKey: ['known-error-requests', viewing?.id],
    queryFn: () => api.get(`/known-errors/${viewing.id}/requests`).then(r => r.data),
    enabled: !!viewing?.id,
  });

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/known-errors', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['known-errors'] }); closeModal(); message.success('Создана'); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: any) => api.put(`/known-errors/${id}`, dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['known-errors'] }); closeModal(); message.success('Обновлена'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/known-errors/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['known-errors'] }); message.success('Удалена'); },
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(rec: any) {
    setEditing(rec);
    form.setFieldsValue(rec);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  }

  function onSubmit(values: any) {
    if (editing) {
      updateMutation.mutate({ id: editing.id, dto: values });
    } else {
      createMutation.mutate(values);
    }
  }

  const columns = [
    {
      title: 'ID', dataIndex: 'id', width: 60, align: 'center' as const,
      render: (v: number) => <span style={{ fontSize: 12, color: '#aaa' }}>#{v}</span>,
    },
    {
      title: 'Название', dataIndex: 'title', ellipsis: true,
      render: (v: string, r: any) => (
        <Button type="link" size="small" style={{ padding: 0, textAlign: 'left' }} onClick={() => setViewing(r)}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Приоритет', dataIndex: 'priority', width: 110,
      render: (v: string) => v ? (
        <span style={{ fontSize: 12, fontWeight: 600, color: priorityColor(v) }}>{priorityLabel(v)}</span>
      ) : '—',
    },
    {
      title: 'Статус', dataIndex: 'status', width: 130,
      render: (v: string) => <Tag color={statusColor(v)}>{statusLabel(v)}</Tag>,
    },
    {
      title: 'Симптомы', dataIndex: 'symptoms', ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12, color: '#666' }}>{v || '—'}</span>,
    },
    {
      title: 'Создана', dataIndex: 'createdAt', width: 100,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: '', width: 90, align: 'center' as const,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setViewing(r)} />
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="Удалить запись?" onConfirm={() => deleteMutation.mutate(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const openCount = (items as any[]).filter(i => i.status === 'open' || i.status === 'in_progress').length;

  return (
    <div className="analytics-glass">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <BugOutlined style={{ marginRight: 8, color: '#ff4d4f' }} />
          База известных ошибок
        </Typography.Title>
        {openCount > 0 && (
          <Badge count={openCount} style={{ background: '#ff4d4f' }} />
        )}
        <div style={{ flex: 1 }} />
        <Input.Search
          placeholder="Поиск..."
          style={{ width: 220 }}
          allowClear
          onSearch={setSearch}
          onChange={e => !e.target.value && setSearch('')}
        />
        <Select
          placeholder="Все статусы"
          allowClear
          style={{ width: 160 }}
          options={STATUS_OPTS}
          value={filterStatus}
          onChange={setFilterStatus}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Добавить ошибку
        </Button>
      </div>

      <Reveal>
      <Card>
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={{ pageSize: 20 }}
        />
      </Card>
      </Reveal>

      {/* Create/Edit Modal */}
      <Modal
        title={editing ? 'Редактировать ошибку' : 'Новая известная ошибка'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText={editing ? 'Сохранить' : 'Создать'}
        width={680}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} style={{ marginTop: 12 }}>
          <Form.Item name="title" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
            <Input placeholder="Краткое описание ошибки" />
          </Form.Item>
          <Form.Item name="symptoms" label="Симптомы">
            <Input.TextArea rows={3} placeholder="Как проявляется ошибка" />
          </Form.Item>
          <Form.Item name="workaround" label="Обходное решение">
            <Input.TextArea rows={3} placeholder="Как работать в обход ошибки" />
          </Form.Item>
          <Form.Item name="rootCause" label="Корневая причина">
            <Input.TextArea rows={2} placeholder="Техническая причина" />
          </Form.Item>
          <Form.Item name="affectedReports" label="Затронутые дашборды / отчёты">
            <Input placeholder="Перечислите через запятую" />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="status" label="Статус" style={{ flex: 1 }} initialValue="open">
              <Select options={STATUS_OPTS} />
            </Form.Item>
            <Form.Item name="priority" label="Приоритет" style={{ flex: 1 }}>
              <Select options={PRIORITY_OPTS} placeholder="Выберите" allowClear />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* View Drawer */}
      <Drawer
        title={viewing?.title}
        open={!!viewing}
        onClose={() => setViewing(null)}
        width={560}
        extra={
          <Button icon={<EditOutlined />} size="small" onClick={() => { openEdit(viewing); setViewing(null); }}>
            Редактировать
          </Button>
        }
      >
        {viewing && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color={statusColor(viewing.status)}>{statusLabel(viewing.status)}</Tag>
              {viewing.priority && (
                <span style={{ fontSize: 12, fontWeight: 600, color: priorityColor(viewing.priority) }}>
                  {priorityLabel(viewing.priority)}
                </span>
              )}
            </div>

            <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Симптомы">{viewing.symptoms || '—'}</Descriptions.Item>
              <Descriptions.Item label="Обходное решение">{viewing.workaround || '—'}</Descriptions.Item>
              <Descriptions.Item label="Корневая причина">{viewing.rootCause || '—'}</Descriptions.Item>
              <Descriptions.Item label="Затронутые дашборды">{viewing.affectedReports || '—'}</Descriptions.Item>
              <Descriptions.Item label="Создана">{dayjs(viewing.createdAt).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
              {viewing.resolvedAt && (
                <Descriptions.Item label="Решена">{dayjs(viewing.resolvedAt).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
              )}
            </Descriptions>

            {linkedRequests.length > 0 && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 600 }}>
                  Связанные заявки ({linkedRequests.length})
                </Typography.Text>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(linkedRequests as any[]).map((r: any) => (
                    <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', background: '#fafafa', borderRadius: 6 }}>
                      <span style={{ fontSize: 11, color: '#1677ff', fontWeight: 700 }}>{r.number}</span>
                      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <Tag style={{ marginLeft: 'auto' }}>{r.status}</Tag>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
