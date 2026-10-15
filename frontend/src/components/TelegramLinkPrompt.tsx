import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Checkbox, Typography, Space, Steps } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import api from '../api/client';

const DISMISS_KEY = 'bi_hide_telegram_prompt';
const LAST_SHOWN_KEY = 'bi_telegram_prompt_last_shown';
const today = () => new Date().toISOString().slice(0, 10);

// Shown once per calendar day (not on every reload/navigation within the same day) to any
// staff user who hasn't linked Telegram yet and hasn't permanently dismissed it via the
// checkbox. Reuses the exact same link/poll flow as the Profile page's Telegram card.
export default function TelegramLinkPrompt() {
  const qc = useQueryClient();
  const forcedPreview = new URLSearchParams(window.location.search).get('tgpreview') === '1';
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [closed, setClosed] = useState(() => {
    if (forcedPreview) return false;
    if (localStorage.getItem(DISMISS_KEY) === '1') return true;
    // Already shown today — don't re-open on every reload, just wait for tomorrow.
    return localStorage.getItem(LAST_SHOWN_KEY) === today();
  });

  const { data: me } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
  });

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
  });

  useEffect(() => {
    // Not during forced preview — that's specifically for reviewing the modal on an already-
    // linked account, this auto-close is only for "just finished linking, close the real prompt".
    if (me?.telegramLinked && !forcedPreview) { stopPolling(); setClosed(true); }
  }, [me?.telegramLinked, forcedPreview]);

  const handleClose = () => {
    if (dontShowAgain) localStorage.setItem(DISMISS_KEY, '1');
    setClosed(true);
  };

  // `closed` gates both the real and the forced-preview case, so the close/"Позже" button
  // keeps working regardless of ?tgpreview=1.
  const open = !closed && (forcedPreview || (me != null && !me.telegramLinked));

  // Record "shown today" the moment it actually opens — not on close — so a tab closed
  // without interacting with the modal still counts as shown and won't reopen on refresh.
  useEffect(() => {
    if (open && !forcedPreview) localStorage.setItem(LAST_SHOWN_KEY, today());
  }, [open]);

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      width={440}
      centered
    >
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px',
          background: 'linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <SendOutlined style={{ fontSize: 26, color: '#fff' }} />
        </div>
        <Typography.Title level={4} style={{ margin: 0 }}>Привяжите Telegram</Typography.Title>
        <Typography.Text type="secondary">
          Получайте уведомления о заявках прямо в мессенджере — назначение, смена статуса, новые комментарии
        </Typography.Text>
      </div>

      <Steps
        direction="vertical"
        size="small"
        current={-1}
        style={{ marginBottom: 20 }}
        items={[
          { title: 'Нажмите «Привязать Telegram» ниже' },
          { title: 'В открывшемся чате с ботом нажмите Start' },
          { title: 'Готово — статус в приложении обновится сам' },
        ]}
      />

      <Button
        type="primary"
        icon={<SendOutlined />}
        loading={linkMutation.isPending}
        onClick={() => linkMutation.mutate()}
        block
        size="large"
        style={{ marginBottom: 14 }}
      >
        Привязать Telegram
      </Button>

      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Checkbox checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)}>
          Больше не показывать
        </Checkbox>
        <Button type="link" onClick={handleClose} style={{ padding: 0 }}>Позже</Button>
      </Space>
    </Modal>
  );
}
