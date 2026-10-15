import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, Select, Switch, Tabs, Typography,
  Popconfirm, message, InputNumber, Card, Row, Col, Spin,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';

const DICT_TYPES = [
  { key: 'work_types', label: 'Типы работ' },
  { key: 'work_kinds', label: 'Виды работ' },
  { key: 'data_sources', label: 'Источники данных' },
];

const SLA_PRIORITIES = [
  { code: 'critical', label: 'Критический', color: '#ff4d4f' },
  { code: 'high', label: 'Высокий', color: '#fa8c16' },
  { code: 'medium', label: 'Средний', color: '#1677ff' },
  { code: 'low', label: 'Низкий', color: '#52c41a' },
];

function DictTab({ type }: { type: string }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [form] = Form.useForm();

  const { data = [] } = useQuery({
    queryKey: ['dict', type],
    queryFn: () => api.get('/dictionaries', { params: { type } }).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/dictionaries', { ...dto, type }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dict', type] }); setModal(false); form.resetFields(); message.success('Добавлено'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/dictionaries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dict', type] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: any) => api.put(`/dictionaries/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dict', type] }),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setModal(true)}>Добавить</Button>
      </div>
      <Reveal>
      <Table dataSource={data} rowKey="id" size="small" pagination={false}
        columns={[
          { title: 'Код', dataIndex: 'code', width: 150 },
          { title: 'Значение', dataIndex: 'value' },
          {
            title: 'Активен', dataIndex: 'isActive', width: 90,
            render: (v: boolean, r: any) => <Switch size="small" checked={v} onChange={(checked) => toggleMutation.mutate({ id: r.id, isActive: checked })} />,
          },
          {
            title: '', width: 60, render: (_: any, r: any) => (
              <Popconfirm title="Удалить?" onConfirm={() => deleteMutation.mutate(r.id)}>
                <Button size="small" icon={<DeleteOutlined />} danger />
              </Popconfirm>
            ),
          },
        ]}
      />
      </Reveal>
      <Modal title="Добавить значение" open={modal} onCancel={() => setModal(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)}>
          <Form.Item name="code" label="Код (латиницей)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="value" label="Отображаемое значение" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function SlaTab() {
  const qc = useQueryClient();

  const { data: slaData = [], isLoading } = useQuery({
    queryKey: ['dict', 'sla_days'],
    queryFn: () => api.get('/dictionaries', { params: { type: 'sla_days' } }).then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) =>
      api.put(`/dictionaries/${id}`, { value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dict', 'sla_days'] });
      message.success('SLA обновлён');
    },
  });

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/dictionaries', { ...dto, type: 'sla_days' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dict', 'sla_days'] }),
  });

  if (isLoading) return <Spin />;

  const handleSave = (priority: { code: string; label: string }, days: number) => {
    const existing = (slaData as any[]).find(d => d.code === priority.code);
    if (existing) {
      updateMutation.mutate({ id: existing.id, value: String(days) });
    } else {
      createMutation.mutate({ code: priority.code, value: String(days) });
    }
  };

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Плановый срок выполнения (дней) по приоритету. При создании заявки, если не указан срок, он рассчитывается автоматически.
      </Typography.Paragraph>
      <Row gutter={[16, 16]}>
        {SLA_PRIORITIES.map(priority => {
          const existing = (slaData as any[]).find(d => d.code === priority.code);
          const currentDays = existing ? parseInt(existing.value, 10) : 0;

          return (
            <Col key={priority.code} xs={24} sm={12} md={6}>
              <Card
                size="small"
                title={<span style={{ color: priority.color }}>{priority.label}</span>}
                style={{ borderTop: `3px solid ${priority.color}` }}
              >
                <Form
                  layout="vertical"
                  initialValues={{ days: currentDays }}
                  onFinish={(v) => handleSave(priority, v.days)}
                >
                  <Form.Item name="days" label="Дней SLA" rules={[{ required: true, type: 'number', min: 1 }]}>
                    <InputNumber style={{ width: '100%' }} min={1} max={365} />
                  </Form.Item>
                  <Button
                    type="primary" size="small" htmlType="submit" icon={<SaveOutlined />}
                    loading={updateMutation.isPending || createMutation.isPending}
                  >
                    Сохранить
                  </Button>
                </Form>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}

export default function DictionariesPage() {
  const allTabs = [
    ...DICT_TYPES.map(d => ({ key: d.key, label: d.label, children: <DictTab type={d.key} /> })),
    { key: 'sla', label: 'SLA по приоритетам', children: <SlaTab /> },
  ];

  return (
    <div className="analytics-glass">
      <Typography.Title level={4}>Справочники</Typography.Title>
      <Tabs items={allTabs} size="large" />
    </div>
  );
}
