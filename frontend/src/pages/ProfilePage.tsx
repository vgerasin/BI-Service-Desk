import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Form, Input, Button, Typography, Row, Col, Divider, Avatar, message, Tag, Space, Popconfirm,
} from 'antd';
import { UserOutlined, LockOutlined, SaveOutlined, SendOutlined, CheckCircleFilled, DisconnectOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_LABELS } from '../types';
import api from '../api/client';
import Reveal from '../components/Reveal';

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const qc = useQueryClient();
  const [infoForm] = Form.useForm();
  const [pwForm] = Form.useForm();
  const [pwLoading, setPwLoading] = useState(false);

  const initials = user?.fullName
    ? user.fullName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const updateInfoMutation = useMutation({
    mutationFn: (dto: any) => api.put('/auth/me', dto).then(r => r.data),
    onSuccess: (updated) => {
      updateUser(updated);
      message.success('Данные обновлены');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка'),
  });

  const handlePasswordChange = async (values: any) => {
    setPwLoading(true);
    try {
      await api.put('/auth/me', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success('Пароль изменён');
      pwForm.resetFields();
    } catch (e: any) {
      message.error(e.response?.data?.message || 'Ошибка смены пароля');
    } finally {
      setPwLoading(false);
    }
  };

  // Live link status — separate from the (login-time, possibly stale) AuthContext user, since
  // this needs to reflect the Telegram link the user completes on a different screen (the
  // Telegram app itself) without a page reload.
  const { data: me } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
  });

  // After opening the deep link, the user goes off to Telegram and presses Start — poll for a
  // short window so "Привязан" appears on its own once pollUpdates() on the backend resolves
  // it, instead of making them manually refresh the page.
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const stopPolling = () => { clearInterval(pollRef.current); pollRef.current = undefined; };
  useEffect(() => stopPolling, []);

  const linkMutation = useMutation({
    mutationFn: () => api.post('/auth/me/telegram-link').then(r => r.data),
    onSuccess: ({ deepLink }) => {
      window.open(deepLink, '_blank');
      stopPolling();
      const startedAt = Date.now();
      pollRef.current = setInterval(() => {
        if (Date.now() - startedAt > 90_000) { stopPolling(); return; }
        qc.invalidateQueries({ queryKey: ['auth-me'] });
      }, 3000);
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось получить ссылку'),
  });

  useEffect(() => {
    if (me?.telegramLinked) stopPolling();
  }, [me?.telegramLinked]);

  const unlinkMutation = useMutation({
    mutationFn: () => api.post('/auth/me/telegram-unlink'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-me'] });
      message.success('Telegram отвязан');
    },
  });

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginBottom: 24 }}>Профиль</Typography.Title>

      {/* Avatar + summary */}
      <Reveal>
      <Card style={{ marginBottom: 20, borderRadius: 14 }} bordered={false}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Avatar
            size={64}
            style={{
              background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
              fontSize: 22, fontWeight: 700, flexShrink: 0,
            }}
          >
            {initials}
          </Avatar>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>{user?.fullName}</Typography.Title>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <Tag color="blue">{ROLE_LABELS[user?.role] || user?.role}</Tag>
              {user?.position && <Tag>{user.position}</Tag>}
              {me?.telegramLinked && (
                <Tag color="success" icon={<CheckCircleFilled />}>Telegram привязан</Tag>
              )}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>
              {user?.email}
            </Typography.Text>
          </div>
        </div>
      </Card>
      </Reveal>

      <Reveal delay={0.08}>
      <Row gutter={[16, 16]}>
        {/* Personal info */}
        <Col xs={24} md={12}>
          <Card
            title={<><UserOutlined style={{ marginRight: 8 }} />Личные данные</>}
            bordered={false}
            style={{ borderRadius: 14 }}
          >
            <Form
              form={infoForm}
              layout="vertical"
              initialValues={{
                fullName: user?.fullName,
                email: user?.email,
                position: user?.position || '',
              }}
              onFinish={(v) => updateInfoMutation.mutate(v)}
            >
              <Form.Item
                name="fullName"
                label="ФИО"
                rules={[{ required: true, message: 'Обязательное поле' }]}
              >
                <Input placeholder="Иванов Иван Иванович" />
              </Form.Item>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ required: true, type: 'email', message: 'Некорректный email' }]}
              >
                <Input placeholder="email@example.com" />
              </Form.Item>
              <Form.Item name="position" label="Должность">
                <Input placeholder="Аналитик данных" />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={updateInfoMutation.isPending}
                block
              >
                Сохранить
              </Button>
            </Form>
          </Card>
        </Col>

        {/* Change password */}
        <Col xs={24} md={12}>
          <Card
            title={<><LockOutlined style={{ marginRight: 8 }} />Смена пароля</>}
            bordered={false}
            style={{ borderRadius: 14 }}
          >
            <Form
              form={pwForm}
              layout="vertical"
              onFinish={handlePasswordChange}
            >
              <Form.Item
                name="currentPassword"
                label="Текущий пароль"
                rules={[{ required: true, message: 'Введите текущий пароль' }]}
              >
                <Input.Password placeholder="Текущий пароль" />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="Новый пароль"
                rules={[
                  { required: true, message: 'Введите новый пароль' },
                  { min: 6, message: 'Минимум 6 символов' },
                ]}
              >
                <Input.Password placeholder="Новый пароль" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="Подтвердите пароль"
                dependencies={['newPassword']}
                rules={[
                  { required: true, message: 'Подтвердите пароль' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                      return Promise.reject(new Error('Пароли не совпадают'));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="Повторите новый пароль" />
              </Form.Item>
              <Divider style={{ margin: '12px 0' }} />
              <Button
                type="primary"
                htmlType="submit"
                icon={<LockOutlined />}
                loading={pwLoading}
                block
              >
                Изменить пароль
              </Button>
            </Form>
          </Card>
        </Col>

        {/* Telegram notifications */}
        <Col xs={24} md={12}>
          <Card
            title={<><SendOutlined style={{ marginRight: 8 }} />Уведомления в Telegram</>}
            bordered={false}
            style={{ borderRadius: 14 }}
          >
            {me?.telegramLinked ? (
              <>
                <Space align="center" style={{ marginBottom: 16 }}>
                  <CheckCircleFilled style={{ color: '#52c41a', fontSize: 18 }} />
                  <Typography.Text>Telegram привязан — уведомления о назначении заявок и смене статуса приходят вам лично.</Typography.Text>
                </Space>
                <Popconfirm
                  title="Отвязать Telegram?"
                  description="Личные уведомления по заявкам перестанут приходить"
                  okText="Отвязать"
                  okButtonProps={{ danger: true }}
                  cancelText="Отмена"
                  onConfirm={() => unlinkMutation.mutate()}
                >
                  <Button danger icon={<DisconnectOutlined />} loading={unlinkMutation.isPending} block>
                    Отвязать Telegram
                  </Button>
                </Popconfirm>
              </>
            ) : (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  Привяжите Telegram, чтобы получать личные уведомления о назначении заявок
                  и смене их статуса — в дополнение к email.
                </Typography.Paragraph>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={linkMutation.isPending}
                  onClick={() => linkMutation.mutate()}
                  block
                >
                  Привязать Telegram
                </Button>
                {linkMutation.isSuccess && !me?.telegramLinked && (
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                    Откроется чат с ботом — нажмите «Start». Статус обновится автоматически.
                  </Typography.Text>
                )}
              </>
            )}
          </Card>
        </Col>
      </Row>
      </Reveal>
    </div>
  );
}
