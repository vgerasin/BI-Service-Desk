import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Card, Descriptions, Tag, Skeleton, Alert, Statistic, Row, Col, Divider,
  Form, Input, Button, message, Space, Checkbox, Tabs, Table, Modal, Popconfirm,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, LinkOutlined,
  UserOutlined, TeamOutlined, GlobalOutlined, BellOutlined, SendOutlined, FileWordOutlined,
  IdcardOutlined, ClockCircleOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';
import { SsoCard, HrDirectoryCard, SmtpCard, DashboardRefreshCard } from './SettingsIntegrations';

interface ModuleSchedule {
  days: number[]; // 0=Вс, 1=Пн, ... 6=Сб
  time: string; // "HH:mm", МСК
}

interface TelegramModule {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  schedule: ModuleSchedule;
}

interface TelegramConfig {
  botToken: string;
  chatId: string;
  threadId: string;
  proxyUrl: string;
  proxyConfigured: boolean;
  modules: TelegramModule[];
}

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Пн' }, { value: 2, label: 'Вт' }, { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' }, { value: 5, label: 'Пт' }, { value: 6, label: 'Сб' }, { value: 0, label: 'Вс' },
];

function WeekdayPicker({ value = [], onChange }: { value?: number[]; onChange?: (v: number[]) => void }) {
  const toggle = (day: number) => {
    const next = value.includes(day) ? value.filter(d => d !== day) : [...value, day];
    onChange?.(next);
  };
  return (
    <Space size={4}>
      {WEEKDAYS.map(d => (
        <Tag.CheckableTag
          key={d.value}
          checked={value.includes(d.value)}
          onChange={() => toggle(d.value)}
          style={{ margin: 0 }}
        >
          {d.label}
        </Tag.CheckableTag>
      ))}
    </Space>
  );
}

function TelegramSettingsCard() {
  const qc = useQueryClient();
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery<TelegramConfig>({
    queryKey: ['telegram-config'],
    queryFn: () => api.get('/settings/telegram').then(r => r.data),
  });

  useEffect(() => {
    if (!data) return;
    const moduleValues: Record<string, boolean> = {};
    const scheduleValues: Record<string, ModuleSchedule> = {};
    data.modules.forEach(m => { moduleValues[m.id] = m.enabled; scheduleValues[m.id] = m.schedule; });
    form.setFieldsValue({
      botToken: data.botToken, chatId: data.chatId, threadId: data.threadId, proxyUrl: data.proxyUrl,
      modules: moduleValues, schedules: scheduleValues,
    });
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (dto: {
      botToken: string; chatId: string; threadId?: string; proxyUrl?: string;
      modules: Record<string, boolean>; schedules: Record<string, ModuleSchedule>;
    }) => api.post('/settings/telegram', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegram-config'] });
      message.success('Настройки Telegram сохранены');
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.post('/settings/telegram/test').then(r => r.data),
    onSuccess: (res: any) => {
      if (res.sent) message.success('Тестовое сообщение отправлено');
      else message.error(res.error || 'Не удалось отправить — проверьте токен и ID чата');
    },
  });

  const testModuleMutation = useMutation({
    mutationFn: (moduleId: string) => api.post(`/escalation/test/${moduleId}`).then(r => r.data),
    onSuccess: (res: { found: boolean; sent?: boolean; error?: string; preview?: boolean }) => {
      if (res.sent && res.preview) message.success('Отправлен пример (реальных совпадений сейчас нет) — проверьте чат');
      else if (res.sent) message.success('Отправлено — проверьте чат в Telegram');
      else message.error(res.error || 'Не удалось отправить');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка теста'),
  });

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BellOutlined style={{ color: '#1677ff' }} />
          Уведомления в Telegram
        </span>
      }
      extra={data && (
        data.proxyConfigured
          ? <Tag color="success" icon={<CheckCircleOutlined />}>Прокси настроен</Tag>
          : <Tag color="default">Прокси не настроен</Tag>
      )}
    >
      {isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            Токен бота получите у <code>@BotFather</code>, ID чата/группы — из ссылки на неё
            (например, <code>https://web.telegram.org/a/#-100XXXXXXXXXX</code> → ID это число после{' '}
            <code>#</code>, обычно со знаком «−»). Бот должен быть добавлен в группу и иметь право писать
            сообщения. Если группа — супергруппа и тест не проходит, попробуйте ID с префиксом{' '}
            <code>-100</code>.
            {!data?.proxyConfigured && (
              <> Если сервер не может достучаться до <code>api.telegram.org</code> напрямую (частая ситуация
              для РФ-хостинга) — нужен прокси, сейчас он не настроен.</>
            )}
          </Typography.Paragraph>
          <Form
            form={form}
            layout="vertical"
            onFinish={(v) => saveMutation.mutate(v)}
          >
            <Row gutter={12}>
              <Col span={14}>
                <Form.Item name="botToken" label="Токен бота">
                  <Input.Password placeholder="123456789:AA..." allowClear />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="chatId" label="ID чата / группы">
                  <Input placeholder="-1001234567890" allowClear />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="threadId"
              label="ID темы (топика)"
              extra="Заполните, если группа — форум с включёнными темами и нужно писать в конкретную тему, а не в «General». Число после «_» в ссылке на тему, например https://web.telegram.org/a/#-1002377016305_4305 → 4305. Оставьте пустым для General."
            >
              <Input placeholder="4305" allowClear style={{ maxWidth: 200 }} />
            </Form.Item>

            <Form.Item
              name="proxyUrl"
              label="Прокси для api.telegram.org"
              extra="Заполните, если сервер не может достучаться до api.telegram.org напрямую (частая ситуация для РФ-хостинга). Формат: http://user:pass@host:port"
            >
              <Input.Password placeholder="http://user:pass@host:port" allowClear />
            </Form.Item>

            <Divider style={{ margin: '4px 0 16px' }} />

            <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              Какие уведомления отправлять
            </Typography.Text>
            <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 20 }}>
              {(data?.modules ?? []).map(m => (
                <div key={m.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <Form.Item name={['modules', m.id]} valuePropName="checked" noStyle>
                      <Checkbox style={{ alignItems: 'flex-start' }}>
                        <div style={{ marginTop: -3 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{m.label}</div>
                          <div style={{ fontSize: 12, color: '#999' }}>{m.description}</div>
                        </div>
                      </Checkbox>
                    </Form.Item>
                    <Button
                      size="small"
                      icon={<SendOutlined />}
                      onClick={() => testModuleMutation.mutate(m.id)}
                      loading={testModuleMutation.isPending && testModuleMutation.variables === m.id}
                      style={{ flexShrink: 0 }}
                    >
                      Тестовая отправка
                    </Button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, paddingLeft: 24 }}>
                    <Form.Item name={['schedules', m.id, 'days']} noStyle>
                      <WeekdayPicker />
                    </Form.Item>
                    <Form.Item name={['schedules', m.id, 'time']} noStyle>
                      <Input type="time" size="small" style={{ width: 100 }} />
                    </Form.Item>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>МСК</Typography.Text>
                  </div>
                </div>
              ))}
            </Space>

            <Space>
              <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
                Сохранить
              </Button>
              <Button
                icon={<SendOutlined />}
                onClick={() => testMutation.mutate()}
                loading={testMutation.isPending}
              >
                Отправить тестовое сообщение
              </Button>
            </Space>
          </Form>
        </>
      )}
    </Card>
  );
}

interface BillingCompany {
  id: number;
  name: string;
  shortName: string | null;
  city: string | null;
  directorPosition: string | null;
  directorName: string | null;
  isDefault: boolean;
}

function BillingCompaniesCard() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BillingCompany | null>(null);

  const { data: companies = [], isLoading } = useQuery<BillingCompany[]>({
    queryKey: ['billing-companies'],
    queryFn: () => api.get('/billing-companies').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (dto: Partial<BillingCompany>) => editing
      ? api.put(`/billing-companies/${editing.id}`, dto)
      : api.post('/billing-companies', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-companies'] });
      setModalOpen(false);
      message.success(editing ? 'Юрлицо обновлено' : 'Юрлицо добавлено');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/billing-companies/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['billing-companies'] }); message.success('Юрлицо удалено'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось удалить'),
  });

  function openCreate() { setEditing(null); form.resetFields(); setModalOpen(true); }
  function openEdit(row: BillingCompany) { setEditing(row); form.setFieldsValue(row); setModalOpen(true); }

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileWordOutlined style={{ color: '#1677ff' }} />
          Юрлица-плательщики
        </span>
      }
      extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        Каждое юрлицо здесь — отдельная сторона «Заказчик» в актах приёма-передачи. Заявка (и
        дашборд, к которому она относится) привязывается к одному из них — исполнитель выбирает
        при взятии заявки в работу, если у неё ещё нет дашборда. По умолчанию новые заявки
        относятся к юрлицу, отмеченному «по умолчанию».
      </Typography.Paragraph>
      <Table
        dataSource={companies}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={false}
        columns={[
          {
            title: 'Краткое имя', dataIndex: 'shortName', width: 140,
            render: (v: string | null) => v || <span style={{ color: '#bbb' }}>—</span>,
          },
          {
            title: 'Название (как в акте)', dataIndex: 'name',
            render: (v: string, r: BillingCompany) => (
              <Space>
                {v}
                {r.isDefault && <Tag color="blue">по умолчанию</Tag>}
              </Space>
            ),
          },
          { title: 'Город', dataIndex: 'city', width: 120, render: (v: string | null) => v || '—' },
          { title: 'Подписант', dataIndex: 'directorName', render: (v: string | null) => v || '—' },
          {
            title: '', width: 90, align: 'center' as const,
            render: (_: any, r: BillingCompany) => (
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="Удалить юрлицо?" onConfirm={() => deleteMutation.mutate(r.id)} disabled={r.isDefault}>
                  <Button size="small" danger icon={<DeleteOutlined />} disabled={r.isDefault} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? 'Редактировать юрлицо' : 'Новое юрлицо'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} style={{ marginTop: 12 }}>
          <Form.Item name="name" label="Наименование (как в акте)" rules={[{ required: true, message: 'Укажите название' }]}>
            <Input placeholder="ООО «...»" />
          </Form.Item>
          <Form.Item
            name="shortName" label="Краткое имя (для списков и заявок)"
            rules={[{ required: true, message: 'Укажите краткое имя' }]}
          >
            <Input placeholder="Например: ООО «Ромашка»" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item name="city" label="Город">
                <Input placeholder="Город" />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="directorPosition" label="Должность подписанта">
                <Input placeholder="Генерального директора" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="directorName" label="ФИО подписанта (в родительном падеже)">
            <Input placeholder="Иванова Ивана Ивановича" />
          </Form.Item>
          <Form.Item name="isDefault" valuePropName="checked">
            <Checkbox>Юрлицо по умолчанию для новых заявок</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="analytics-glass" style={{ maxWidth: 760 }}>
      <Typography.Title level={4} style={{ margin: '0 0 24px' }}>
        Настройки системы
      </Typography.Title>

      <Tabs
        defaultActiveKey="sso"
        items={[
          { key: 'sso', label: 'Вход через SSO', children: <Reveal><SsoCard /></Reveal> },
          { key: 'hr-db', label: 'База сотрудников', children: <Reveal><HrDirectoryCard /></Reveal> },
          { key: 'smtp', label: 'Почта', children: <Reveal><SmtpCard /></Reveal> },
          { key: 'telegram', label: 'Telegram и прокси', children: <Reveal><TelegramSettingsCard /></Reveal> },
          {
            key: 'refresh',
            label: 'Мониторинг обновлений',
            children: <Reveal><DashboardRefreshCard /></Reveal>,
          },
          { key: 'act', label: 'Юрлица-плательщики', children: <Reveal><BillingCompaniesCard /></Reveal> },
        ]}
      />
    </div>
  );
}
