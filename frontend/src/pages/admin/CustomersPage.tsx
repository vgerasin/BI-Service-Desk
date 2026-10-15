import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, Switch, Typography, message,
  Tag, Tooltip, Popconfirm,
} from 'antd';
import {
  PlusOutlined, EditOutlined, KeyOutlined, StopOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import Reveal from '../../components/Reveal';

function PortalAccessCell({ customer }: { customer: any }) {
  const qc = useQueryClient();

  const { data: info } = useQuery({
    queryKey: ['portal-info', customer.id],
    queryFn: () => api.get(`/customers/${customer.id}/portal-info`).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post(`/customers/${customer.id}/portal-access`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['portal-info', customer.id] });
      message.success(
        <span>Доступ создан. Пароль: <strong>{res.data.password}</strong> — выслан на {res.data.email}</span>,
        8
      );
    },
    onError: (err: any) => message.error(err.response?.data?.message || 'Ошибка'),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete(`/customers/${customer.id}/portal-access`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-info', customer.id] });
      message.success('Доступ отозван');
    },
  });

  if (!customer.email) {
    return <Tooltip title="Укажите email заказчика"><Tag color="default" style={{ cursor: 'default' }}>Нет email</Tag></Tooltip>;
  }

  if (!info) return null;

  if (!info.hasPortalAccess) {
    return (
      <Button
        size="small"
        icon={<KeyOutlined />}
        loading={createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        Создать доступ
      </Button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Tag color={info.portalIsActive ? 'green' : 'red'} icon={info.portalIsActive ? <CheckCircleOutlined /> : undefined}>
        {info.portalIsActive ? 'Активен' : 'Отозван'}
      </Tag>
      {info.portalIsActive ? (
        <Popconfirm
          title="Отозвать доступ?"
          description="Пользователь не сможет войти на портал"
          okText="Отозвать"
          okButtonProps={{ danger: true }}
          cancelText="Отмена"
          onConfirm={() => revokeMutation.mutate()}
        >
          <Tooltip title="Отозвать доступ">
            <Button size="small" danger icon={<StopOutlined />} loading={revokeMutation.isPending} />
          </Tooltip>
        </Popconfirm>
      ) : (
        <Tooltip title="Восстановить и выслать новый пароль">
          <Button
            size="small"
            icon={<KeyOutlined />}
            loading={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Сбросить пароль
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const { data = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers').then(r => r.data),
  });

  const openEdit = (item: any) => { setEditing(item); form.setFieldsValue(item); setModal(true); };
  const openCreate = () => { setEditing(null); form.resetFields(); setModal(true); };

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing ? api.put(`/customers/${editing.id}`, dto) : api.post('/customers', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setModal(false); message.success('Сохранено'); },
  });

  const columns = [
    { title: 'Подразделение', dataIndex: 'department' },
    { title: 'ФИО ответственного', dataIndex: 'responsible' },
    { title: 'Телефон', dataIndex: 'phone', width: 140 },
    { title: 'Email', dataIndex: 'email', width: 200 },
    {
      title: 'Портал', width: 200,
      render: (_: any, r: any) => <PortalAccessCell customer={r} />,
    },
    {
      title: '', width: 80,
      render: (_: any, r: any) =>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Ред.</Button>,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Заказчики / Подразделения</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
      </div>
      <Reveal>
      <Table dataSource={data} columns={columns} rowKey="id" loading={isLoading} size="small" />
      </Reveal>
      <Modal
        title={editing ? 'Редактировать' : 'Новый заказчик'}
        open={modal}
        onCancel={() => setModal(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
          <Form.Item name="department" label="Подразделение" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="responsible" label="ФИО ответственного" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phone" label="Контактный телефон"><Input /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Некорректный email' }]}>
            <Input />
          </Form.Item>
          {editing && <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>}
        </Form>
      </Modal>
    </div>
  );
}
