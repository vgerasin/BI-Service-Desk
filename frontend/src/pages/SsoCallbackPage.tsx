import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Alert, Typography } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

/** Landing page of the SSO redirect: exchanges the `code` for a session. */
export default function SsoCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const [error, setError] = useState('');
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get('code');
    if (!code) {
      navigate('/login', { replace: true });
      return;
    }
    const redirectUri = `${window.location.origin}/auth/callback`;
    api.post('/auth/sso/callback', { code, redirectUri })
      .then(({ data }) => {
        loginWithToken(data.access_token, data.user);
        navigate('/', { replace: true });
      })
      .catch((e) => setError(e.response?.data?.message || 'Ошибка авторизации через SSO'));
  }, []);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
        <div style={{ maxWidth: 420 }}>
          <Alert
            type="error"
            showIcon
            message="Ошибка входа через SSO"
            description={error}
            action={<Typography.Link onClick={() => navigate('/login')}>Войти обычным способом</Typography.Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Spin size="large" />
      <Typography.Text type="secondary">Выполняется вход через SSO…</Typography.Text>
    </div>
  );
}
