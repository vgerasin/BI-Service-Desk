import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Form, Input, Button, Alert, Typography, Space, Modal, message } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, ReadOutlined, LoginOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import CustomerGuide from '../components/help/CustomerGuide';
import { BrandIcon } from '../components/BrandMark';
import { APP_NAME } from '../branding';

interface SsoPublicConfig {
  enabled: boolean;
  label?: string;
  authorizeUrl?: string;
  clientId?: string;
  scope?: string;
}

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotForm] = Form.useForm();
  const [guideOpen, setGuideOpen] = useState(false);

  // SSO is optional: the button only appears once an admin has configured it in Settings.
  const { data: sso } = useQuery<SsoPublicConfig>({
    queryKey: ['sso-config'],
    queryFn: () => api.get('/auth/sso-config').then(r => r.data),
    staleTime: 60_000,
  });
  // Without SSO the password form is the only way in, so it is shown right away.
  const passwordVisible = showPassword || !sso?.enabled;

  if (isAuthenticated) { navigate('/'); return null; }

  const onSsoLogin = () => {
    if (!sso?.enabled || !sso.authorizeUrl) return;
    const url = new URL(sso.authorizeUrl);
    url.searchParams.set('client_id', sso.clientId || '');
    url.searchParams.set('redirect_uri', `${window.location.origin}/auth/callback`);
    url.searchParams.set('response_type', 'code');
    if (sso.scope) url.searchParams.set('scope', sso.scope);
    window.location.href = url.toString();
  };

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      await login(values.email, values.password);
      navigate('/');
    } catch (e: any) {
      setError(e.response?.data?.message || 'Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  };

  const onForgot = async (values: { email: string }) => {
    setForgotLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: values.email });
      message.success('Новый пароль отправлен на указанный email');
      setForgotOpen(false);
      forgotForm.resetFields();
    } catch {
      message.error('Ошибка при отправке. Попробуйте позже.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f0f2f5',
    }}>
      <div style={{ width: 380 }}>
      <Card style={{ boxShadow: '0 4px 24px rgba(0,0,0,.1)' }}>
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <div style={{ textAlign: 'center', paddingBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><BrandIcon size={44} /></div>
            <Typography.Title level={4} style={{ margin: 0, color: '#007AFF' }}>
              {APP_NAME}
            </Typography.Title>
          </div>

          {sso?.enabled && (
            <>
              <Button
                block
                size="large"
                icon={<LoginOutlined />}
                onClick={onSsoLogin}
                style={{ border: '1.5px solid #d9d9d9', fontWeight: 500, color: '#333' }}
              >
                {sso.label || 'Войти через SSO'}
              </Button>

              <div style={{ textAlign: 'center' }}>
                <Button
                  type="link"
                  size="small"
                  onClick={() => setShowPassword(v => !v)}
                  style={{ color: '#bbb', fontSize: 12 }}
                >
                  {showPassword ? 'Скрыть' : 'Войти по паролю'}
                </Button>
              </div>
            </>
          )}

          {passwordVisible && (
            <>
              {error && <Alert message={error} type="error" showIcon />}
              <Form onFinish={onFinish} layout="vertical" size="large">
                <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Введите email' }]}>
                  <Input prefix={<UserOutlined />} placeholder="Email" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
                  <Input.Password prefix={<LockOutlined />} placeholder="Пароль" />
                </Form.Item>
                <Form.Item style={{ marginBottom: 4 }}>
                  <Button type="primary" htmlType="submit" loading={loading} block>
                    Войти
                  </Button>
                </Form.Item>
              </Form>
              <div style={{ textAlign: 'center', marginTop: -8 }}>
                <Button type="link" size="small" onClick={() => setForgotOpen(true)} style={{ color: '#999', fontSize: 12 }}>
                  Забыли пароль?
                </Button>
              </div>
            </>
          )}
        </Space>
      </Card>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Button
          type="text"
          icon={<ReadOutlined />}
          onClick={() => setGuideOpen(true)}
          style={{ color: '#8c8c8c', fontSize: 13 }}
        >
          Инструкция по работе с системой
        </Button>
      </div>
      </div>

      <Modal
        title="Инструкция для заявителя"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={null}
        width={820}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
      >
        <CustomerGuide />
      </Modal>

      <Modal
        title="Восстановление пароля"
        open={forgotOpen}
        onCancel={() => { setForgotOpen(false); forgotForm.resetFields(); }}
        footer={null}
        width={380}
      >
        <Space direction="vertical" size={16} style={{ width: '100%', paddingTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Укажите email учётной записи. Мы отправим на него новый пароль.
          </Typography.Text>
          <Form form={forgotForm} onFinish={onForgot} layout="vertical" size="large">
            <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Введите корректный email' }]}>
              <Input prefix={<MailOutlined />} placeholder="Email" autoFocus />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={forgotLoading} block>
                Отправить новый пароль
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </div>
  );
}
