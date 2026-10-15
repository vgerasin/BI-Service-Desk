import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Popover, Button, List, Typography, Space, Empty } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api from '../api/client';

dayjs.extend(relativeTime);

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: countData } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data),
    refetchInterval: 15000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-count'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-count'] });
    },
  });

  const unreadCount = countData?.count ?? 0;

  const handleNotificationClick = (n: any) => {
    if (!n.isRead) markReadMutation.mutate(n.id);
    if (n.requestId) {
      setOpen(false);
      navigate(`/requests/${n.requestId}`);
    }
  };

  const content = (
    <div style={{ width: 340, maxHeight: 440, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0 10px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>
        <Typography.Text strong style={{ fontSize: 14 }}>Уведомления</Typography.Text>
        {unreadCount > 0 && (
          <Button
            type="link"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => markAllMutation.mutate()}
            loading={markAllMutation.isPending}
            style={{ padding: 0, fontSize: 12 }}
          >
            Прочитать все
          </Button>
        )}
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {notifications.length === 0 ? (
          <Empty description="Нет уведомлений" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 24 }} />
        ) : (
          <List
            dataSource={notifications}
            renderItem={(n: any) => (
              <List.Item
                style={{
                  padding: '8px 4px',
                  cursor: n.requestId ? 'pointer' : 'default',
                  background: n.isRead ? 'transparent' : '#f0f6ff',
                  borderRadius: 6,
                  marginBottom: 2,
                  paddingLeft: 8,
                  paddingRight: 8,
                  transition: 'background 0.15s',
                }}
                onClick={() => handleNotificationClick(n)}
              >
                <Space align="start" style={{ width: '100%' }}>
                  {!n.isRead && (
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#1677ff', marginTop: 6, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, paddingLeft: n.isRead ? 14 : 0 }}>
                    <div style={{ fontSize: 13, fontWeight: n.isRead ? 400 : 600, color: '#1a1a1a', lineHeight: 1.4 }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 270 }}>
                        {n.body}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>
                      {dayjs(n.createdAt).fromNow()}
                    </div>
                  </div>
                </Space>
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      arrow={false}
      overlayInnerStyle={{ padding: 16, borderRadius: 12 }}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          style={{ color: '#555', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        />
      </Badge>
    </Popover>
  );
}
