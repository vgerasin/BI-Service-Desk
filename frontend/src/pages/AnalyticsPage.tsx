import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Space, DatePicker, Typography, Tabs, Statistic,
  Card, Row, Col, Select, Spin, Tag, Rate, Progress, Segmented, Empty, Tooltip, message, Alert,
} from 'antd';
import {
  DashboardOutlined, BugOutlined, StarOutlined, DollarOutlined,
  BarChartOutlined, DownloadOutlined, ArrowUpOutlined, ArrowDownOutlined,
  WarningOutlined, CheckCircleOutlined, ClockCircleOutlined, TeamOutlined,
  AuditOutlined, LoginOutlined, EyeOutlined, FileExcelOutlined, SyncOutlined, FileAddOutlined,
  InfoCircleOutlined, CloseOutlined,
} from '@ant-design/icons';
import { Line, Column, Pie, Bar } from '@ant-design/charts';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import DashboardPage from './DashboardPage';
import { useFeatures } from '../hooks/useFeatures';
import api from '../api/client';
import { downloadExcel } from '../api/downloadExcel';
import { useAuth } from '../contexts/AuthContext';
import { STATUS_LABELS, TYPE_LABELS, PRIORITY_LABELS, PRIORITY_COLORS, UserRole } from '../types';
import Reveal from '../components/Reveal';
import '../analytics-glass.css';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

// First 6 hues of the validated categorical ramp, fixed order (never cycled) —
// checked with scripts/validate_palette.js (CVD-safe adjacent pairs; the aqua/yellow/
// magenta contrast WARN is covered by the visible in-bar labels, its required relief).
const FUNNEL_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

const fmt = (month: string) => dayjs(month + '-01').format('MMM');

// ── Shared helpers ───────────────────────────────────────────────────────

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
      {positive ? <ArrowUpOutlined style={{ fontSize: 10 }} /> : <ArrowDownOutlined style={{ fontSize: 10 }} />}
      {Math.abs(delta)}
    </span>
  );
}

// The external job checks dashboard refresh status once a day at the time set in
// Settings → «Мониторинг обновления дашбордов» — the "last check" moment is derived from that
// schedule rather than the logs table, which only ever gets rows for failures (a clean day
// writes nothing, so MAX(checkedAt) there can't be trusted as a freshness signal).
function getDataFreshnessLabel(checkTime: string, timeZone: string): string {
  const [h, m] = checkTime.split(':').map(Number);
  const nowInZone = new Date(new Date().toLocaleString('en-US', { timeZone }));
  const last = new Date(nowInZone);
  last.setHours(h, m, 0, 0);
  if (nowInZone.getTime() < last.getTime()) last.setDate(last.getDate() - 1);
  return `${dayjs(last).format('DD.MM.YYYY')}, ${checkTime} (${timeZone})`;
}

function pluralDashboards(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дашбордов';
  if (mod10 === 1) return 'дашборд';
  if (mod10 >= 2 && mod10 <= 4) return 'дашборда';
  return 'дашбордов';
}

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

// ── Funnel visualization (reusable) ─────────────────────────────────────

function FunnelViz({ stages, total, rejected, cancelled = 0 }: { stages: any[]; total: number; rejected: number; cancelled?: number }) {
  const maxCount = Math.max(...stages.map((s: any) => s.count), 1);
  return (
    <div style={{ width: '100%' }}>
      {stages.map((stage: any, i: number) => {
        const pct = maxCount > 0 ? stage.count / maxCount : 0;
        const barW = Math.max(30, Math.round(pct * 100));
        const sideMargin = (100 - barW) / 2;
        const convPct = total > 0 ? Math.round(stage.count / total * 100) : 0;
        const nextBarW = i < stages.length - 1
          ? Math.max(30, Math.round((maxCount > 0 ? stages[i + 1].count / maxCount : 0) * 100))
          : barW;
        const nextSideMargin = (100 - nextBarW) / 2;
        return (
          <div key={stage.key}>
            <div style={{
              marginLeft: `${sideMargin}%`, marginRight: `${sideMargin}%`,
              background: FUNNEL_COLORS[i],
              borderRadius: 4, padding: '12px 18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              color: '#fff', minHeight: 50, boxShadow: `0 2px 8px ${FUNNEL_COLORS[i]}44`,
              transition: 'margin 0.3s',
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.9 }}>{stage.label}</span>
              <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{stage.count}</span>
              <span style={{ fontSize: 12, background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '1px 7px' }}>
                {convPct}%
              </span>
            </div>
            {i < stages.length - 1 && (
              <div style={{
                marginLeft: `${sideMargin}%`,
                marginRight: `${nextSideMargin}%`,
                height: 12,
                background: `linear-gradient(180deg, ${FUNNEL_COLORS[i]}, ${FUNNEL_COLORS[i + 1]})`,
                clipPath: 'polygon(0 0, 100% 0, 90% 100%, 10% 100%)',
              }} />
            )}
          </div>
        );
      })}
      {(rejected > 0 || cancelled > 0) && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            marginLeft: '30%', marginRight: '30%',
            background: '#fafafa', border: '1px dashed #d9d9d9',
            borderRadius: 4, padding: '7px 14px', textAlign: 'center',
            fontSize: 12, color: '#8c8c8c',
          }}>
            {rejected > 0 && `Отклонено: ${rejected}`}
            {rejected > 0 && cancelled > 0 && ' · '}
            {cancelled > 0 && `Отменено: ${cancelled}`}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab 1 — Executive Dashboard
// ══════════════════════════════════════════════════════════════════════════

const DEV_TYPE_OPTIONS = [
  { label: 'Все типы', value: 'development,improvement,other' },
  { label: 'Новый дашборд', value: 'development' },
  { label: 'Доработка', value: 'improvement' },
];

function DevelopmentTab() {
  const now = dayjs();
  const [typeFilter, setTypeFilter] = useState('development,improvement,other');
  const [selectedMonth, setSelectedMonth] = useState<Dayjs>(now);

  const year = selectedMonth.year();
  const month = selectedMonth.month() + 1;
  const prevDate = selectedMonth.subtract(1, 'month');

  const { data: current, isLoading } = useQuery({
    queryKey: ['analytics-funnel-dev', year, month, typeFilter],
    queryFn: () => api.get('/analytics/funnel', { params: { year, month, types: typeFilter } }).then(r => r.data),
  });
  const { data: previous } = useQuery({
    queryKey: ['analytics-funnel-dev', prevDate.year(), prevDate.month() + 1, typeFilter],
    queryFn: () => api.get('/analytics/funnel', { params: { year: prevDate.year(), month: prevDate.month() + 1, types: typeFilter } }).then(r => r.data),
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 60 }} />;
  if (!current) return null;

  const stages: any[] = current.stages || [];
  const conversionRate = current.total > 0
    ? ((stages[5]?.count || 0) / current.total * 100).toFixed(1)
    : '0';
  const prevStageMap: Record<string, number> = Object.fromEntries(
    (previous?.stages || []).map((s: any) => [s.key, s.count])
  );

  return (
    <div>
      {/* Filters */}
      <Row gutter={12} style={{ marginBottom: 20 }} align="middle">
        <Col>
          <Segmented
            options={DEV_TYPE_OPTIONS}
            value={typeFilter}
            onChange={v => setTypeFilter(v as string)}
          />
        </Col>
        <Col>
          <DatePicker
            picker="month"
            value={selectedMonth}
            onChange={(v) => v && setSelectedMonth(v)}
            format="MMMM YYYY"
            allowClear={false}
          />
        </Col>
        <Col>
          <Text type="secondary" style={{ fontSize: 13 }}>
            vs {prevDate.format('MMMM YYYY')}
          </Text>
        </Col>
      </Row>

      {/* KPIs */}
      <Reveal>
      <Row gutter={12} style={{ marginBottom: 24, alignItems: 'stretch' }}>
        <Col xs={12} sm={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#e6f4ff', border: '1px solid #91caff', width: '100%' }}>
            <Statistic title={`Заявок (${selectedMonth.format('MMM')})`} value={current.total} />
          </Card>
        </Col>
        <Col xs={12} sm={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f', width: '100%' }}>
            <Statistic title="В сопровождении" value={stages[5]?.count || 0} />
            {previous && <DeltaBadge delta={(stages[5]?.count || 0) - (prevStageMap['support'] || 0)} />}
          </Card>
        </Col>
        <Col xs={12} sm={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#fff7e6', border: '1px solid #ffd591', width: '100%' }}>
            <Statistic title="Конверсия" value={conversionRate} suffix="%" />
          </Card>
        </Col>
        <Col xs={12} sm={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#f0f5ff', border: '1px solid #adc6ff', width: '100%' }}>
            <Statistic
              title="Ср. время выполнения"
              value={current.avgDays !== null ? `${current.avgDays} дн` : '—'}
              valueStyle={{ fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>
      </Reveal>

      {/* Funnel */}
      <Reveal delay={0.08}>
      <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
        <div style={{ flex: '3 1 480px', maxWidth: 760 }}>
          <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
            Воронка — {selectedMonth.format('MMMM YYYY')}
          </Text>
          <FunnelViz stages={stages} total={current.total} rejected={current.rejected} cancelled={current.cancelled} />
        </div>

        {/* Stage counts + deltas */}
        <div style={{ flex: '2 1 280px', minWidth: 260 }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            {previous ? `Заявок на этапе — сравнение с ${prevDate.format('MMMM YYYY')}` : 'Заявок на этапе'}
          </Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stages.map((stage: any, i: number) => {
              const prev = prevStageMap[stage.key] ?? 0;
              const delta = stage.count - prev;
              return (
                <div key={stage.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', background: '#fafafa', borderRadius: 6,
                  border: '1px solid #f0f0f0',
                }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: FUNNEL_COLORS[i], flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#262626', fontWeight: 500 }}>{stage.label}</div>
                    <div style={{ fontSize: 11, color: '#bfbfbf' }}>{stage.description}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{stage.count}</div>
                    {previous && <DeltaBadge delta={delta} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </Reveal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab 3 — Bug Resolution
// ══════════════════════════════════════════════════════════════════════════

function BugsTab() {
  const [filters, setFilters] = useState<{ dateFrom?: string; dateTo?: string }>({});

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-bugs', filters],
    queryFn: () => api.get('/analytics/bugs', { params: filters }).then(r => r.data),
    staleTime: 30_000,
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 60 }} />;
  if (!data) return null;

  const trendData = [
    ...data.monthlyTrend.map((r: any) => ({ month: fmt(r.month), value: r.reported, series: 'Зарегистрировано' })),
    ...data.monthlyTrend.map((r: any) => ({ month: fmt(r.month), value: r.resolved, series: 'Устранено' })),
  ];

  const bucketOrder = ['≤ 1 день', '1–3 дня', '3–7 дней', '7+ дней'];
  const distData = bucketOrder
    .map(b => data.resolutionDistribution.find((d: any) => d.bucket === b) || { bucket: b, count: 0 });

  return (
    <div>
      {/* Filter */}
      <Row gutter={12} style={{ marginBottom: 20 }} align="middle">
        <Col>
          <RangePicker
            format="DD.MM.YYYY"
            onChange={(d: [Dayjs, Dayjs] | null) => setFilters({
              dateFrom: d?.[0]?.format('YYYY-MM-DD'),
              dateTo: d?.[1]?.format('YYYY-MM-DD'),
            })}
          />
        </Col>
        <Col>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Тренд всегда за последние 6 месяцев
          </Text>
        </Col>
      </Row>

      {/* KPIs */}
      <Reveal>
      <Row gutter={[12, 12]} style={{ marginBottom: 24, alignItems: 'stretch' }}>
        <Col xs={12} md={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#fff2f0', border: '1px solid #ffccc7', width: '100%' }}>
            <Statistic title="Всего баг-репортов" value={data.total} prefix={<BugOutlined />} />
          </Card>
        </Col>
        <Col xs={12} md={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#fff7e6', border: '1px solid #ffd591', width: '100%' }}>
            <Statistic title="Открыто сейчас" value={data.open}
              valueStyle={{ color: data.open > 5 ? '#ff4d4f' : data.open > 0 ? '#faad14' : '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={12} md={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#fffbe6', border: '1px solid #ffe58f', width: '100%' }}>
            <Statistic
              title="MTTR (ср. время устранения)"
              value={data.avgResolutionDays !== null ? `${data.avgResolutionDays} дн` : '—'}
              valueStyle={{ color: MttrColor(data.avgResolutionDays), fontSize: 22 }}
            />
            {data.avgCriticalDays !== null && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                Критические: {data.avgCriticalDays} дн
              </Text>
            )}
          </Card>
        </Col>
        <Col xs={12} md={6} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f', width: '100%' }}>
            <Statistic
              title="Устранено в срок"
              value={data.slaCompliance !== null ? `${data.slaCompliance}%` : '—'}
              valueStyle={{ color: data.slaCompliance !== null ? (data.slaCompliance >= 80 ? '#52c41a' : data.slaCompliance >= 60 ? '#faad14' : '#ff4d4f') : '#999', fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>
      </Reveal>

      {/* Charts row */}
      <Reveal delay={0.08}>
      <Row gutter={16} style={{ marginBottom: 16, alignItems: 'stretch' }}>
        <Col xs={24} md={14} style={{ display: 'flex' }}>
          <Card title="Тренд (6 месяцев): зарегистрировано vs устранено" size="small" style={{ width: '100%' }}>
            <Column
              data={trendData}
              xField="month"
              yField="value"
              colorField="series"
              group={true}
              height={220}
              color={['#ff4d4f', '#52c41a']}
              label={{ position: 'top', style: { fontSize: 11 } }}
              legend={{ position: 'top-right' }}
              tooltip={{ items: [{ field: 'value', name: 'Кол-во' }] }}
            />
          </Card>
        </Col>
        <Col xs={24} md={10} style={{ display: 'flex' }}>
          <Card title="Распределение по времени устранения" size="small" style={{ width: '100%' }}>
            {distData.some((d: any) => d.count > 0) ? (
              <Column
                data={distData}
                xField="bucket"
                yField="count"
                height={220}
                color={['#52c41a', '#95de64', '#faad14', '#ff4d4f']}
                colorField="bucket"
                label={{ position: 'top', style: { fontSize: 11 } }}
                tooltip={{ items: [{ field: 'count', name: 'Баги' }] }}
              />
            ) : <Empty description="Нет закрытых баг-репортов" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }} />}
          </Card>
        </Col>
      </Row>
      </Reveal>

      {/* By priority table */}
      <Reveal delay={0.14}>
      <Card title="По приоритетам" size="small">
        <Table
          dataSource={data.byPriority}
          rowKey="priority"
          size="small"
          pagination={false}
          columns={[
            {
              title: 'Приоритет', dataIndex: 'priority', width: 150,
              render: (v: string) => <Tag color={PRIORITY_COLORS[v]}>{PRIORITY_LABELS[v] || v}</Tag>,
            },
            { title: 'Всего', dataIndex: 'total', width: 80, align: 'center' as const },
            { title: 'Устранено', dataIndex: 'resolved', width: 100, align: 'center' as const,
              render: (v: number, r: any) => (
                <span>{v} <Text type="secondary" style={{ fontSize: 11 }}>({r.total > 0 ? Math.round(v / r.total * 100) : 0}%)</Text></span>
              ),
            },
            { title: 'Открыто', width: 80, align: 'center' as const,
              render: (_: any, r: any) => {
                const open = r.total - r.resolved;
                return <span style={{ color: open > 0 ? '#ff4d4f' : '#52c41a', fontWeight: open > 0 ? 600 : 400 }}>{open}</span>;
              },
            },
            { title: 'Ср. время (дни)', dataIndex: 'avgDays', width: 140, align: 'right' as const,
              render: (v: number | null) => v !== null
                ? <span style={{ color: MttrColor(v), fontWeight: 600 }}>{v} дн</span>
                : <Text type="secondary">—</Text>,
            },
          ]}
        />
      </Card>
      </Reveal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab 4 — Ratings / Customer Satisfaction
// ══════════════════════════════════════════════════════════════════════════

function RatingsTab() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<{ dateFrom?: string; dateTo?: string }>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics-ratings', filters],
    queryFn: () => api.get('/analytics/ratings', { params: filters }).then(r => r.data),
    staleTime: 30_000,
  });

  const periodFilter = (
    <Row gutter={12} style={{ marginBottom: 20 }} align="middle">
      <Col>
        <RangePicker
          format="DD.MM.YYYY"
          onChange={(d: [Dayjs, Dayjs] | null) => setFilters({
            dateFrom: d?.[0]?.format('YYYY-MM-DD'),
            dateTo: d?.[1]?.format('YYYY-MM-DD'),
          })}
        />
      </Col>
    </Row>
  );

  if (isLoading) return <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 60 }} />;

  if (isError || !data) {
    return (
      <div>
        {periodFilter}
        <Alert type="error" showIcon message="Не удалось загрузить оценки" description="Попробуйте выбрать другой период или обновить страницу." />
      </div>
    );
  }

  if (data.totalEligible === 0) {
    return (
      <div>
        {periodFilter}
        <Empty description="Нет выполненных заявок за выбранный период" style={{ marginTop: 60 }} />
      </div>
    );
  }

  const trendLineData = data.monthlyTrend
    .filter((r: any) => r.avgScore !== null)
    .map((r: any) => ({ month: fmt(r.month), score: Number(r.avgScore) }));

  const typeBarData = data.byType.map((t: any) => ({
    type: TYPE_LABELS[t.type] || t.type,
    score: Number(t.avgScore),
  }));

  return (
    <div>
      {/* Filter */}
      <Row gutter={12} style={{ marginBottom: 20 }} align="middle">
        <Col>
          <RangePicker
            format="DD.MM.YYYY"
            onChange={(d: [Dayjs, Dayjs] | null) => setFilters({
              dateFrom: d?.[0]?.format('YYYY-MM-DD'),
              dateTo: d?.[1]?.format('YYYY-MM-DD'),
            })}
          />
        </Col>
      </Row>

      {/* KPIs */}
      <Reveal>
      <Row gutter={[12, 12]} style={{ marginBottom: 24, alignItems: 'stretch' }}>
        <Col xs={24} sm={8} style={{ display: 'flex' }}>
          <Card
            size="small"
            style={{ background: '#fff9e6', border: '1px solid #ffd666', textAlign: 'center', width: '100%' }}
            styles={{ body: { display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' } }}
          >
            <div style={{ fontSize: 12, color: '#595959', marginBottom: 8 }}>Средняя оценка</div>
            {data.avgScore !== null ? (
              <>
                <div style={{ fontSize: 36, fontWeight: 700, color: RatingColor(data.avgScore), lineHeight: 1.2 }}>
                  {Number(data.avgScore).toFixed(1)}
                </div>
                <Rate disabled allowHalf value={data.avgScore} style={{ fontSize: 18, marginTop: 6 }} />
              </>
            ) : <Text type="secondary">Нет оценок</Text>}
          </Card>
        </Col>
        <Col xs={12} sm={8} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f', width: '100%' }}>
            <Statistic
              title="Оценено заявок"
              value={data.ratedCount}
              suffix={<Text type="secondary" style={{ fontSize: 13 }}>/ {data.totalEligible}</Text>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} style={{ display: 'flex' }}>
          <Card size="small" style={{ background: '#e6f4ff', border: '1px solid #91caff', width: '100%' }}>
            <Statistic
              title="Отклик (response rate)"
              value={data.responseRate}
              suffix="%"
              valueStyle={{ color: data.responseRate >= 50 ? '#52c41a' : data.responseRate >= 25 ? '#faad14' : '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>
      </Reveal>

      {/* Charts row */}
      <Reveal delay={0.08}>
      <Row gutter={16} style={{ marginBottom: 16, alignItems: 'stretch' }}>
        <Col xs={24} md={14} style={{ display: 'flex' }}>
          <Card title="Тренд оценок (6 месяцев)" size="small" style={{ width: '100%' }}>
            {trendLineData.length > 0 ? (
              <Line
                data={trendLineData}
                xField="month"
                yField="score"
                smooth={true}
                height={220}
                color="#faad14"
                point={{ size: 5 }}
                yAxis={{ min: 0, max: 5 }}
                label={{ text: (d: any) => d.score?.toFixed(1), style: { fontSize: 11 } }}
                tooltip={{ items: [{ field: 'score', name: 'Оценка', valueFormatter: (v: number) => v?.toFixed(2) }] }}
              />
            ) : <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} />}
          </Card>
        </Col>
        <Col xs={24} md={10} style={{ display: 'flex' }}>
          <Card title="По типам заявок" size="small" style={{ width: '100%' }}>
            {typeBarData.length > 0 ? (
              <Bar
                data={typeBarData}
                xField="type"
                yField="score"
                height={220}
                color="#faad14"
                label={{ text: (d: any) => d.score?.toFixed(1), position: 'right' }}
                yAxis={{ min: 0, max: 5 }}
                tooltip={{ items: [{ field: 'score', name: 'Оценка', valueFormatter: (v: number) => v?.toFixed(2) }] }}
                axis={{ x: { labelFontSize: 12 } }}
              />
            ) : <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} />}
          </Card>
        </Col>
      </Row>
      </Reveal>

      {/* By customer table */}
      <Reveal delay={0.14}>
      <Card title="По подразделениям" size="small">
        {data.byCustomer.length > 0 ? (
          <>
            <Table
              // "Не указан" (заявки без привязки к сотруднику/заказчику) всегда внизу — это не
              // ещё один участник рейтинга, а корзина "неизвестно", ей не место среди лидеров.
              dataSource={[...data.byCustomer].sort((a: any, b: any) => {
                if (a.department === 'Не указан') return 1;
                if (b.department === 'Не указан') return -1;
                return b.avgScore - a.avgScore;
              })}
              rowKey="department"
              size="small"
              pagination={false}
              rowClassName={(r: any) => r.department === 'Не указан' ? 'rating-dept-na' : ''}
              columns={[
                {
                  title: 'Подразделение', dataIndex: 'department', ellipsis: true,
                  render: (v: string, r: any) => (
                    <Space size={8}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: r.department === 'Не указан' ? '#bfbfbf' : RatingColor(r.avgScore),
                      }} />
                      <span style={r.department === 'Не указан' ? { fontStyle: 'italic', color: '#999' } : undefined}>{v}</span>
                    </Space>
                  ),
                },
                {
                  title: 'Оценка', dataIndex: 'avgScore', width: 220,
                  render: (v: number, r: any) => {
                    const color = r.department === 'Не указан' ? '#bfbfbf' : RatingColor(v);
                    return (
                      <Space size={10}>
                        <div style={{ width: 70, height: 6, borderRadius: 3, background: '#f0f0f0', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max(0, Math.min(100, v / 5 * 100))}%`, height: '100%', borderRadius: 3, background: color }} />
                        </div>
                        <span style={{ fontWeight: 700, color, minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>{v?.toFixed(1)}</span>
                      </Space>
                    );
                  },
                },
                {
                  title: 'Оценок', dataIndex: 'count', width: 90, align: 'center' as const,
                  render: (v: number) => (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: '#888', background: '#f5f5f5',
                      borderRadius: 999, padding: '2px 10px', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {v}
                    </span>
                  ),
                },
              ]}
            />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#888' }}>
              <Space size={6}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#52c41a', display: 'inline-block' }} />4.0 и выше</Space>
              <Space size={6}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#faad14', display: 'inline-block' }} />3.0–3.9</Space>
              <Space size={6}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d4f', display: 'inline-block' }} />ниже 3.0</Space>
            </div>
          </>
        ) : <Empty description="Нет оценок" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Card>
      </Reveal>

      {/* Flat detail list — one row per individual rating, complements the aggregate table above
          (which can't show заявитель/дашборд/№ заявки per row once a department has more than
          one rating in it — see the analysis this was built from). Also folds in every eligible
          request that HASN'T been rated yet (data.unratedDetail) — these already counted toward
          the "Y" in the "оценено X/Y" KPI above, but until now there was no way to see which
          specific requests make up that gap. Sorted together by the most relevant date each row
          has (submittedAt for rated, closedAt for unrated) so recent activity of either kind
          surfaces first, with unrated rows visually muted (grey score tag, dimmed date). */}
      <Reveal delay={0.18}>
      <Card title="Все оценки" size="small" style={{ marginTop: 16 }}>
        {(data.ratingsDetail?.length > 0 || data.unratedDetail?.length > 0) ? (
          <>
            <Table
              dataSource={[
                ...data.ratingsDetail.map((r: any) => ({ ...r, rated: true, sortDate: r.submittedAt })),
                ...data.unratedDetail.map((r: any) => ({ ...r, rated: false, sortDate: r.closedAt })),
              ].sort((a: any, b: any) => dayjs(b.sortDate).valueOf() - dayjs(a.sortDate).valueOf())}
              rowKey="requestId"
              size="small"
              pagination={{ pageSize: 10 }}
              rowClassName={(r: any) => r.rated ? '' : 'rating-row-unrated'}
              columns={[
                {
                  title: 'Заявка', dataIndex: 'requestNumber', width: 220, ellipsis: true,
                  render: (v: string, r: any) => (
                    <Link to={`/requests/${r.requestNumber}`} style={!r.rated ? { color: '#8c8c8c' } : undefined}>{v} — {r.requestName}</Link>
                  ),
                },
                {
                  title: 'Дашборд', dataIndex: 'dashboardName', ellipsis: true,
                  render: (v: string) => v || <span style={{ color: '#bbb' }}>—</span>,
                },
                { title: 'Заявитель', dataIndex: 'raterName', width: 200, ellipsis: true },
                { title: 'Подразделение', dataIndex: 'department', width: 220, ellipsis: true },
                {
                  title: 'Балл', dataIndex: 'avgScore', width: 110, align: 'right' as const,
                  render: (v: number, r: any) => r.rated
                    ? <span style={{ fontWeight: 700, color: RatingColor(v) }}>{v.toFixed(1)}</span>
                    : <Tag color="default" style={{ margin: 0, color: '#bfbfbf', borderColor: '#e8e8e8' }}>Не оценено</Tag>,
                },
                {
                  title: 'Дата', dataIndex: 'submittedAt', width: 100, align: 'right' as const,
                  render: (_: string, r: any) => r.rated
                    ? dayjs(r.submittedAt).format('DD.MM.YYYY')
                    : <span style={{ color: '#bbb' }}>закрыта {dayjs(r.closedAt).format('DD.MM.YYYY')}</span>,
                },
              ]}
            />
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#888' }}>
              <Space size={6}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e8e8e8', display: 'inline-block' }} />серым — заявки без оценки заказчика</Space>
            </div>
          </>
        ) : <Empty description="Нет оценок" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Card>
      </Reveal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab 5 — Costs
// ══════════════════════════════════════════════════════════════════════════

function CostsTab() {
  const [section, setSection] = useState<string>('dashboards');
  const [filters, setFilters] = useState<any>({});
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers').then(r => r.data),
  });

  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: ['analytics-dashboard-cost', filters],
    queryFn: () => api.get('/analytics/dashboard-cost', { params: filters }).then(r => r.data),
    enabled: section === 'dashboards',
  });

  const { data: costData, isLoading: costLoading } = useQuery({
    queryKey: ['analytics-cost', filters],
    queryFn: () => api.get('/analytics/cost', { params: filters }).then(r => r.data),
    enabled: section === 'details',
  });

  const exportParams = () => Object.fromEntries(Object.entries(filters).filter(([_, v]) => v != null && v !== ''));

  const costColumns = [
    { title: '№ Заявки', dataIndex: 'requestNumber', width: 120 },
    { title: 'Заявка', dataIndex: 'requestName', ellipsis: true },
    { title: 'Исполнитель', dataIndex: 'executorName', width: 140 },
    { title: 'Дата', dataIndex: 'date', width: 100, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    { title: 'Часы', dataIndex: 'hours', width: 70, align: 'right' as const, render: (v: any) => Number(v).toFixed(1) },
    { title: 'Ставка', dataIndex: 'rate', width: 90, align: 'right' as const, render: (v: any) => Number(v).toLocaleString() },
    { title: 'Стоимость', dataIndex: 'cost', width: 120, align: 'right' as const, render: (v: any) => <strong>{Number(v).toLocaleString()} ₽</strong> },
  ];

  const dashColumns = [
    { title: 'Дашборд', dataIndex: 'reportName', ellipsis: true },
    { title: 'Заявок', dataIndex: 'requestCount', width: 80, align: 'right' as const },
    { title: 'Часы', dataIndex: 'hours', width: 80, align: 'right' as const, render: (v: any) => Number(v).toFixed(1) },
    { title: 'Разработка', dataIndex: 'developmentCost', width: 130, align: 'right' as const, render: (v: any) => Number(v).toLocaleString() + ' ₽' },
    { title: 'Доработка / Баги', dataIndex: 'fixCost', width: 150, align: 'right' as const, render: (v: any) => Number(v).toLocaleString() + ' ₽' },
    { title: 'Итого', dataIndex: 'totalCost', width: 130, align: 'right' as const, render: (v: any) => <strong>{Number(v).toLocaleString()} ₽</strong> },
  ];

  return (
    <div>
      {/* Global filters */}
      <Row gutter={[12, 8]} style={{ marginBottom: 20 }} align="middle">
        <Col>
          <RangePicker format="DD.MM.YYYY"
            onChange={(d: [Dayjs, Dayjs] | null) => setFilters((f: any) => ({
              ...f,
              dateFrom: d?.[0]?.format('YYYY-MM-DD'),
              dateTo: d?.[1]?.format('YYYY-MM-DD'),
            }))} />
        </Col>
        <Col>
          <Select style={{ width: 180 }} placeholder="Заказчик" allowClear
            onChange={v => setFilters((f: any) => ({ ...f, customerId: v }))}>
            {customers.map((c: any) => <Select.Option key={c.id} value={c.id}>{c.department}</Select.Option>)}
          </Select>
        </Col>
        <Col>
          <Tooltip title="Экспорт в Excel">
            <Button icon={<DownloadOutlined />}
              onClick={() => downloadExcel('/analytics/cost/export', 'cost-report.xlsx', exportParams())} />
          </Tooltip>
        </Col>
      </Row>

      {/* KPI summary (dashboards data always loaded) */}
      {dashData && (
        <Reveal>
        <Row gutter={[12, 12]} style={{ marginBottom: 20, alignItems: 'stretch' }}>
          <Col xs={12} md={6} style={{ display: 'flex' }}>
            <Card size="small" style={{ background: '#f9f0ff', border: '1px solid #d3adf7', width: '100%' }}>
              <Statistic title="Ср. стоимость разработки дашборда" valueStyle={{ fontSize: 18 }}
                value={Number(dashData.avgDevelopmentCost || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} suffix="₽" />
              <Text type="secondary" style={{ fontSize: 11 }}>{dashData.devCount} заявок</Text>
            </Card>
          </Col>
          <Col xs={12} md={6} style={{ display: 'flex' }}>
            <Card size="small" style={{ background: '#fff7e6', border: '1px solid #ffd591', width: '100%' }}>
              <Statistic title="Ср. стоимость доработки / бага" valueStyle={{ fontSize: 18 }}
                value={Number(dashData.avgFixCost || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} suffix="₽" />
              <Text type="secondary" style={{ fontSize: 11 }}>{dashData.fixCount} заявок</Text>
            </Card>
          </Col>
          {costData && (
            <>
              <Col xs={12} md={6} style={{ display: 'flex' }}>
                <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f', width: '100%' }}>
                  <Statistic title="Всего часов" value={Number(costData.totalHours || 0).toFixed(1)} />
                </Card>
              </Col>
              <Col xs={12} md={6} style={{ display: 'flex' }}>
                <Card size="small" style={{ background: '#e6f4ff', border: '1px solid #91caff', width: '100%' }}>
                  <Statistic title="Общая стоимость"
                    value={Number(costData.totalCost || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} suffix="₽" />
                </Card>
              </Col>
            </>
          )}
        </Row>
        </Reveal>
      )}

      {/* Section switcher */}
      <div style={{ marginBottom: 16 }}>
        <Segmented
          options={[
            { label: 'По дашбордам', value: 'dashboards' },
            { label: 'Детали трудозатрат', value: 'details' },
          ]}
          value={section}
          onChange={v => setSection(v as string)}
        />
      </div>

      {section === 'dashboards' && (
        dashLoading ? <Spin /> : (
          <Reveal>
          <Table
            dataSource={dashData?.byDashboard || []}
            columns={dashColumns}
            rowKey="reportId"
            size="small"
            pagination={{ pageSize: 25 }}
            summary={(rows) => {
              const tc = rows.reduce((s, r: any) => s + Number(r.totalCost), 0);
              const dc = rows.reduce((s, r: any) => s + Number(r.developmentCost), 0);
              const fc = rows.reduce((s, r: any) => s + Number(r.fixCost), 0);
              const h = rows.reduce((s, r: any) => s + Number(r.hours), 0);
              return (
                <Table.Summary.Row style={{ background: '#fafafa' }}>
                  <Table.Summary.Cell index={0}><Text strong>Итого</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} />
                  <Table.Summary.Cell index={2} align="right">{h.toFixed(1)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">{dc.toLocaleString()} ₽</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">{fc.toLocaleString()} ₽</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right"><strong>{tc.toLocaleString()} ₽</strong></Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
          </Reveal>
        )
      )}

      {section === 'details' && (
        costLoading ? <Spin /> : (
          <Reveal>
          <Table
            dataSource={costData?.rows || []}
            columns={costColumns}
            rowKey="timeEntryId"
            size="small"
            scroll={{ x: 900 }}
            pagination={{ pageSize: 50 }}
          />
          </Reveal>
        )
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Dashboard Refresh Tab — scheduled-refresh failures pushed by an external job
// ══════════════════════════════════════════════════════════════════════════

function DashboardRefreshTab() {
  const features = useFeatures();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().subtract(30, 'day'), dayjs()]);
  const params = range
    ? { from: range[0].startOf('day').toISOString(), to: range[1].endOf('day').toISOString() }
    : {};

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-dashboard-refresh', params],
    queryFn: () => api.get('/dashboard-refresh-logs/analytics', { params }).then(r => r.data),
  });

  const dismissTodayMutation = useMutation({
    mutationFn: (reportName: string) =>
      api.delete('/dashboard-refresh-logs/today', { params: { reportName } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analytics-dashboard-refresh'] });
      qc.invalidateQueries({ queryKey: ['dashboard-today-summary'] });
      message.success('Дашборд убран из сводки');
    },
  });

  const createRequestMutation = useMutation({
    mutationFn: (row: any) => api.post('/requests', {
      type: 'bugfix',
      name: `Не обновился дашборд: ${row.reportName}`,
      description: `Автоматически зафиксированный сбой обновления.\n\n`
        + `Последний статус: ${row.lastStatus || '—'}\n`
        + (row.failureCount != null ? `Сбоев за период: ${row.failureCount}\n` : '')
        + `Последний сбой: ${dayjs(row.lastFailureAt).format('DD.MM.YYYY HH:mm')}`,
      priority: 'high',
      reportId: row.reportId ?? undefined,
      assigneeId: user?.id,
    }).then(r => r.data),
    onSuccess: (req) => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      message.success(`Заявка ${req.number} создана и взята в работу`);
      navigate(`/requests/${req.number}`);
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось создать заявку'),
  });

  if (isLoading) return <Spin style={{ display: 'block', textAlign: 'center', marginTop: 60 }} />;

  const today = data?.today ?? [];
  const byReport = data?.byReport ?? [];
  const byDay = data?.byDay ?? [];
  const totalReports: number = data?.totalReports ?? 0;
  const chartData = byDay.map((d: any) => ({ day: dayjs(d.day).format('DD.MM'), count: d.count }));

  const totalFailures = byDay.reduce((s: number, d: any) => s + d.count, 0);
  const avgPerDay = byDay.length > 0 ? totalFailures / byDay.length : 0;
  // % of the whole registry that had at least one failure in the selected period — a count-of-
  // dashboards ratio ("10 из 30 сбоили = 33%"), not the daily average against the registry size
  // (a rate compared to a headcount is a category error — 2.0/day out of 3 dashboards isn't 67%
  // of anything real).
  const affectedPct = totalReports > 0 ? Math.round(byReport.length / totalReports * 100) : null;
  const peakDay = byDay.reduce((max: any, d: any) => (!max || d.count > max.count ? d : max), null as any);

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8c8c8c' }}>
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
          Данные актуальны на: {getDataFreshnessLabel(features.dashboardRefreshCheckTime, features.dashboardRefreshTimezone)}
        </div>
        <RangePicker
          value={range}
          onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
          format="DD.MM.YYYY"
          allowClear={false}
        />
      </div>

      <Reveal>
      <Card size="small" title="Сбоев обновления по дням" style={{ marginBottom: 16 }}>
        {chartData.length > 0 ? (
          <>
            <Row gutter={12} style={{ marginBottom: 16, alignItems: 'stretch' }}>
              <Col span={8} style={{ display: 'flex' }}>
                <Card size="small" style={{ background: '#fafafa', width: '100%' }}>
                  <Statistic title="Всего сбоев" value={totalFailures} />
                </Card>
              </Col>
              <Col span={8} style={{ display: 'flex' }}>
                <Card size="small" style={{ background: '#fafafa', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Statistic title="Средн. в день" value={avgPerDay.toFixed(1)} valueStyle={{ color: '#ff4d4f' }} />
                  {affectedPct !== null && (
                    <Text style={{ fontSize: 12, color: '#8c8c8c' }}>
                      {byReport.length} из {totalReports} дашбордов сбоили за период (≈{affectedPct}%)
                    </Text>
                  )}
                </Card>
              </Col>
              <Col span={8} style={{ display: 'flex' }}>
                <Card size="small" style={{ background: '#fafafa', width: '100%', display: 'flex', alignItems: 'center' }}>
                  <Statistic
                    title="Пиковый день"
                    value={peakDay ? dayjs(peakDay.day).format('DD.MM') : '—'}
                    suffix={peakDay && (
                      <Tag color={peakDay.count > 3 ? 'red' : 'orange'} style={{ marginLeft: 6, marginRight: 0, verticalAlign: 2 }}>
                        {peakDay.count} {pluralDashboards(peakDay.count)}
                      </Tag>
                    )}
                  />
                </Card>
              </Col>
            </Row>
            <Column
              data={chartData}
              xField="day"
              yField="count"
              style={{ fill: '#ff4d4f', radiusTopLeft: 4, radiusTopRight: 4 }}
              height={280}
              label={{ text: (d: any) => (d.count ? String(d.count) : ''), position: 'top', style: { fontSize: 11, fill: '#8c8c8c' } }}
              axis={{ y: { label: { formatter: (v: any) => Math.round(v) === +v ? v : '' } } }}
              tooltip={{
                title: (d: any) => d.day,
                items: [{ field: 'count', name: 'Не обновилось', valueFormatter: (v: number) => `${v} ${pluralDashboards(v)}` }],
              }}
              annotations={avgPerDay > 0 ? [{
                type: 'lineY',
                data: [avgPerDay],
                style: { stroke: '#a8071a', lineDash: [3, 3], lineWidth: 1.5 },
                label: {
                  text: `Средн. ${avgPerDay.toFixed(1)}/день`,
                  position: 'right',
                  offsetY: -14,
                  style: { fill: '#a8071a', fontSize: 10.5, fontWeight: 600, textBaseline: 'bottom' },
                },
              }] : []}
            />
          </>
        ) : <Empty description="Нет данных за период" style={{ padding: 60 }} />}
      </Card>
      </Reveal>

      <Reveal delay={0.08}>
      <Row gutter={[16, 16]} style={{ marginBottom: 16, alignItems: 'stretch' }}>
        <Col xs={24} md={10} style={{ display: 'flex' }}>
          <Card
            size="small"
            title={
              <span>
                Не обновились сегодня ({today.length}){' '}
                <Tooltip title="Проверка обновления дашбордов проводится автоматически каждый день в 10:50">
                  <InfoCircleOutlined style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }} />
                </Tooltip>
              </span>
            }
            styles={{ body: { padding: 0 } }}
            style={{ width: '100%' }}
          >
            {today.length === 0 ? (
              <Empty description="Сегодня все дашборды обновились ✓" style={{ padding: 24 }} />
            ) : (
              <Table
                dataSource={today}
                rowKey="reportName"
                size="small"
                pagination={false}
                showHeader={false}
                columns={[
                  {
                    dataIndex: 'reportName',
                    ellipsis: true,
                    render: (v: string, r: any) => r.reportId ? (
                      <a onClick={() => navigate(`/admin/reports-ref/${r.reportId}`)} style={{ fontSize: 12.5 }}>
                        {v}
                      </a>
                    ) : (
                      <Tooltip title="Не найден в реестре отчётов — название не совпадает ни с одним дашбордом">
                        <Text style={{ fontSize: 12.5, color: '#8c8c8c' }}>{v}</Text>
                      </Tooltip>
                    ),
                  },
                  {
                    dataIndex: 'lastFailureAt', width: 60, align: 'right' as const,
                    render: (v: string) => (
                      <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{dayjs(v).format('HH:mm')}</Text>
                    ),
                  },
                  {
                    width: 32, align: 'right' as const,
                    render: (_: any, r: any) => (
                      <Tooltip title="Сформировать заявку и взять в работу">
                        <Button
                          size="small" type="text" icon={<FileAddOutlined />}
                          loading={createRequestMutation.isPending}
                          onClick={() => createRequestMutation.mutate(r)}
                        />
                      </Tooltip>
                    ),
                  },
                  {
                    width: 32, align: 'right' as const,
                    render: (_: any, r: any) => (
                      <Tooltip title="Убрать из сводки сегодня (дашборд обновился позже проверки)">
                        <Button
                          size="small" type="text" danger icon={<CloseOutlined />}
                          loading={dismissTodayMutation.isPending}
                          onClick={() => dismissTodayMutation.mutate(r.reportName)}
                        />
                      </Tooltip>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} md={14} style={{ display: 'flex' }}>
          <Card size="small" title="Хронические сбои за период" styles={{ body: { padding: 0 } }} style={{ width: '100%' }}>
            {byReport.length === 0 ? (
              <Empty description="За период сбоев не было ✓" style={{ padding: 24 }} />
            ) : (
              <Table
                dataSource={byReport}
                rowKey="reportName"
                size="small"
                pagination={false}
                showHeader={false}
                columns={[
                  {
                    dataIndex: 'reportName',
                    ellipsis: true,
                    render: (v: string, r: any) => r.reportId ? (
                      <a onClick={() => navigate(`/admin/reports-ref/${r.reportId}`)} style={{ fontSize: 12.5 }}>
                        {v}
                      </a>
                    ) : (
                      <Tooltip title="Не найден в реестре отчётов — название не совпадает ни с одним дашбордом">
                        <Text style={{ fontSize: 12.5, color: '#8c8c8c' }}>{v}</Text>
                      </Tooltip>
                    ),
                  },
                  {
                    dataIndex: 'failureCount', width: 40, align: 'right' as const,
                    render: (v: number) => <Tag color={v > 3 ? 'red' : 'orange'} style={{ marginRight: 0 }}>{v}</Tag>,
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>
      </Reveal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Tab 7 — Activity
// ══════════════════════════════════════════════════════════════════════════

const DOW_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DOW_ORDER  = [1, 2, 3, 4, 5, 6, 0]; // Mon→Sun display order

function ActivityHeatmap({ data }: { data: { dow: number; hour: number; count: number }[] }) {
  const map: Record<string, number> = {};
  let maxVal = 1;
  data.forEach(d => {
    const key = `${d.dow}_${d.hour}`;
    map[key] = d.count;
    if (d.count > maxVal) maxVal = d.count;
  });

  const cellColor = (count: number) => {
    if (!count) return '#f5f5f5';
    const t = count / maxVal;
    const r = Math.round(22 + (0 - 22) * t);
    const g = Math.round(119 + (89 - 119) * t);
    const b = Math.round(255 + (255 - 255) * t);
    return `rgba(${22 + Math.round((0-22)*t)}, ${119 + Math.round((89-119)*t)}, 255, ${0.15 + 0.85*t})`;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(24, 1fr)', gap: 2, minWidth: 500 }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ textAlign: 'center', fontSize: 9, color: '#aaa', paddingBottom: 2 }}>
            {h % 3 === 0 ? h : ''}
          </div>
        ))}
        {DOW_ORDER.map(dow => (
          <>
            <div key={`label-${dow}`} style={{ fontSize: 10, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 4 }}>
              {DOW_LABELS[dow]}
            </div>
            {Array.from({ length: 24 }, (_, h) => {
              const count = map[`${dow}_${h}`] || 0;
              return (
                <div
                  key={`${dow}_${h}`}
                  title={count ? `${DOW_LABELS[dow]} ${h}:00 — ${count} событий` : undefined}
                  style={{
                    height: 18,
                    borderRadius: 3,
                    background: cellColor(count),
                    cursor: count ? 'default' : undefined,
                  }}
                />
              );
            })}
          </>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: '#aaa' }}>
        <span>Меньше</span>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <div key={t} style={{ width: 14, height: 14, borderRadius: 2, background: cellColor(Math.round(maxVal * t)) }} />
        ))}
        <span>Больше</span>
      </div>
    </div>
  );
}

const ACTIVE_USERS_PAGE_SIZE = 15;

function ActivityTab() {
  const [activeUsersPage, setActiveUsersPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['activity-stats'],
    queryFn: () => api.get('/activity-logs/stats').then(r => r.data),
    staleTime: 60_000,
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 60 }} />;
  if (!data) return null;

  const today = data.todayStats;

  const activeUsersChartData = (data.dailyActiveUsers as any[]).map((d: any) => ({
    date: dayjs(d.date).format('DD.MM'),
    count: d.count,
  }));

  const topReqData = (data.topRequests as any[]).map((d: any) => ({
    name: d.name ? (d.name.length > 40 ? d.name.slice(0, 40) + '…' : d.name) : `#${d.id}`,
    views: d.views,
  }));

  const activeUsers: any[] = data.activeUsers || [];

  return (
    <div>
      {/* KPI row */}
      <Reveal>
      <Row gutter={[12, 12]} style={{ marginBottom: 24, alignItems: 'stretch' }}>
        {[
          { title: 'Событий сегодня', value: today.total,   icon: <AuditOutlined style={{ color: '#1677ff' }} />, color: '#e6f4ff', border: '#91caff' },
          { title: 'Входов сегодня',  value: today.logins,  icon: <LoginOutlined style={{ color: '#52c41a' }} />, color: '#f6ffed', border: '#b7eb8f' },
          { title: 'Просмотров',      value: today.views,   icon: <EyeOutlined style={{ color: '#d46b08' }} />,   color: '#fff7e6', border: '#ffd591' },
          { title: 'Экспортов',       value: today.exports, icon: <FileExcelOutlined style={{ color: '#531dab' }} />, color: '#f9f0ff', border: '#d3adf7' },
        ].map((kpi, i) => (
          <Col key={i} xs={12} sm={6} style={{ display: 'flex' }}>
            <Card size="small" style={{ background: kpi.color, border: `1px solid ${kpi.border}`, width: '100%' }} bodyStyle={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 20, marginTop: 2 }}>{kpi.icon}</div>
                <div>
                  <div style={{ fontSize: 11, color: '#595959', marginBottom: 2 }}>{kpi.title}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{kpi.value}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
      </Reveal>

      <Reveal delay={0.08}>
      <Row gutter={[16, 16]} style={{ marginBottom: 16, alignItems: 'stretch' }}>
        {/* Login trend */}
        <Col xs={24} md={14} style={{ display: 'flex' }}>
          <Card title="Активных пользователей в день (30 дней)" size="small" style={{ width: '100%' }}>
            {activeUsersChartData.length > 0 ? (
              <Line
                data={activeUsersChartData}
                xField="date" yField="count"
                smooth height={200}
                point={{ size: 3 }}
                color="#1677ff"
                tooltip={{ items: [{ field: 'count', name: 'Активных пользователей' }] }}
                area={{ style: { fill: 'l(270) 0:#ffffff 1:#1677ff', fillOpacity: 0.12 } }}
              />
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>
                Нет данных за последние 30 дней
              </div>
            )}
          </Card>
        </Col>

        {/* Top requests */}
        <Col xs={24} md={10} style={{ display: 'flex' }}>
          <Card title="Топ просматриваемых заявок (30 дней)" size="small" style={{ width: '100%' }}>
            {topReqData.length === 0 ? (
              <div style={{ color: '#ccc', fontSize: 13, padding: '20px 0' }}>Нет данных</div>
            ) : topReqData.map((r: any, i: number) => {
              const maxViews = topReqData[0].views;
              const pct = maxViews > 0 ? Math.round(r.views / maxViews * 100) : 0;
              return (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 8 }}>
                    <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1677ff', flexShrink: 0 }}>{r.views}</span>
                  </div>
                  <div style={{ background: '#f0f5ff', borderRadius: 4, height: 5 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#1677ff', borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </Card>
        </Col>
      </Row>
      </Reveal>

      {/* Heatmap */}
      <Reveal delay={0.14}>
      <Card title="Тепловая карта активности (30 дней, по часам)" size="small" style={{ marginBottom: 16 }}>
        {data.heatmap?.length > 0 ? (
          <ActivityHeatmap data={data.heatmap} />
        ) : (
          <div style={{ color: '#ccc', padding: '20px 0', fontSize: 13 }}>Нет данных</div>
        )}
      </Card>
      </Reveal>

      {/* Active users */}
      <Reveal delay={0.2}>
      <Card title={`Активные пользователи (30 дней) — ${activeUsers.length}`} size="small">
        <Table
          dataSource={activeUsers}
          rowKey="id"
          size="small"
          pagination={{ pageSize: ACTIVE_USERS_PAGE_SIZE, current: activeUsersPage, onChange: setActiveUsersPage }}
          columns={[
            {
              title: '№', width: 50,
              render: (_: any, __: any, index: number) => (
                <span style={{ color: '#aaa', fontSize: 12 }}>
                  {(activeUsersPage - 1) * ACTIVE_USERS_PAGE_SIZE + index + 1}
                </span>
              ),
            },
            { title: 'Имя', dataIndex: 'fullName', ellipsis: true },
            { title: 'Email', dataIndex: 'email', ellipsis: true, width: 220 },
            {
              title: 'Роль', dataIndex: 'role', width: 110,
              render: (v: string) => (
                <Tag color={v === 'admin' ? 'red' : v === 'executor' ? 'blue' : 'green'}>
                  {v === 'admin' ? 'Админ' : v === 'executor' ? 'Исполнитель' : 'Заказчик'}
                </Tag>
              ),
            },
            {
              title: 'Последняя активность', dataIndex: 'lastActivity', width: 160,
              render: (v: string) => <span style={{ color: '#389e0d' }}>{dayjs(v).format('DD.MM.YYYY HH:mm')}</span>,
            },
          ]}
        />
      </Card>
      </Reveal>
    </div>
  );
}

// Main Page
// ══════════════════════════════════════════════════════════════════════════

// Кабинет исполнителя: только их собственные затраты — обновление дашбордов и всё остальное
// (дашборд руководителя, разработка, баги, оценки, активность) видно только admin, который сам
// раздаёт заявки по сбоям обновления.
const EXECUTOR_TAB_KEYS = ['costs'];

export default function AnalyticsPage() {
  const features = useFeatures();
  const { user } = useAuth();
  // Same "view as executor" preview mode as AppLayout.tsx (sessionStorage, not a prop/context) —
  // an admin previewing the executor cabinet must see the trimmed-down tab set too.
  const viewMode = sessionStorage.getItem('bi_view_mode') || 'admin';
  const isAdmin = user?.role === UserRole.ADMIN && viewMode === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');

  const allItems = [
    {
      key: 'executive',
      label: <span><DashboardOutlined /> Дашборд</span>,
      children: <DashboardPage />,
    },
    {
      key: 'development',
      label: <span><BarChartOutlined /> Разработка</span>,
      children: <DevelopmentTab />,
    },
    {
      key: 'bugs',
      label: <span><BugOutlined /> Баги</span>,
      children: <BugsTab />,
    },
    {
      key: 'ratings',
      label: <span><StarOutlined /> Оценки</span>,
      children: <RatingsTab />,
    },
    {
      key: 'costs',
      label: <span><DollarOutlined /> Затраты</span>,
      children: <CostsTab />,
    },
    {
      key: 'dashboard-refresh',
      label: <span><SyncOutlined /> Обновление дашбордов</span>,
      children: <DashboardRefreshTab />,
    },
    {
      key: 'activity',
      label: <span><AuditOutlined /> Активность</span>,
      children: <ActivityTab />,
    },
  ];

  // A subordinate (reports to a team lead via managerId) sees nothing here at all — their lead
  // sees their costs instead — even though the tab list otherwise mirrors a regular executor's.
  const isSubordinate = !isAdmin && !!user?.managerId;
  const available = allItems.filter(t => t.key !== 'dashboard-refresh' || features.dashboardRefresh);
  const items = isAdmin ? available : isSubordinate ? [] : available.filter(t => EXECUTOR_TAB_KEYS.includes(t.key));

  if (!items.length) {
    return (
      <div className="analytics-glass">
        <Title level={3} style={{ margin: '0 0 24px', fontWeight: 700, letterSpacing: -0.3 }}>Аналитика и отчёты</Title>
        <Typography.Text type="secondary">Раздел недоступен для вашей роли.</Typography.Text>
      </div>
    );
  }

  const defaultKey = tabFromUrl && items.some(t => t.key === tabFromUrl) ? tabFromUrl : items[0].key;

  return (
    <div className="analytics-glass">
      <Title level={3} style={{ margin: '0 0 24px', fontWeight: 700, letterSpacing: -0.3 }}>Аналитика и отчёты</Title>
      <Tabs
        size="large"
        activeKey={defaultKey}
        onChange={(key) => setSearchParams(key === items[0].key ? {} : { tab: key })}
        items={items}
      />
    </div>
  );
}
