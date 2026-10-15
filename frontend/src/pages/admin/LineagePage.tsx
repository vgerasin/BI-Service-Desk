import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Spin, Typography, Tooltip, Select,
} from 'antd';
import {
  TableOutlined, ApartmentOutlined, DatabaseOutlined,
  FileExcelOutlined, GlobalOutlined, ApiOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';

const DS_TYPE_LABELS: Record<string, string> = {
  db: 'База данных', excel: 'Excel', google_doc: 'Google Doc', api: 'API', other: 'Прочее',
};
const DS_TYPE_COLORS: Record<string, string> = {
  db: '#1677ff', excel: '#52c41a', google_doc: '#fa8c16', api: '#722ed1', other: '#8c8c8c',
};
const DS_TAG_COLORS: Record<string, string> = {
  db: 'blue', excel: 'green', google_doc: 'orange', api: 'purple', other: 'default',
};
const DB_LABELS: Record<string, string> = {
  mssql: 'MS SQL', postgresql: 'PostgreSQL', oracle: 'Oracle', mysql: 'MySQL', other: 'Другая',
};
const STATUS_COLORS: Record<string, string> = {
  active: '#52c41a', development: '#1677ff', archived: '#bfbfbf',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Активен', development: 'В разработке', archived: 'Архив',
};
const ENV_LABELS: Record<string, string> = {
  dev: 'DEV', test: 'TEST', prod: 'PROD',
};
const DS_ICONS: Record<string, React.ReactNode> = {
  db: <DatabaseOutlined />,
  excel: <FileExcelOutlined />,
  google_doc: <GlobalOutlined />,
  api: <ApiOutlined />,
  other: <GlobalOutlined />,
};

// ── Graph constants ────────────────────────────────────────────────────────────
const NODE_W = 230;
const NODE_H = 38;
const NODE_GAP = 10;
const LEFT_X = 16;
const MID_GAP = 160;
const RIGHT_X = LEFT_X + NODE_W + MID_GAP;
const SVG_PAD = 20;

function nodeY(index: number) {
  return SVG_PAD + index * (NODE_H + NODE_GAP);
}

function nodeMidY(index: number) {
  return nodeY(index) + NODE_H / 2;
}

interface LineageData {
  sources: Array<{
    id: number; code: string; name: string; type: string;
    dbEngine: string | null; dbServer: string | null; dbName: string | null;
    isActive: boolean;
    reports: Array<{ id: number; name: string; status: string; environment: string }>;
  }>;
  reports: Array<{ id: number; name: string; status: string; environment: string }>;
  links: Array<{ sourceId: number; reportId: number }>;
}

export default function LineagePage() {
  const [view, setView] = useState<'table' | 'graph'>('table');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery<LineageData>({
    queryKey: ['lineage'],
    queryFn: () => api.get('/data-sources/lineage').then(r => r.data),
    retry: 1,
  });

  const filteredSources = useMemo(() => {
    if (!data) return [];
    return typeFilter ? data.sources.filter(s => s.type === typeFilter) : data.sources;
  }, [data, typeFilter]);

  // For graph: only include reports reachable from filtered sources
  const graphData = useMemo(() => {
    if (!data) return { sources: [], reports: [], links: [] };
    const srcIds = new Set(filteredSources.map(s => s.id));
    const activeLinks = data.links.filter(l => srcIds.has(l.sourceId));
    const reportIds = new Set(activeLinks.map(l => l.reportId));
    const reports = data.reports.filter(r => reportIds.has(r.id));
    return { sources: filteredSources, reports, links: activeLinks };
  }, [filteredSources, data]);

  const svgH = Math.max(graphData.sources.length, graphData.reports.length) * (NODE_H + NODE_GAP) + SVG_PAD * 2;
  const svgW = RIGHT_X + NODE_W + SVG_PAD;

  const srcIndex: Record<number, number> = {};
  graphData.sources.forEach((s, i) => { srcIndex[s.id] = i; });
  const rptIndex: Record<number, number> = {};
  graphData.reports.forEach((r, i) => { rptIndex[r.id] = i; });

  return (
    <div className="analytics-glass">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Линейдж данных</Typography.Title>
        <Space>
          <Select
            allowClear
            placeholder="Все типы"
            style={{ width: 160 }}
            value={typeFilter}
            onChange={v => setTypeFilter(v ?? null)}
            options={Object.entries(DS_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          />
          <Button.Group>
            <Button
              type={view === 'table' ? 'primary' : 'default'}
              icon={<TableOutlined />}
              onClick={() => setView('table')}
            >
              Таблица
            </Button>
            <Button
              type={view === 'graph' ? 'primary' : 'default'}
              icon={<ApartmentOutlined />}
              onClick={() => setView('graph')}
            >
              Граф
            </Button>
          </Button.Group>
        </Space>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      )}

      {isError && (
        <Card size="small">
          <Typography.Text type="danger">
            Ошибка загрузки данных линейджа. Проверьте консоль браузера или обратитесь к администратору.
          </Typography.Text>
        </Card>
      )}

      {/* ── TABLE VIEW ─────────────────────────────────────────────────────── */}
      {!isLoading && !isError && data && data.sources.length === 0 && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">
            Нет источников данных. Сначала создайте источник в разделе{' '}
            <Typography.Link onClick={() => navigate('/admin/data-sources')}>Источники данных</Typography.Link>,
            затем привяжите его к дашборду в{' '}
            <Typography.Link onClick={() => navigate('/admin/reports-ref')}>Реестре отчётов</Typography.Link>{' '}
            через поле «Источники данных» в форме редактирования.
          </Typography.Text>
        </Card>
      )}

      {!isLoading && !isError && view === 'table' && (
        <Reveal>
        <Card size="small">
          <Table
            dataSource={filteredSources}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              {
                title: '№', width: 50,
                render: (_: any, __: any, i: number) => (
                  <span style={{ color: '#aaa', fontSize: 12 }}>{i + 1}</span>
                ),
              },
              {
                title: 'Код', dataIndex: 'code', width: 90,
                render: (v: string) => v ? <Tag>{v}</Tag> : '—',
              },
              {
                title: 'Источник данных', dataIndex: 'name',
                render: (v: string, r: any) => (
                  <Space>
                    <span style={{ color: DS_TYPE_COLORS[r.type] }}>{DS_ICONS[r.type]}</span>
                    <span style={{ fontWeight: 500 }}>{v}</span>
                    <Tag color={DS_TAG_COLORS[r.type]} style={{ fontSize: 11 }}>
                      {DS_TYPE_LABELS[r.type] || r.type}
                    </Tag>
                    {r.type === 'db' && r.dbEngine && (
                      <Tag style={{ fontSize: 11 }}>{DB_LABELS[r.dbEngine] || r.dbEngine}</Tag>
                    )}
                    {r.type === 'db' && r.dbServer && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {[r.dbServer, r.dbName].filter(Boolean).join(' / ')}
                      </Typography.Text>
                    )}
                  </Space>
                ),
              },
              {
                title: 'Дашборды / Реестры',
                dataIndex: 'reports',
                render: (reports: any[]) => {
                  if (!reports?.length) return <Typography.Text type="secondary">Не связан</Typography.Text>;
                  return (
                    <Space size={4} wrap>
                      {reports.map(r => (
                        <Tooltip
                          key={r.id}
                          title={`${STATUS_LABELS[r.status] || r.status} · ${ENV_LABELS[r.environment] || r.environment}`}
                        >
                          <Tag
                            style={{ cursor: 'pointer', borderColor: STATUS_COLORS[r.status], fontSize: 12 }}
                            onClick={() => navigate(`/admin/reports-ref/${r.id}`)}
                          >
                            {r.name}
                          </Tag>
                        </Tooltip>
                      ))}
                    </Space>
                  );
                },
              },
              {
                title: 'Кол-во', width: 90,
                render: (_: any, r: any) => (
                  <Tag color={r.reports?.length > 0 ? 'blue' : 'default'}>
                    {r.reports?.length || 0}
                  </Tag>
                ),
              },
            ]}
          />
        </Card>
        </Reveal>
      )}

      {/* ── GRAPH VIEW ─────────────────────────────────────────────────────── */}
      {!isLoading && !isError && view === 'graph' && (
        <Card
          size="small"
          title={
            <Space>
              <ApartmentOutlined />
              <span>
                {graphData.sources.length} источников → {graphData.reports.length} дашбордов ·{' '}
                {graphData.links.length} связей
              </span>
            </Space>
          }
          bodyStyle={{ padding: 0, overflowX: 'auto' }}
        >
          {graphData.sources.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
              Нет данных для отображения
            </div>
          ) : (
            <div style={{ minWidth: svgW, padding: '12px 0' }}>
              {/* Column headers */}
              <div style={{ display: 'flex', paddingLeft: LEFT_X }}>
                <div style={{ width: NODE_W, fontWeight: 600, fontSize: 12, color: '#555', paddingLeft: 8 }}>
                  Источники данных
                </div>
                <div style={{ width: MID_GAP }} />
                <div style={{ width: NODE_W, fontWeight: 600, fontSize: 12, color: '#555', paddingLeft: 8 }}>
                  Дашборды / Реестры
                </div>
              </div>

              <svg
                width={svgW}
                height={svgH}
                style={{ display: 'block', overflow: 'visible' }}
              >
                {/* Connection curves */}
                {graphData.links.map((link, idx) => {
                  const si = srcIndex[link.sourceId];
                  const ri = rptIndex[link.reportId];
                  if (si === undefined || ri === undefined) return null;
                  const x1 = LEFT_X + NODE_W;
                  const y1 = nodeMidY(si);
                  const x2 = RIGHT_X;
                  const y2 = nodeMidY(ri);
                  const cx = (x1 + x2) / 2;
                  const src = graphData.sources[si];
                  const color = DS_TYPE_COLORS[src?.type] || '#ccc';
                  return (
                    <path
                      key={idx}
                      d={`M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      strokeOpacity={0.35}
                    />
                  );
                })}

                {/* Source nodes */}
                {graphData.sources.map((src, i) => {
                  const y = nodeY(i);
                  const color = DS_TYPE_COLORS[src.type] || '#8c8c8c';
                  return (
                    <g key={src.id}>
                      <rect
                        x={LEFT_X} y={y} width={NODE_W} height={NODE_H}
                        rx={6} ry={6}
                        fill={src.isActive ? color : '#d9d9d9'}
                        fillOpacity={0.12}
                        stroke={color}
                        strokeWidth={1.5}
                        strokeOpacity={src.isActive ? 0.8 : 0.4}
                      />
                      {/* Left type stripe */}
                      <rect
                        x={LEFT_X} y={y} width={5} height={NODE_H}
                        rx={4} ry={4}
                        fill={color}
                        fillOpacity={src.isActive ? 0.9 : 0.4}
                      />
                      <text
                        x={LEFT_X + 13} y={y + NODE_H / 2 - 5}
                        fontSize={11} fill={src.isActive ? '#333' : '#999'}
                        fontWeight={600}
                        dominantBaseline="middle"
                        style={{ userSelect: 'none' }}
                      >
                        {src.code ? `[${src.code}] ` : ''}{src.name.length > 25 ? src.name.slice(0, 25) + '…' : src.name}
                      </text>
                      <text
                        x={LEFT_X + 13} y={y + NODE_H / 2 + 9}
                        fontSize={10} fill="#999"
                        dominantBaseline="middle"
                        style={{ userSelect: 'none' }}
                      >
                        {DS_TYPE_LABELS[src.type]}
                        {src.type === 'db' && src.dbEngine ? ` · ${DB_LABELS[src.dbEngine] || src.dbEngine}` : ''}
                        {src.reports.length > 0 ? ` · ${src.reports.length} репортов` : ''}
                      </text>
                    </g>
                  );
                })}

                {/* Report nodes */}
                {graphData.reports.map((rpt, i) => {
                  const y = nodeY(i);
                  const color = STATUS_COLORS[rpt.status] || '#8c8c8c';
                  const env = ENV_LABELS[rpt.environment] || rpt.environment;
                  return (
                    <g
                      key={rpt.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/admin/reports-ref/${rpt.id}`)}
                    >
                      <rect
                        x={RIGHT_X} y={y} width={NODE_W} height={NODE_H}
                        rx={6} ry={6}
                        fill={color}
                        fillOpacity={0.1}
                        stroke={color}
                        strokeWidth={1.5}
                        strokeOpacity={0.6}
                      />
                      {/* Right status stripe */}
                      <rect
                        x={RIGHT_X + NODE_W - 5} y={y} width={5} height={NODE_H}
                        rx={4} ry={4}
                        fill={color}
                        fillOpacity={0.8}
                      />
                      <text
                        x={RIGHT_X + 10} y={y + NODE_H / 2 - 5}
                        fontSize={11} fill="#333" fontWeight={600}
                        dominantBaseline="middle"
                        style={{ userSelect: 'none' }}
                      >
                        {rpt.name.length > 25 ? rpt.name.slice(0, 25) + '…' : rpt.name}
                      </text>
                      <text
                        x={RIGHT_X + 10} y={y + NODE_H / 2 + 9}
                        fontSize={10} fill="#999"
                        dominantBaseline="middle"
                        style={{ userSelect: 'none' }}
                      >
                        {STATUS_LABELS[rpt.status] || rpt.status} · {env}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Legend */}
              <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {Object.entries(DS_TYPE_LABELS).map(([k, label]) => (
                  <Space key={k} size={4}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: DS_TYPE_COLORS[k] }} />
                    <span style={{ fontSize: 12, color: '#555' }}>{label}</span>
                  </Space>
                ))}
                <span style={{ color: '#d9d9d9' }}>|</span>
                {Object.entries(STATUS_LABELS).map(([k, label]) => (
                  <Space key={k} size={4}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: STATUS_COLORS[k] }} />
                    <span style={{ fontSize: 12, color: '#555' }}>{label}</span>
                  </Space>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
