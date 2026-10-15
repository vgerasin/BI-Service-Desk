import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Tag, Empty, Spin, Tooltip } from 'antd';
import { Typography } from 'antd';
import {
  SyncOutlined, WarningOutlined, ClockCircleOutlined, StarOutlined,
  DollarOutlined, CheckCircleOutlined, InfoCircleOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { Line } from '@ant-design/charts';
import { useNavigate, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../api/client';
import { TYPE_LABELS } from '../types';
import Reveal from '../components/Reveal';
import { useFeatures } from '../hooks/useFeatures';
import '../analytics-glass.css';

const { Text } = Typography;

const fmt = (month: string) => dayjs(month + '-01').format('MMM');

function MttrColor(days: number | null) {
  if (days === null) return '#999';
  if (days <= 1) return '#52c41a';
  if (days <= 3) return '#faad14';
  return '#ff4d4f';
}

function RatingColor(score: number | null) {
  if (score === null) return '#999';
  if (score >= 4) return '#52c41a';
  if (score >= 3) return '#faad14';
  return '#ff4d4f';
}

// ─── DeltaBadge ────────────────────────────────────────────────────────────

function DeltaBadge({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta === null || delta === 0) return null;
  const positive = invert ? delta < 0 : delta > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      padding: '1px 7px',
      background: positive ? '#f6ffed' : '#fff2f0',
      border: `1px solid ${positive ? '#52c41a' : '#ff4d4f'}`,
      borderRadius: 10, color: positive ? '#389e0d' : '#cf1322',
      fontSize: 11, fontWeight: 600, marginLeft: 6,
    }}>
      {positive
        ? <ArrowUpOutlined style={{ fontSize: 10 }} />
        : <ArrowDownOutlined style={{ fontSize: 10 }} />}
      {Math.abs(delta)}
    </span>
  );
}

// ─── HBar — small horizontal-bar row shared by the cost/capacity/rating cards ──

function HBar({ name, valueLabel, percent, color = '#007AFF' }: {
  name: string; valueLabel: string; percent: number; color?: string;
}) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
        <Text ellipsis style={{ maxWidth: '68%', color: '#595959' }}>{name}</Text>
        <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{valueLabel}</Text>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: '#f0f0f0', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(percent, 2)}%`, height: '100%', borderRadius: 5, background: color }} />
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const features = useFeatures();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then(r => r.data),
  });

  const { data: exec } = useQuery({
    queryKey: ['analytics-executive'],
    queryFn: () => api.get('/analytics/executive').then(r => r.data),
  });

  const { data: sla } = useQuery({
    queryKey: ['analytics-sla-dashboard'],
    queryFn: () => api.get('/analytics/sla', {
      params: { dateFrom: dayjs().subtract(6, 'month').format('YYYY-MM-DD') },
    }).then(r => r.data),
  });

  const { data: ratings } = useQuery({
    queryKey: ['analytics-ratings-dashboard'],
    queryFn: () => api.get('/analytics/ratings').then(r => r.data),
  });

  const { data: refreshData } = useQuery({
    queryKey: ['dashboard-refresh-7d'],
    enabled: features.dashboardRefresh,
    queryFn: () => api.get('/dashboard-refresh-logs/analytics', {
      params: {
        from: dayjs().subtract(7, 'day').startOf('day').toISOString(),
        to: dayjs().endOf('day').toISOString(),
      },
    }).then(r => r.data),
  });

  if (isLoading) return (
    <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 60 }} />
  );

  const statusMap: Record<string, number> = {};
  data?.statusCounts?.forEach((s: any) => { statusMap[s.status] = +s.count; });
  const activeBreakdown = [
    { label: 'в работе', count: (statusMap['in_progress'] || 0) + (statusMap['queued'] || 0) },
    { label: 'ожидает заказчика', count: statusMap['waiting_customer'] || 0 },
    { label: 'новых', count: statusMap['new'] || 0 },
  ].filter(s => s.count > 0);
  const activeTotal = activeBreakdown.reduce((s, r) => s + r.count, 0);

  const failuresToday = data?.dashboardRefreshFailuresToday ?? 0;
  const failures7d = (refreshData?.byDay ?? []).reduce((s: number, d: any) => s + Number(d.count), 0);

  const slaCompliance = sla && sla.totalClosed > 0 ? 100 - sla.breachRate : null;
  const riskItems = [
    ...(sla?.overdueList || []).map((r: any) => ({ ...r, kind: 'overdue' as const })),
    ...(sla?.nearBreachList || []).map((r: any) => ({ ...r, kind: 'near' as const })),
  ].slice(0, 6);

  const trendData = [
    ...(exec?.monthlyTrend || []).map((r: any) => ({ month: fmt(r.month), value: r.created, series: 'Создано' })),
    ...(exec?.monthlyTrend || []).map((r: any) => ({ month: fmt(r.month), value: r.done, series: 'Выполнено' })),
  ];

  const maxCost = Math.max(...(exec?.topDashboards || []).map((d: any) => d.totalCost), 1);
  const maxLoad = Math.max(...(exec?.teamLoad || []).map((t: any) => t.activeCount), 1);
  const maxDeptScore = 5;

  const kpis = [
    {
      title: 'Активных заявок',
      value: activeTotal,
      icon: <ClockCircleOutlined style={{ color: '#1677ff' }} />,
      color: '#e6f4ff', border: '#91caff',
      foot: activeBreakdown.map(s => `${s.count} ${s.label}`).join(' · ') || 'нет активных',
      onClick: () => navigate('/requests'),
    },
    {
      title: 'SLA соблюдение',
      value: slaCompliance != null ? `${slaCompliance}%` : '—',
      icon: <CheckCircleOutlined style={{ color: slaCompliance == null || slaCompliance >= 90 ? '#52c41a' : slaCompliance >= 70 ? '#faad14' : '#ff4d4f' }} />,
      color: slaCompliance == null || slaCompliance >= 90 ? '#f6ffed' : '#fff2f0',
      border: slaCompliance == null || slaCompliance >= 90 ? '#b7eb8f' : '#ffccc7',
      valueStyle: { color: slaCompliance == null || slaCompliance >= 90 ? '#389e0d' : '#cf1322' },
      foot: sla ? `${sla.totalClosed - sla.totalBreached} из ${sla.totalClosed} закрыто в срок · 6 мес` : '—',
      hint: '% заявок, закрытых не позже планового срока',
    },
    {
      title: 'Средняя оценка',
      value: ratings?.avgScore != null ? Number(ratings.avgScore).toFixed(1) : '—',
      icon: <StarOutlined style={{ color: '#faad14' }} />,
      color: '#fff9e6', border: '#ffd666',
      valueStyle: { color: '#faad14' },
      foot: ratings ? `${ratings.ratedCount} оценок · отклик ${ratings.responseRate}%` : '—',
      onClick: () => navigate('/analytics?tab=ratings'),
    },
    {
      title: 'MTTR по багам',
      value: exec?.avgBugMttr != null ? `${exec.avgBugMttr} дн` : '—',
      icon: <WarningOutlined style={{ color: MttrColor(exec?.avgBugMttr ?? null) }} />,
      color: '#fffbe6', border: '#ffe58f',
      valueStyle: { color: MttrColor(exec?.avgBugMttr ?? null) },
      foot: 'среднее время закрытия за 30 дней',
      onClick: () => navigate('/analytics?tab=bugs'),
    },
    {
      title: `Затраты, ${dayjs().format('MMM')}`,
      value: exec?.monthlyCost != null ? Number(exec.monthlyCost).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—',
      unit: '₽',
      icon: <DollarOutlined style={{ color: '#722ed1' }} />,
      color: '#f9f0ff', border: '#d3adf7',
      foot: 'нарастающим итогом с начала месяца',
      onClick: () => navigate('/analytics?tab=costs'),
    },
  ];

  return (
    <div className="analytics-glass">

      {/* ── KPI row — 5 карточек ─────────────────────────────────── */}
      <Reveal>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}>
          {kpis.map((kpi, i) => (
            <Card
              key={i}
              size="small"
              style={{
                background: kpi.color,
                border: `1px solid ${kpi.border}`,
                height: '100%',
                cursor: kpi.onClick ? 'pointer' : 'default',
              }}
              bodyStyle={{ padding: '13px 15px' }}
              onClick={kpi.onClick}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 18, marginTop: 2, flexShrink: 0 }}>{kpi.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10.8, color: '#595959', marginBottom: 2, lineHeight: 1.3, fontWeight: 600 }}>
                    {kpi.title}
                    {kpi.hint && (
                      <Tooltip title={kpi.hint}>
                        <InfoCircleOutlined
                          style={{ marginLeft: 4, fontSize: 10, color: '#bfbfbf' }}
                          onClick={e => e.stopPropagation()}
                        />
                      </Tooltip>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 21, fontWeight: 700, lineHeight: 1.1,
                      ...(kpi.valueStyle || {}),
                    }}>
                      {kpi.value}
                    </span>
                    {kpi.unit && <span style={{ fontSize: 11.5, color: '#595959' }}>{kpi.unit}</span>}
                  </div>
                  <div style={{ fontSize: 10.6, color: '#8c8c8c', marginTop: 3, lineHeight: 1.35 }}>{kpi.foot}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Reveal>

      {/* ── Row 2: тренд + требует внимания ──────────────────────── */}
      <Reveal delay={0.08}>
        <Row gutter={16} style={{ marginBottom: 16, alignItems: 'stretch' }}>
          <Col xs={24} md={15} style={{ display: 'flex' }}>
            <Card title="Динамика заявок, 6 месяцев" size="small" style={{ width: '100%' }}
              extra={<span style={{ fontSize: 12, color: '#007AFF', cursor: 'pointer' }} onClick={() => navigate('/analytics?tab=executive')}>Подробнее →</span>}>
              {trendData.length > 0 ? (
                <Line
                  data={trendData}
                  xField="month"
                  yField="value"
                  colorField="series"
                  smooth
                  height={220}
                  color={['#1677ff', '#52c41a']}
                  point={{ size: 4 }}
                  legend={{ position: 'top-right' }}
                  tooltip={{ items: [{ field: 'value', name: 'Заявок' }] }}
                />
              ) : <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 40 }} />}
            </Card>
          </Col>

          <Col xs={24} md={9} style={{ display: 'flex' }}>
            <Card title="Требует внимания" size="small" style={{ width: '100%' }}>
              {riskItems.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 4px' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', background: '#f6ffed', color: '#52c41a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0,
                    border: '1px solid #b7eb8f',
                  }}>✓</div>
                  <div>
                    <Text strong style={{ fontSize: 13.5 }}>Ничего не горит</Text>
                    <div style={{ fontSize: 11.5, color: '#8c8c8c', marginTop: 2 }}>
                      0 заявок на грани срыва и 0 просроченных прямо сейчас
                    </div>
                  </div>
                </div>
              ) : (
                riskItems.map((r: any, i: number, arr: any[]) => (
                  <Link
                    key={r.id}
                    to={`/requests/${r.number}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer',
                      borderBottom: i < arr.length - 1 ? '1px solid #f5f5f5' : 'none',
                    }}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: r.kind === 'overdue' ? '#ff4d4f' : '#faad14',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#007AFF', fontWeight: 600 }}>{r.number}</div>
                      <Text ellipsis style={{ fontSize: 12.5, display: 'block' }}>{r.name}</Text>
                    </div>
                    <Tag color={r.kind === 'overdue' ? 'red' : 'orange'} style={{ margin: 0, fontSize: 10.5, flexShrink: 0 }}>
                      {r.kind === 'overdue' ? `−${Math.abs(r.overdueDays)}д` : `${r.daysLeft}д`}
                    </Tag>
                  </Link>
                ))
              )}
            </Card>
          </Col>
        </Row>
      </Reveal>

      {/* ── Row 3: топ дашбордов по затратам + нагрузка команды ──── */}
      <Reveal delay={0.12}>
        <Row gutter={16} style={{ marginBottom: 16, alignItems: 'stretch' }}>
          <Col xs={24} md={12} style={{ display: 'flex' }}>
            <Card title="Топ-5 дашбордов по затратам" size="small" style={{ width: '100%' }}
              extra={<span style={{ fontSize: 12, color: '#007AFF', cursor: 'pointer' }} onClick={() => navigate('/analytics?tab=costs')}>Все →</span>}>
              {(exec?.topDashboards || []).length === 0
                ? <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                : exec.topDashboards.map((d: any, i: number) => (
                    <HBar
                      key={i}
                      name={d.reportName}
                      valueLabel={`${Number(d.totalCost).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`}
                      percent={(d.totalCost / maxCost) * 100}
                      color="#722ed1"
                    />
                  ))
              }
            </Card>
          </Col>

          <Col xs={24} md={12} style={{ display: 'flex' }}>
            <Card title="Нагрузка команды" size="small" style={{ width: '100%' }}
              extra={<span style={{ fontSize: 12, color: '#007AFF', cursor: 'pointer' }} onClick={() => navigate('/requests')}>Все →</span>}>
              {(exec?.teamLoad || []).length === 0
                ? <Empty description="Нет активных заявок" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                : exec.teamLoad.map((t: any, i: number) => (
                    <HBar
                      key={i}
                      name={t.name}
                      valueLabel={`${t.activeCount} ${t.activeCount === 1 ? 'заявка' : 'заявок'}`}
                      percent={(t.activeCount / maxLoad) * 100}
                      color="#fa8c16"
                    />
                  ))
              }
            </Card>
          </Col>
        </Row>
      </Reveal>

      {/* ── Row 4: оценка по подразделениям + по типу заявки ─────── */}
      <Reveal delay={0.16}>
        <Row gutter={16} style={{ marginBottom: 16, alignItems: 'stretch' }}>
          <Col xs={24} md={12} style={{ display: 'flex' }}>
            <Card title="Оценка по подразделениям" size="small" style={{ width: '100%' }}
              extra={<span style={{ fontSize: 12, color: '#007AFF', cursor: 'pointer' }} onClick={() => navigate('/analytics?tab=ratings')}>Все →</span>}>
              {(ratings?.byCustomer || []).length === 0
                ? <Empty description="Нет оценок" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                : ratings.byCustomer.map((d: any, i: number, arr: any[]) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                      borderBottom: i < arr.length - 1 ? '1px solid #f5f5f5' : 'none',
                    }}>
                      <Text ellipsis style={{ flex: 1, fontSize: 12 }}>{d.department || 'Не указан'}</Text>
                      <Text type="secondary" style={{ fontSize: 10.5, width: 64, textAlign: 'right', flexShrink: 0 }}>
                        {d.count} {d.count === 1 ? 'оценка' : 'оценок'}
                      </Text>
                      <Text strong style={{ fontSize: 13, width: 34, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: RatingColor(d.avgScore) }}>
                        {Number(d.avgScore).toFixed(1)}
                      </Text>
                    </div>
                  ))
              }
            </Card>
          </Col>

          <Col xs={24} md={12} style={{ display: 'flex' }}>
            <Card title="Оценка по типу заявки" size="small" style={{ width: '100%' }}>
              {(ratings?.byType || []).length === 0
                ? <Empty description="Нет оценок" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                : ratings.byType.map((t: any, i: number) => (
                    <HBar
                      key={i}
                      name={TYPE_LABELS[t.type] || t.type}
                      valueLabel={Number(t.avgScore).toFixed(1)}
                      percent={(t.avgScore / maxDeptScore) * 100}
                      color={RatingColor(t.avgScore)}
                    />
                  ))
              }
            </Card>
          </Col>
        </Row>
      </Reveal>

      {/* ── Row 5: здоровье обновления дашбордов, свёрнуто в строку ── */}
      {features.dashboardRefresh && (
      <Reveal delay={0.2}>
        <div
          onClick={() => navigate('/analytics?tab=dashboard-refresh')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 10,
            cursor: 'pointer',
            background: failuresToday > 0 ? '#fff2f0' : '#f6ffed',
            border: `1px solid ${failuresToday > 0 ? '#ffccc7' : '#b7eb8f'}`,
          }}
        >
          <SyncOutlined style={{ fontSize: 15, color: failuresToday > 0 ? '#ff4d4f' : '#52c41a' }} />
          <Text style={{ fontSize: 12.5, color: '#595959' }}>
            <b>Обновление дашбордов:</b> {failuresToday} {failuresToday === 1 ? 'сбой' : 'сбоев'} сегодня, {failures7d} за 7 дней
          </Text>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#007AFF', fontWeight: 600 }}>Подробнее →</span>
        </div>
      </Reveal>
      )}

    </div>
  );
}
