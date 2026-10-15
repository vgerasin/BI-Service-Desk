import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, Select, Switch, Space, Typography,
  message, InputNumber, DatePicker, Tag, Tooltip, Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, HistoryOutlined, DeleteOutlined, LoginOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';

const CURRENCY_OPTIONS = ['RUB', 'USD', 'EUR', 'KZT', 'BYN'];

const TYPE_OPTIONS = [
  { value: 'external', label: 'Внешний' },
  { value: 'internal', label: 'Внутренний' },
];

function typeTag(type: string) {
  if (type === 'internal') return <Tag color="green">Внутренний</Tag>;
  if (type === 'external' || type === 'individual') return <Tag color="blue">Внешний</Tag>;
  if (type === 'organization') return <Tag color="blue">Внешний</Tag>;
  return <Tag color="default">—</Tag>;
}

export default function ContractorsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [rateModal, setRateModal] = useState<any>(null);
  const [form] = Form.useForm();
  const [rateForm] = Form.useForm();

  const { data = [], isLoading } = useQuery({
    queryKey: ['contractors'],
    queryFn: () => api.get('/contractors').then(r => r.data),
  });

  const { data: rates = [] } = useQuery({
    queryKey: ['contractor-rates', rateModal?.id],
    queryFn: () => api.get(`/contractors/${rateModal.id}/rates`).then(r => r.data),
    enabled: !!rateModal,
  });

  // Flat table becomes a two-level tree: top-level contractors (no parent) with their group's
  // members nested underneath — e.g. one external counterparty whose 3-4 people each log time
  // under their own contractor login (see Contractor.parentContractorId).
  const dataSource = data
    .filter((c: any) => !c.parentContractorId)
    .map((c: any) => {
      const children = data.filter((x: any) => x.parentContractorId === c.id);
      return children.length ? { ...c, children } : c;
    });

  const openEdit = (item: any) => {
    setEditing(item);
    form.setFieldsValue({
      ...item,
      rate: undefined,
      password: '',
      contractDate: item.contractDate ? dayjs(item.contractDate) : undefined,
    });
    setModal(true);
  };
  const openCreate = () => { setEditing(null); form.resetFields(); setModal(true); };

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing
      ? api.put(`/contractors/${editing.id}`, dto)
      : api.post('/contractors', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contractors'] });
      setModal(false);
      message.success('Сохранено');
    },
  });

  const addRateMutation = useMutation({
    mutationFn: (dto: any) => api.post(`/contractors/${rateModal.id}/rates`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contractor-rates', rateModal?.id] });
      qc.invalidateQueries({ queryKey: ['contractors'] });
      rateForm.resetFields();
      message.success('Ставка добавлена');
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: (rateId: number) => api.delete(`/contractors/rates/${rateId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contractor-rates', rateModal?.id] });
      qc.invalidateQueries({ queryKey: ['contractors'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/contractors/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contractors'] }); message.success('Подрядчик удалён'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка удаления'),
  });

  const columns = [
    {
      title: 'Наименование', dataIndex: 'name', width: 200, ellipsis: true,
      render: (v: string, r: any) => r.parentContractorId
        ? <span style={{ color: '#595959' }}>↳ {v}</span>
        : <span style={{ fontWeight: r.children?.length ? 600 : undefined }}>{v}</span>,
    },
    {
      title: 'Тип', dataIndex: 'type', width: 120,
      render: (v: string) => typeTag(v),
    },
    { title: 'Контакт', dataIndex: 'contact', width: 130, ellipsis: true },
    {
      title: 'Email', dataIndex: 'email', width: 180, ellipsis: true,
      render: (v: string) => v
        ? <a href={`mailto:${v}`} style={{ fontSize: 13 }}>{v}</a>
        : <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: 'Текущая ставка', width: 150,
      render: (_: any, r: any) => r.currentRate
        ? (
          <Tooltip title={r.rateSince ? `с ${dayjs(r.rateSince).format('DD.MM.YYYY')}` : undefined}>
            <span style={{ fontWeight: 600, color: '#1677ff' }}>
              {Number(r.currentRate).toLocaleString()} {r.currentCurrency || 'RUB'}/ч
            </span>
          </Tooltip>
        )
        : <Tag color="default">не задана</Tag>,
    },
    {
      title: 'Статус', dataIndex: 'isActive', width: 80,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Активен' : 'Неактивен'}</Tag>,
    },
    {
      title: 'Вход', width: 70,
      render: (_: any, r: any) => r.hasLogin
        ? <Tag color="green" icon={<LoginOutlined />}>Есть</Tag>
        : <Tag color="default">Нет</Tag>,
    },
    {
      title: '', width: 190,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Ред.</Button>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setRateModal(r)}>Ставки</Button>
          <Popconfirm title="Удалить подрядчика?" onConfirm={() => deleteMutation.mutate(r.id)} okText="Да" cancelText="Нет">
            <Button size="small" icon={<DeleteOutlined />} danger loading={deleteMutation.isPending} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Подрядчики</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
      </div>
      <Reveal>
      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        defaultExpandAllRows
      />
      </Reveal>

      {/* Create / Edit modal */}
      <Modal
        title={editing ? 'Редактировать подрядчика' : 'Новый подрядчик'}
        open={modal}
        onCancel={() => setModal(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => saveMutation.mutate({
            ...v,
            contractDate: v.contractDate ? v.contractDate.format('YYYY-MM-DD') : null,
          })}
        >
          <Form.Item name="name" label="Наименование" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="Тип">
            <Select allowClear placeholder="Выбрать тип">
              {TYPE_OPTIONS.map(o => (
                <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="parentContractorId"
            label="Головной подрядчик"
            extra="Если несколько человек работают под одним внешним контрагентом — укажите его здесь, они сгруппируются на странице и вместе подставятся в акт"
          >
            <Select allowClear showSearch optionFilterProp="label" placeholder="Не входит в группу">
              {data.filter((c: any) => c.id !== editing?.id && !c.parentContractorId).map((c: any) => (
                <Select.Option key={c.id} value={c.id} label={c.name}>{c.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="contact" label="Контакт">
            <Input placeholder="Телефон" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email (для входа и уведомлений)"
            rules={[{ type: 'email', message: 'Введите корректный email' }]}
          >
            <Input placeholder="executor@example.com" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? 'Пароль для входа (оставьте пустым, чтобы не менять)' : 'Пароль для входа'}
            rules={editing
              ? [{ validator: (_, v) => !v || v.length >= 6 ? Promise.resolve() : Promise.reject('Минимум 6 символов') }]
              : []
            }
          >
            <Input.Password placeholder="Минимум 6 символов" />
          </Form.Item>
          <Form.Item name="details" label="Реквизиты">
            <Input.TextArea rows={2} />
          </Form.Item>

          {/* Act generation block */}
          <div style={{
            background: '#f6f8fa', borderRadius: 6, padding: '12px 14px', marginBottom: 12,
            border: '1px solid #e6ebf1',
          }}>
            <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              Данные для актов приёма-передачи
            </Typography.Text>
            <Form.Item
              name="legalDesignation"
              label="Юридическая формулировка «Исполнителя»"
              tooltip="Например: «Плательщик налога на профессиональный доход Иванов Руслан Андреевич». Если не заполнено — используется наименование выше."
              style={{ marginBottom: 8 }}
            >
              <Input.TextArea rows={2} placeholder="Плательщик налога на профессиональный доход Иванов Руслан Андреевич" />
            </Form.Item>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="contractNumber" label="№ договора" style={{ marginBottom: 0, width: '40%' }}>
                <Input placeholder="б/н" />
              </Form.Item>
              <Form.Item name="contractDate" label="Дата договора" style={{ marginBottom: 0, width: '60%' }}>
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Дата договора" />
              </Form.Item>
            </Space.Compact>
          </div>

          {/* Rate block */}
          <div style={{
            background: '#f6f8fa', borderRadius: 6, padding: '12px 14px', marginBottom: 12,
            border: '1px solid #e6ebf1',
          }}>
            <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              {editing ? 'Добавить новую ставку' : 'Начальная ставка'}
            </Typography.Text>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="rate"
                style={{ marginBottom: 0, flex: 1 }}
                rules={editing ? [] : [{ required: true, message: 'Укажите ставку' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={100}
                  placeholder="Ставка (руб./ч)"
                  addonAfter={
                    <Form.Item name="currency" noStyle initialValue="RUB">
                      <Select style={{ width: 70 }}>
                        {CURRENCY_OPTIONS.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                      </Select>
                    </Form.Item>
                  }
                />
              </Form.Item>
            </Space.Compact>
            {editing && (
              <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                Заполните для добавления новой ставки с сегодняшней даты. Оставьте пустым, чтобы не менять.
              </Typography.Text>
            )}
          </div>

          {editing && (
            <Form.Item name="isActive" label="Активен" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Rate history modal */}
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            История ставок: {rateModal?.name}
          </Space>
        }
        open={!!rateModal}
        onCancel={() => setRateModal(null)}
        footer={null}
        width={580}
      >
        <Table
          dataSource={rates}
          rowKey="id"
          size="small"
          pagination={false}
          style={{ marginBottom: 16 }}
          columns={[
            {
              title: 'Ставка', dataIndex: 'rate', width: 130,
              render: (v: any, r: any) => (
                <span style={{ fontWeight: 600, color: '#1677ff' }}>
                  {Number(v).toLocaleString()} {r.currency}
                </span>
              ),
            },
            {
              title: 'С', dataIndex: 'dateFrom', width: 120,
              render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
            },
            {
              title: 'По', dataIndex: 'dateTo', width: 120,
              render: (v: string) => v ? dayjs(v).format('DD.MM.YYYY') : <Tag color="success">Текущая</Tag>,
            },
            {
              title: '', width: 80,
              render: (_: any, r: any) => (
                <Button
                  size="small"
                  danger
                  loading={deleteRateMutation.isPending}
                  onClick={() => deleteRateMutation.mutate(r.id)}
                >
                  Удалить
                </Button>
              ),
            },
          ]}
        />

        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
          Добавить ставку:
        </Typography.Text>
        <Form
          form={rateForm}
          layout="inline"
          onFinish={(v) => addRateMutation.mutate({
            ...v,
            dateFrom: v.dateFrom.format('YYYY-MM-DD'),
            dateTo: v.dateTo ? v.dateTo.format('YYYY-MM-DD') : undefined,
          })}
        >
          <Form.Item name="rate" rules={[{ required: true }]}>
            <InputNumber min={0} step={100} placeholder="Ставка" style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="currency" initialValue="RUB">
            <Select style={{ width: 70 }}>
              {CURRENCY_OPTIONS.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="dateFrom" rules={[{ required: true }]} initialValue={dayjs()}>
            <DatePicker placeholder="с" format="DD.MM.YYYY" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="dateTo">
            <DatePicker placeholder="по (необяз.)" format="DD.MM.YYYY" style={{ width: 130 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={addRateMutation.isPending}>
            Добавить
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
