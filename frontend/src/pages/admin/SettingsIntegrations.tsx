import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select,
  Skeleton, Space, Statistic, Switch, Tag, Typography, message,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, CopyOutlined, IdcardOutlined, LinkOutlined, MailOutlined,
  SendOutlined, SyncOutlined, ApiOutlined, KeyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api/client';

const { Text, Paragraph } = Typography;
const SECRET_PLACEHOLDER = 'Сохранён — оставьте пустым, чтобы не менять';

const cardTitle = (icon: React.ReactNode, text: string) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ color: '#1677ff' }}>{icon}</span>{text}
  </span>
);

const copy = (text: string) =>
  navigator.clipboard?.writeText(text).then(() => message.success('Скопировано'), () => message.error('Не удалось скопировать'));

/* ═══════════════════════════ SSO ═══════════════════════════ */

interface SsoForm {
  enabled: boolean; label: string; authorizeUrl: string; tokenUrl: string; userinfoUrl: string;
  clientId: string; clientSecret?: string; scope: string; tokenAuth: 'body' | 'basic'; userinfoScheme: string;
  defaultRole: 'customer' | 'executor';
  map: { id: string; email: string; fullName: string; firstName: string; lastName: string; middleName: string; position: string };
  hasClientSecret?: boolean; configured?: boolean; linkedUsers?: number; totalUsers?: number;
}

const OIDC_PRESET = {
  scope: 'openid profile email', tokenAuth: 'body', userinfoScheme: 'Bearer',
  map: { id: 'sub', email: 'email', fullName: 'name', firstName: 'given_name', lastName: 'family_name', middleName: '', position: '' },
};

export function SsoCard() {
  const qc = useQueryClient();
  const [form] = Form.useForm<SsoForm>();
  const redirectUri = `${window.location.origin}/auth/callback`;

  const { data, isLoading, isError } = useQuery<SsoForm>({
    queryKey: ['settings-sso'],
    queryFn: () => api.get('/settings/sso').then(r => r.data),
  });
  useEffect(() => { if (data) form.setFieldsValue({ ...data, clientSecret: '' }); }, [data, form]);

  const save = useMutation({
    mutationFn: (v: SsoForm) => api.put('/settings/sso', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-sso'] });
      qc.invalidateQueries({ queryKey: ['sso-config'] });
      message.success('Настройки SSO сохранены');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось сохранить'),
  });

  const linkedPct = data && data.totalUsers ? Math.round(((data.linkedUsers ?? 0) / data.totalUsers) * 100) : 0;

  return (
    <Card title={cardTitle(<LinkOutlined />, 'Вход через SSO (OAuth 2.0)')}>
      {isLoading && <Skeleton active paragraph={{ rows: 6 }} />}
      {isError && <Alert type="error" showIcon message="Не удалось загрузить настройки SSO" />}
      {data && (
        <>
          <Alert
            type={data.enabled && data.configured ? 'success' : 'info'}
            showIcon
            icon={data.enabled && data.configured ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            style={{ marginBottom: 16 }}
            message={data.enabled && data.configured
              ? 'SSO включён — на странице входа показана кнопка'
              : 'SSO выключен. Без него вход возможен только по email и паролю.'}
            description={
              <span>
                Подходит любой провайдер с потоком «authorization code» (Keycloak, Authentik, Azure AD, Google и т. п.).
                В настройках провайдера зарегистрируйте адрес возврата: <Text code>{redirectUri}</Text>{' '}
                <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => copy(redirectUri)} />
              </span>
            }
          />

          <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
            <Form.Item name="enabled" label="Включить вход через SSO" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="label" label="Текст кнопки на странице входа">
              <Input placeholder="Войти через SSO" />
            </Form.Item>
            <Form.Item name="authorizeUrl" label="Authorization URL" extra="Куда отправляется пользователь для входа">
              <Input placeholder="https://sso.example.com/oauth/authorize" />
            </Form.Item>
            <Form.Item name="tokenUrl" label="Token URL" extra="Сервер обменивает полученный код на токен (запрос идёт с сервера приложения)">
              <Input placeholder="https://sso.example.com/oauth/token" />
            </Form.Item>
            <Form.Item name="userinfoUrl" label="UserInfo URL" extra="Возвращает JSON с профилем пользователя по токену">
              <Input placeholder="https://sso.example.com/oauth/userinfo" />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="clientId" label="Client ID"><Input autoComplete="off" /></Form.Item></Col>
              <Col span={12}>
                <Form.Item name="clientSecret" label="Client Secret" extra="Хранится в базе в зашифрованном виде">
                  <Input.Password autoComplete="new-password" placeholder={data.hasClientSecret ? SECRET_PLACEHOLDER : ''} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}><Form.Item name="scope" label="Scope"><Input placeholder="openid profile email" /></Form.Item></Col>
              <Col span={8}>
                <Form.Item name="tokenAuth" label="Client-аутентификация на Token URL">
                  <Select options={[
                    { value: 'body', label: 'Поля client_id / client_secret в теле' },
                    { value: 'basic', label: 'HTTP Basic' },
                  ]} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="userinfoScheme" label="Схема заголовка Authorization" extra="Bearer — стандарт; у некоторых провайдеров JWT">
                  <Select showSearch options={[{ value: 'Bearer' }, { value: 'JWT' }, { value: 'Token' }]} />
                </Form.Item>
              </Col>
            </Row>

            <Card
              size="small" style={{ marginBottom: 16, background: '#fafafa' }}
              title="Соответствие полей профиля"
              extra={<Button size="small" onClick={() => form.setFieldsValue(OIDC_PRESET as any)}>Стандартный OIDC</Button>}
            >
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                Путь к значению в JSON ответа UserInfo; вложенные поля через точку, например <Text code>data.user.email</Text>.
                Имя можно взять целиком (поле «ФИО») или собрать из частей.
              </Paragraph>
              <Row gutter={12}>
                <Col span={8}><Form.Item name={['map', 'id']} label="ID пользователя (обязательно)"><Input placeholder="sub" /></Form.Item></Col>
                <Col span={8}><Form.Item name={['map', 'email']} label="Email"><Input placeholder="email" /></Form.Item></Col>
                <Col span={8}><Form.Item name={['map', 'position']} label="Должность"><Input placeholder="(необязательно)" /></Form.Item></Col>
                <Col span={8}><Form.Item name={['map', 'fullName']} label="ФИО целиком"><Input placeholder="name" /></Form.Item></Col>
                <Col span={8}><Form.Item name={['map', 'lastName']} label="Фамилия"><Input placeholder="family_name" /></Form.Item></Col>
                <Col span={8}><Form.Item name={['map', 'firstName']} label="Имя"><Input placeholder="given_name" /></Form.Item></Col>
                <Col span={8}><Form.Item name={['map', 'middleName']} label="Отчество"><Input placeholder="(необязательно)" /></Form.Item></Col>
              </Row>
            </Card>

            <Form.Item
              name="defaultRole" label="Роль нового пользователя при первом входе"
              extra="Роль можно изменить позже в разделе «Команда». Email из переменной ADMIN_EMAIL всегда получает роль администратора."
            >
              <Select style={{ maxWidth: 320 }} options={[
                { value: 'customer', label: 'Заказчик (портал заявок)' },
                { value: 'executor', label: 'Исполнитель' },
              ]} />
            </Form.Item>

            <Button type="primary" htmlType="submit" loading={save.isPending}>Сохранить</Button>
          </Form>

          <Row gutter={16} style={{ marginTop: 24 }}>
            <Col span={8}><Card size="small" style={{ textAlign: 'center', background: '#fafafa' }}><Statistic title="Всего пользователей" value={data.totalUsers} /></Card></Col>
            <Col span={8}><Card size="small" style={{ textAlign: 'center', background: '#fafafa' }}><Statistic title="Привязаны к SSO" value={data.linkedUsers} valueStyle={{ color: '#52c41a' }} /></Card></Col>
            <Col span={8}><Card size="small" style={{ textAlign: 'center', background: '#fafafa' }}><Statistic title="Охват SSO" value={linkedPct} suffix="%" /></Card></Col>
          </Row>
        </>
      )}
    </Card>
  );
}

/* ═══════════════════ Employee directory (HR) ═══════════════════ */

interface HrForm {
  enabled: boolean; host: string; port: number; database: string; user: string; password?: string; ssl: boolean; hasPassword?: boolean;
}
interface HrStatus { enabled: boolean; connected: boolean; totalActive?: number; lastSync?: string | null; error?: string }

export function HrDirectoryCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<HrForm>();

  const { data, isLoading } = useQuery<HrForm>({
    queryKey: ['settings-hr'],
    queryFn: () => api.get('/settings/hr-directory').then(r => r.data),
  });
  const { data: status } = useQuery<HrStatus>({
    queryKey: ['hr-db-status'],
    queryFn: () => api.get('/admin/employees/status').then(r => r.data),
  });
  useEffect(() => { if (data) form.setFieldsValue({ ...data, password: '' }); }, [data, form]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settings-hr'] });
    qc.invalidateQueries({ queryKey: ['hr-db-status'] });
    qc.invalidateQueries({ queryKey: ['features'] });
  };
  const save = useMutation({
    mutationFn: (v: HrForm) => api.put('/settings/hr-directory', v),
    onSuccess: () => { refresh(); message.success('Настройки сохранены'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось сохранить'),
  });
  const test = useMutation({
    mutationFn: () => api.post('/admin/employees/test-connection', form.getFieldsValue()).then(r => r.data),
    onSuccess: (r: { ok: boolean; error?: string; missingTables?: string[] }) => {
      if (!r.ok) message.error(`Не удалось подключиться: ${r.error}`);
      else if (r.missingTables?.length) message.warning(`Подключение есть, но нет таблиц: ${r.missingTables.join(', ')}`);
      else message.success('Подключение успешно, нужные таблицы найдены');
    },
  });

  return (
    <Card title={cardTitle(<IdcardOutlined />, 'База сотрудников (необязательно)')}>
      {isLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : (
        <>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            Подключение к внешней базе PostgreSQL со справочником сотрудников. Если включено, в системе появляются вкладка
            «Сотрудники» (оргструктура), выбор заявителя «от имени другого сотрудника» и группировка оценок по подразделениям.
            Нужны таблицы <Text code>Sotrudniki</Text> и <Text code>OrgStructure</Text> — формат описан в <Text code>docs/hr-directory.md</Text>.
            Доступ достаточно выдать только на чтение.
          </Paragraph>

          {data?.enabled && status && (
            <Alert
              style={{ marginBottom: 16 }}
              type={status.connected ? 'success' : 'error'}
              showIcon
              icon={status.connected ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              message={status.connected ? 'База сотрудников подключена' : 'Нет соединения с базой сотрудников'}
              description={status.connected
                ? <span>Сотрудников с email: <b>{status.totalActive}</b>
                  {status.lastSync && <> · последняя синхронизация: {dayjs(status.lastSync).format('DD.MM.YYYY HH:mm')}</>}</span>
                : status.error}
            />
          )}

          <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
            <Form.Item name="enabled" label="Включить" valuePropName="checked"><Switch /></Form.Item>
            <Row gutter={12}>
              <Col span={16}><Form.Item name="host" label="Хост"><Input placeholder="db.example.com" /></Form.Item></Col>
              <Col span={8}><Form.Item name="port" label="Порт"><InputNumber style={{ width: '100%' }} min={1} max={65535} /></Form.Item></Col>
            </Row>
            <Form.Item name="database" label="Имя базы"><Input placeholder="hr" /></Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="user" label="Пользователь"><Input autoComplete="off" /></Form.Item></Col>
              <Col span={12}>
                <Form.Item name="password" label="Пароль" extra="Хранится в базе в зашифрованном виде">
                  <Input.Password autoComplete="new-password" placeholder={data?.hasPassword ? SECRET_PLACEHOLDER : ''} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="ssl" label="Шифровать соединение (SSL)" valuePropName="checked"><Switch /></Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={save.isPending}>Сохранить</Button>
              <Button icon={<ApiOutlined />} onClick={() => test.mutate()} loading={test.isPending}>Проверить подключение</Button>
              {status?.connected && (
                <Button icon={<IdcardOutlined />} onClick={() => navigate('/admin/team?tab=employees')}>Открыть справочник</Button>
              )}
            </Space>
          </Form>
        </>
      )}
    </Card>
  );
}

/* ═══════════════════════════ SMTP ═══════════════════════════ */

interface SmtpForm {
  host: string; port: number; secure: 'none' | 'starttls' | 'ssl'; user: string; password?: string; from: string;
  rejectUnauthorized: boolean; hasPassword?: boolean;
}

export function SmtpCard() {
  const qc = useQueryClient();
  const [form] = Form.useForm<SmtpForm>();
  const [testTo, setTestTo] = useState('');

  const { data, isLoading } = useQuery<SmtpForm>({
    queryKey: ['settings-smtp'],
    queryFn: () => api.get('/settings/smtp').then(r => r.data),
  });
  useEffect(() => { if (data) form.setFieldsValue({ ...data, password: '' }); }, [data, form]);

  const save = useMutation({
    mutationFn: (v: SmtpForm) => api.put('/settings/smtp', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-smtp'] }); message.success('Настройки почты сохранены'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось сохранить'),
  });
  const test = useMutation({
    mutationFn: () => api.post('/settings/smtp/test', { to: testTo }).then(r => r.data),
    onSuccess: (r: { sent: boolean; error?: string }) =>
      r.sent ? message.success('Тестовое письмо отправлено') : message.error(r.error || 'Не удалось отправить'),
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось отправить'),
  });

  return (
    <Card title={cardTitle(<MailOutlined />, 'Почта (SMTP)')}>
      {isLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : (
        <>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            Через этот сервер уходят email-уведомления по заявкам и письма восстановления пароля.
            Пока хост не указан, письма не отправляются (в журнале сервера остаётся запись).
          </Paragraph>
          <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="host" label="SMTP-сервер"><Input placeholder="smtp.example.com" /></Form.Item></Col>
              <Col span={6}><Form.Item name="port" label="Порт"><InputNumber style={{ width: '100%' }} min={1} max={65535} /></Form.Item></Col>
              <Col span={6}>
                <Form.Item name="secure" label="Шифрование">
                  <Select options={[
                    { value: 'starttls', label: 'STARTTLS (587)' },
                    { value: 'ssl', label: 'SSL/TLS (465)' },
                    { value: 'none', label: 'Без шифрования (25)' },
                  ]} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="user" label="Логин"><Input autoComplete="off" /></Form.Item></Col>
              <Col span={12}>
                <Form.Item name="password" label="Пароль" extra="Хранится в базе в зашифрованном виде">
                  <Input.Password autoComplete="new-password" placeholder={data?.hasPassword ? SECRET_PLACEHOLDER : ''} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="from" label="Отправитель (From)" extra="Например: BI Service Desk <noreply@example.com>. Пусто — будет использован логин.">
              <Input placeholder='"BI Service Desk" <noreply@example.com>' />
            </Form.Item>
            <Form.Item
              name="rejectUnauthorized" label="Проверять TLS-сертификат сервера" valuePropName="checked"
              extra="Отключайте только для внутреннего сервера с самоподписанным сертификатом"
            >
              <Switch />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={save.isPending}>Сохранить</Button>
          </Form>

          <div style={{ marginTop: 24 }}>
            <Text strong style={{ fontSize: 13 }}>Проверка отправки</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: '2px 0 8px' }}>Сначала сохраните настройки, затем отправьте тестовое письмо.</Paragraph>
            <Space.Compact style={{ width: '100%', maxWidth: 420 }}>
              <Input placeholder="you@example.com" value={testTo} onChange={e => setTestTo(e.target.value)} onPressEnter={() => test.mutate()} />
              <Button icon={<SendOutlined />} onClick={() => test.mutate()} loading={test.isPending} disabled={!testTo}>Отправить</Button>
            </Space.Compact>
          </div>
        </>
      )}
    </Card>
  );
}

/* ═════════════ Dashboard refresh monitoring (external feed) ═════════════ */

interface RefreshForm { enabled: boolean; checkTime: string; timezone: string; hasSecret?: boolean }

export function DashboardRefreshCard() {
  const qc = useQueryClient();
  const [form] = Form.useForm<RefreshForm>();
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const ingestUrl = `${window.location.origin}/api/dashboard-refresh-logs/ingest`;

  const { data, isLoading } = useQuery<RefreshForm>({
    queryKey: ['settings-refresh'],
    queryFn: () => api.get('/settings/dashboard-refresh').then(r => r.data),
  });
  useEffect(() => { if (data) form.setFieldsValue(data); }, [data, form]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settings-refresh'] });
    qc.invalidateQueries({ queryKey: ['features'] });
  };
  const save = useMutation({
    mutationFn: (v: RefreshForm) => api.put('/settings/dashboard-refresh', v),
    onSuccess: () => { refresh(); message.success('Настройки сохранены'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось сохранить'),
  });
  const rotate = useMutation({
    mutationFn: () => api.post('/settings/dashboard-refresh/rotate-secret').then(r => r.data),
    onSuccess: (r: { secret: string }) => { setNewSecret(r.secret); refresh(); },
  });

  const example = `curl -X POST '${ingestUrl}' \\
  -H 'x-log-secret: <секрет>' -H 'Content-Type: application/json' \\
  -d '[{"reportName": "Продажи — ежедневный отчёт", "lastStatus": "Data Refresh failed"}]'`;

  return (
    <Card title={cardTitle(<SyncOutlined />, 'Мониторинг обновления дашбордов (необязательно)')}>
      {isLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : (
        <>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            Внешний процесс (n8n, cron, любой скрипт) раз в сутки присылает сюда список дашбордов, у которых не прошло плановое
            обновление. Система показывает их на вкладке «Аналитика → Обновление дашбордов», в сводке на странице заявок и
            (по желанию) шлёт в Telegram. Когда интеграция выключена, эти блоки скрыты.
          </Paragraph>

          <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
            <Form.Item name="enabled" label="Включить" valuePropName="checked"><Switch /></Form.Item>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="checkTime" label="Время ежедневной проверки" extra="Когда внешний процесс обычно присылает данные">
                  <Input type="time" />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name="timezone" label="Часовой пояс (IANA)" extra="Например: Europe/Moscow, Asia/Novosibirsk, UTC">
                  <Input placeholder="Europe/Moscow" />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" loading={save.isPending}>Сохранить</Button>
          </Form>

          <Card size="small" style={{ marginTop: 24, background: '#fafafa' }} title="Как подключить источник данных">
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="Адрес (POST)">
                <Text code>{ingestUrl}</Text>
                <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => copy(ingestUrl)} />
              </Descriptions.Item>
              <Descriptions.Item label="Заголовок"><Text code>x-log-secret: &lt;секрет&gt;</Text></Descriptions.Item>
              <Descriptions.Item label="Секрет">
                {data?.hasSecret ? <Tag color="green">задан</Tag> : <Tag>не задан</Tag>}
                <Popconfirm
                  title="Сгенерировать новый секрет?"
                  description="Старый перестанет работать — его придётся заменить в источнике данных."
                  onConfirm={() => rotate.mutate()}
                >
                  <Button size="small" icon={<KeyOutlined />} loading={rotate.isPending}>
                    {data?.hasSecret ? 'Сгенерировать новый' : 'Сгенерировать'}
                  </Button>
                </Popconfirm>
              </Descriptions.Item>
            </Descriptions>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 4px' }}>Пример запроса (тело — массив или один объект):</Paragraph>
            <pre style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6, padding: 10, fontSize: 12, margin: 0, overflowX: 'auto' }}>{example}</pre>
          </Card>
        </>
      )}

      <Modal
        open={!!newSecret}
        title="Новый секрет"
        onCancel={() => setNewSecret(null)}
        footer={<Button type="primary" onClick={() => setNewSecret(null)}>Готово</Button>}
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Скопируйте секрет сейчас — повторно он показан не будет." />
        <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={newSecret ?? ''} style={{ fontFamily: 'monospace' }} />
          <Button icon={<CopyOutlined />} onClick={() => newSecret && copy(newSecret)} />
        </Space.Compact>
      </Modal>
    </Card>
  );
}
