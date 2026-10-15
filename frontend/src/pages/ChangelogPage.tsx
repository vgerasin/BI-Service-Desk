import { Typography, Card, Tag, Timeline, Empty } from 'antd';
import { RocketOutlined, CheckCircleFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import Reveal from '../components/Reveal';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import { CHANGELOG, CURRENT_VERSION, type ChangelogRole } from '../changelog';

export default function ChangelogPage() {
  const { user } = useAuth();
  const buildTime = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : undefined;

  // Same "preview as" convention as AppLayout.tsx — an admin previewing another cabinet sees
  // that cabinet's own release notes, not the admin's.
  const viewMode = sessionStorage.getItem('bi_view_mode') || 'admin';
  const effectiveRole: ChangelogRole =
    user?.role === UserRole.CUSTOMER || viewMode === 'portal' ? 'customer'
    : user?.role === UserRole.EXECUTOR || viewMode === 'executor' ? 'executor'
    : 'admin';

  // Only the lines relevant to this role, and only releases that still have at least one such
  // line — a release entirely about admin plumbing shouldn't show up as an empty card for a
  // заявитель.
  const visibleEntries = CHANGELOG
    .map(entry => ({ ...entry, changes: entry.changes.filter(c => c.roles.includes(effectiveRole)) }))
    .filter(entry => entry.changes.length > 0);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>История изменений</Typography.Title>
        <Tag color="blue" style={{ fontSize: 13, padding: '3px 10px', margin: 0 }}>
          Текущая версия: {CURRENT_VERSION}
        </Tag>
      </div>
      {buildTime && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 24 }}>
          Сборка от {dayjs(buildTime).format('DD.MM.YYYY HH:mm')}
        </Typography.Text>
      )}

      {visibleEntries.length === 0 ? (
        <Empty description="Пока нет изменений, которые вас касаются" style={{ marginTop: 60 }} />
      ) : (
        <Reveal>
          <Timeline
            style={{ marginTop: 8 }}
            items={visibleEntries.map((entry, idx) => ({
              dot: idx === 0
                ? <RocketOutlined style={{ fontSize: 16, color: '#007AFF' }} />
                : <CheckCircleFilled style={{ fontSize: 14, color: '#bfbfbf' }} />,
              children: (
                <Card
                  size="small"
                  style={{ marginBottom: 8, borderRadius: 12, borderColor: idx === 0 ? '#91caff' : undefined }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    <Typography.Text strong style={{ fontSize: 15 }}>{entry.title}</Typography.Text>
                    <Tag color={idx === 0 ? 'blue' : 'default'} style={{ margin: 0 }}>v{entry.version}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(entry.date).format('DD.MM.YYYY')}
                    </Typography.Text>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {entry.changes.map((c, i) => (
                      <li key={i} style={{ fontSize: 13, color: '#444', marginBottom: 4, lineHeight: 1.5 }}>{c.text}</li>
                    ))}
                  </ul>
                </Card>
              ),
            }))}
          />
        </Reveal>
      )}
    </div>
  );
}
