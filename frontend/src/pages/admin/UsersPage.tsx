import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, Select, Switch, Tag, Space, Typography, message,
  InputNumber, DatePicker, Popconfirm, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import { UserRole, ROLE_LABELS, ROLE_COLORS } from '../../types';

const CONTRACTOR_TYPE_OPTIONS = [
  { value: 'external', label: 'Внешний' },
  { value: 'internal', label: 'Внутренний' },
];
const CURRENCY_OPTIONS = ['RUB', 'USD', 'EUR', 'KZT', 'BYN'];

export default function UsersPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [form] = Form.useForm();
  const watchedRole = Form.useWatch('role', form);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'], queryFn: () => api.get('/users').then(r => r.data),
  });

  // Looked up by email to prefill "Данные для актов" when editing an executor who already has
  // a linked Contractor record (see ContractorsService.upsertContractorForUser). This is also
  // the only place rates live now — the old per-user rate history (rate_history.userId) was
  // dead weight: an executor's own logged hours always resolve to their contractor, never their
  // user id (see time-entries.controller.ts), so a rate set there never actually applied.
  const { data: contractors = [] } = useQuery({
    queryKey: ['contractors'], queryFn: () => api.get('/contractors').then(r => r.data),
  });

  const openCreate = () => { setEditing(null); form.resetFields(); setModal(true); };
  const openEdit = (u: any) => {
    setEditing(u);
    const contractor = contractors.find((c: any) => c.email === u.email);
    form.setFieldsValue({
      ...u,
      password: '',
      contractorType: contractor?.type,
      contractorCurrency: contractor?.currentCurrency || contractor?.currency,
      legalDesignation: contractor?.legalDesignation,
      contractNumber: contractor?.contractNumber,
      contractDate: contractor?.contractDate ? dayjs(contractor.contractDate) : undefined,
    });
    setModal(true);
  };

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing ? api.put(`/users/${editing.id}`, dto) : api.post('/users', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['contractors'] });
      setModal(false);
      message.success('Сохранено');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); message.success('Пользователь удалён'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка удаления'),
  });

  const columns = [
    {
      title: 'Имя', dataIndex: 'fullName',
      sorter: (a: any, b: any) => a.fullName.localeCompare(b.fullName, 'ru'),
      defaultSortOrder: 'ascend' as const,
      render: (v: string, r: any) => (
        <Space size={4}>
          {v}
          {r.telegramChatId && (
            <Tooltip title="Telegram привязан">
              <Tag color="success" icon={<SendOutlined style={{ fontSize: 10 }} />} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', padding: '0 4px' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: 'Email', dataIndex: 'email' },
    {
      title: 'Роль', dataIndex: 'role',
      sorter: (a: any, b: any) => (ROLE_LABELS[a.role] || '').localeCompare(ROLE_LABELS[b.role] || '', 'ru'),
      render: (v: string) => <Tag color={ROLE_COLORS[v]}>{ROLE_LABELS[v]}</Tag>,
    },
    {
      // Compact + full text on hover, rather than either always truncating (illegible for long
      // titles like "Руководитель группы по управлению данными") or always wrapping (bloats
      // every row's height for the rare long title) — see chat: user asked for "more optimal".
      title: 'Должность', dataIndex: 'position', width: 150, ellipsis: true,
      render: (v: string) => v
        ? <Tooltip title={v}><span style={{ fontSize: 12 }}>{v}</span></Tooltip>
        : '—',
    },
    {
      title: 'Руководитель', dataIndex: 'managerId',
      render: (v: number) => users.find((u: any) => u.id === v)?.fullName || '—',
    },
    {
      title: 'Подчинённые',
      sorter: (a: any, b: any) =>
        users.filter((u: any) => u.managerId === a.id).length - users.filter((u: any) => u.managerId === b.id).length,
      render: (_: any, r: any) => {
        const subordinates = users.filter((u: any) => u.managerId === r.id);
        if (!subordinates.length) return '—';
        return (
          <Tooltip title={subordinates.map((s: any) => s.fullName).join(', ')}>
            <Tag color="blue">{subordinates.length}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Активен', dataIndex: 'isActive',
      sorter: (a: any, b: any) => Number(a.isActive) - Number(b.isActive),
      render: (v: boolean) => <Tag color={v ? 'success' : 'error'}>{v ? 'Да' : 'Нет'}</Tag>,
    },
    {
      title: 'Создан', dataIndex: 'createdAt',
      sorter: (a: any, b: any) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(),
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: '', render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Ред.</Button>
          <Popconfirm title="Удалить пользователя?" onConfirm={() => deleteMutation.mutate(r.id)} okText="Да" cancelText="Нет">
            <Button size="small" icon={<DeleteOutlined />} danger loading={deleteMutation.isPending} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const editingSubordinates = editing ? users.filter((u: any) => u.managerId === editing.id) : [];
  const filteredUsers = roleFilter ? users.filter((u: any) => u.role === roleFilter) : users;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Пользователи</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
      </div>
      <Select
        allowClear
        placeholder="Фильтр по роли"
        style={{ width: 200, marginBottom: 12 }}
        value={roleFilter}
        onChange={setRoleFilter}
        options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <Reveal>
      <Table dataSource={filteredUsers} columns={columns} rowKey="id" loading={isLoading} size="small" />
      </Reveal>

      <Modal title={editing ? 'Редактировать пользователя' : 'Новый пользователь'} open={modal}
        onCancel={() => setModal(false)} onOk={() => form.submit()} confirmLoading={saveMutation.isPending}
        width={editingSubordinates.length || watchedRole === UserRole.EXECUTOR ? 620 : undefined}>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => saveMutation.mutate(v.password ? v : { ...v, password: undefined, contractDate: v.contractDate ? v.contractDate.format('YYYY-MM-DD') : v.contractDate })}
        >
          <Form.Item name="fullName" label="ФИО" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: !editing, type: 'email' }]}><Input /></Form.Item>
          <Form.Item
            name="password"
            label={editing ? 'Новый пароль (необязательно)' : 'Пароль'}
            rules={editing
              ? [{ validator: (_, v) => !v || v.length >= 6 ? Promise.resolve() : Promise.reject('Минимум 6 символов') }]
              : [{ required: true, min: 6, message: 'Минимум 6 символов' }]
            }
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select>{Object.entries(ROLE_LABELS).map(([k, l]) => <Select.Option key={k} value={k}>{l}</Select.Option>)}</Select>
          </Form.Item>
          <Form.Item name="position" label="Должность"><Input /></Form.Item>
          <Form.Item
            name="managerId"
            label="Руководитель"
            extra="Подчинённые не видят затраты и не формируют акты — только их руководитель, за всю команду сразу"
          >
            <Select allowClear showSearch optionFilterProp="label" placeholder="Не назначен">
              {users.filter((u: any) => u.id !== editing?.id).map((u: any) => (
                <Select.Option key={u.id} value={u.id} label={u.fullName}>{u.fullName}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          {editingSubordinates.length > 0 && (
            <div style={{
              background: '#f6f8fa', borderRadius: 6, padding: '10px 14px', marginBottom: 16,
              border: '1px solid #e6ebf1',
            }}>
              <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                Подчинённые ({editingSubordinates.length})
              </Typography.Text>
              <Space size={[4, 4]} wrap>
                {editingSubordinates.map((s: any) => <Tag key={s.id}>{s.fullName}</Tag>)}
              </Space>
            </div>
          )}

          {watchedRole === UserRole.EXECUTOR && (
            <div style={{
              background: '#f6f8fa', borderRadius: 6, padding: '12px 14px', marginBottom: 12,
              border: '1px solid #e6ebf1',
            }}>
              <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                Данные для актов
              </Typography.Text>
              <Form.Item name="contractorType" label="Тип" style={{ marginBottom: 8 }}>
                <Select allowClear placeholder="Внутренний / внешний">
                  {CONTRACTOR_TYPE_OPTIONS.map(o => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
                </Select>
              </Form.Item>
              <Form.Item
                name="legalDesignation"
                label="Юридическая формулировка «Исполнителя»"
                tooltip="Например: «Плательщик налога на профессиональный доход Иванов Руслан Андреевич». Если не заполнено — используется ФИО выше."
                style={{ marginBottom: 8 }}
              >
                <Input.TextArea rows={2} />
              </Form.Item>
              <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
                <Form.Item name="contractNumber" label="№ договора" style={{ marginBottom: 0, width: '40%' }}>
                  <Input placeholder="б/н" />
                </Form.Item>
                <Form.Item name="contractDate" label="Дата договора" style={{ marginBottom: 0, width: '60%' }}>
                  <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
                </Form.Item>
              </Space.Compact>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                {editing ? 'Добавить новую ставку (с сегодняшней даты) — оставьте пустым, чтобы не менять' : 'Начальная ставка'}
              </Typography.Text>
              <Form.Item name="contractorRate" style={{ marginBottom: 0 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={100}
                  placeholder="Ставка (руб./ч)"
                  addonAfter={
                    <Form.Item name="contractorCurrency" noStyle initialValue="RUB">
                      <Select style={{ width: 70 }}>
                        {CURRENCY_OPTIONS.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                      </Select>
                    </Form.Item>
                  }
                />
              </Form.Item>
              {editing && (
                <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                  Полная история ставок — во вкладке «Подрядчики».
                </Typography.Text>
              )}
            </div>
          )}

          {editing && <Form.Item name="isActive" label="Активен" valuePropName="checked"><Switch /></Form.Item>}
        </Form>
      </Modal>
    </div>
  );
}
