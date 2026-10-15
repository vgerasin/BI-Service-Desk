import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tree, Input, Typography, Tag, Button, Space, Empty, Skeleton, Alert,
  Modal, Descriptions, Avatar, message, Form,
} from 'antd';
import {
  IdcardOutlined, UserOutlined, MailOutlined, ApartmentOutlined, BankOutlined,
  EnvironmentOutlined, TeamOutlined, ExpandAltOutlined, ShrinkOutlined, PlusOutlined,
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';

interface OrgStructureNode {
  code: string;
  name: string;
  children: OrgStructureNode[];
}

interface Employee {
  inn: string;
  fullName: string;
  position: string | null;
  department: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  chief: string | null;
}

function flattenNodes(nodes: OrgStructureNode[], acc: Map<string, OrgStructureNode> = new Map()): Map<string, OrgStructureNode> {
  for (const n of nodes) { acc.set(n.code, n); flattenNodes(n.children, acc); }
  return acc;
}

function collectKeys(nodes: OrgStructureNode[], acc: string[] = []): string[] {
  for (const n of nodes) { acc.push(n.code); collectKeys(n.children, acc); }
  return acc;
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: '#ffe58f', fontWeight: 600 }}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

function toTreeData(nodes: OrgStructureNode[], query: string): DataNode[] {
  return nodes.map(n => ({
    key: n.code,
    title: highlight(n.name, query),
    children: n.children.length ? toTreeData(n.children, query) : undefined,
  }));
}

// Every ancestor of every node whose own name matches the query — a hit three levels deep still
// shows the whole path down to it. Departments that don't match by name simply won't appear here
// even if the query matches a *person* in them — the person still shows up in the list on the
// right; the tree and the list are independent views of the same search box.
function ancestorsOfMatches(nodes: OrgStructureNode[], query: string, path: string[] = []): Set<string> {
  const result = new Set<string>();
  for (const n of nodes) {
    const nextPath = [...path, n.code];
    const childMatches = ancestorsOfMatches(n.children, query, nextPath);
    const selfMatches = query && n.name.toLowerCase().includes(query.toLowerCase());
    if (selfMatches || childMatches.size > 0) {
      path.forEach(p => result.add(p));
      result.add(n.code);
      childMatches.forEach(k => result.add(k));
    }
  }
  return result;
}

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [search, setSearchRaw] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [autoExpandFromSearch, setAutoExpandFromSearch] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Employee | null>(null);
  const [emailModalFor, setEmailModalFor] = useState<Employee | null>(null);
  const [emailForm] = Form.useForm();

  // The HR sync (see EmployeesService) has no email on file for ~2.5% of active staff, which
  // silently blocks them from being picked as "Заявитель другой" on a new request — this writes
  // a manual override that lives in this app's own DB, so it survives the next daily sync
  // instead of being overwritten by whatever HR itself has (nothing, in this case).
  const setEmailMutation = useMutation({
    mutationFn: ({ inn, email }: { inn: string; email: string }) =>
      api.post(`/admin/employees/${inn}/email`, { email }),
    onSuccess: (_, { inn, email }) => {
      message.success('Email сохранён');
      setEmailModalFor(null);
      emailForm.resetFields();
      // Patch every cached list/detail this person could appear in, rather than waiting for a
      // refetch — same person can be visible in the search list, the department list, and the
      // detail modal all at once.
      const patch = (list?: Employee[]) => list?.map(e => (e.inn === inn ? { ...e, email } : e));
      qc.setQueriesData({ queryKey: ['employees-search-all'] }, (old: any) => patch(old) ?? old);
      qc.setQueriesData({ queryKey: ['company-structure-people'] }, (old: any) => patch(old) ?? old);
      setSelectedPerson(prev => (prev && prev.inn === inn ? { ...prev, email } : prev));
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Не удалось сохранить email'),
  });

  const { data: tree = [], isLoading: treeLoading, isError: treeError } = useQuery({
    queryKey: ['company-structure'],
    queryFn: () => api.get<OrgStructureNode[]>('/admin/employees/structure').then(r => r.data),
  });
  const nodesByCode = useMemo(() => flattenNodes(tree), [tree]);
  const treeData = useMemo(() => toTreeData(tree, search), [tree, search]);

  const query = search.trim();
  const isSearching = query.length >= 2;

  // The right pane has two independent sources depending on whether there's an active search:
  // a name search across everyone (no-email included — this is "who's in the company", not a
  // contact picker), or the people in whichever department is currently selected in the tree.
  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['employees-search-all', query],
    queryFn: () => api.get<Employee[]>('/admin/employees/search-all', { params: { q: query } }).then(r => r.data),
    enabled: isSearching,
  });
  const { data: deptPeople = [], isLoading: deptLoading } = useQuery({
    queryKey: ['company-structure-people', selectedCode],
    queryFn: () => api.get<Employee[]>('/admin/employees/by-department', { params: { code: selectedCode } }).then(r => r.data),
    enabled: !!selectedCode && !isSearching,
  });

  function setSearch(value: string) {
    setSearchRaw(value);
    if (value.trim()) {
      setExpandedKeys(Array.from(ancestorsOfMatches(tree, value.trim())));
      setAutoExpandFromSearch(true);
    } else {
      setAutoExpandFromSearch(false);
    }
  }

  async function handleSelect(keys: React.Key[]) {
    if (!keys.length) return;
    const code = keys[0] as string;
    const node = nodesByCode.get(code);
    if (node?.children.length) {
      setAutoExpandFromSearch(false);
      setExpandedKeys(prev => (prev.includes(code) ? prev : [...prev, code]));
    }
    // Pre-fetch (and populate the cache the query above reads) so an empty department can show
    // its own "никого нет" state inline in the list pane — no separate slide-out to gate.
    const data = await qc.fetchQuery({
      queryKey: ['company-structure-people', code],
      queryFn: () => api.get<Employee[]>('/admin/employees/by-department', { params: { code } }).then(r => r.data),
    });
    if (!data.length) message.info('В этом подразделении никого нет');
    setSelectedCode(code);
  }

  const rightTitle = isSearching
    ? `Найдено по имени (${searchResults.length})`
    : selectedCode
      ? `${nodesByCode.get(selectedCode)?.name || ''} (${deptPeople.length})`
      : null;
  const rightList = isSearching ? searchResults : deptPeople;
  const rightLoading = isSearching ? searchLoading : deptLoading;

  return (
    <div className="analytics-glass">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <IdcardOutlined style={{ marginRight: 8, color: '#1677ff' }} />
          Сотрудники
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Input.Search
          placeholder="Найти отдел или сотрудника..."
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Space>
          <Button icon={<ExpandAltOutlined />} onClick={() => { setAutoExpandFromSearch(false); setExpandedKeys(collectKeys(tree)); }}>
            Развернуть всё
          </Button>
          <Button icon={<ShrinkOutlined />} onClick={() => { setAutoExpandFromSearch(false); setExpandedKeys([]); }}>
            Свернуть всё
          </Button>
        </Space>
      </div>

      <Reveal>
        <Card styles={{ body: { padding: 0 } }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', minHeight: 480 }}>
            <div style={{ borderRight: '1px solid #f0f0f0', padding: 14, overflowY: 'auto', maxHeight: 640 }}>
              {treeLoading && <Skeleton active paragraph={{ rows: 8 }} />}
              {treeError && <Alert type="error" showIcon message="Не удалось загрузить структуру" />}
              {!treeLoading && !treeError && (
                tree.length ? (
                  <Tree
                    treeData={treeData}
                    expandedKeys={expandedKeys}
                    selectedKeys={selectedCode ? [selectedCode] : []}
                    onExpand={(keys) => { setAutoExpandFromSearch(false); setExpandedKeys(keys); }}
                    autoExpandParent={autoExpandFromSearch}
                    onSelect={handleSelect}
                    showLine={{ showLeafIcon: false }}
                    blockNode
                  />
                ) : <Empty description="Нет данных" />
              )}
            </div>

            <div style={{ padding: '18px 22px' }}>
              {rightTitle && (
                <Typography.Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
                  {rightTitle}
                </Typography.Text>
              )}
              {rightLoading && <Skeleton active paragraph={{ rows: 6 }} />}
              {!rightLoading && !rightTitle && (
                <div style={{ padding: '60px 0', textAlign: 'center', color: '#999' }}>
                  Выберите отдел слева, или начните вводить имя в поиске
                </div>
              )}
              {!rightLoading && rightTitle && (
                rightList.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {rightList.map(p => (
                      <div
                        key={p.inn}
                        onClick={() => setSelectedPerson(p)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
                          borderRadius: 8, cursor: 'pointer',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f5f8ff')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Avatar size={32} style={{ background: '#1677ff', flexShrink: 0, fontSize: 12 }}>
                          {p.fullName.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()}
                        </Avatar>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{highlight(p.fullName, isSearching ? query : '')}</div>
                          {p.position && <div style={{ fontSize: 12, color: '#888' }}>{p.position}</div>}
                          {isSearching && p.department && <div style={{ fontSize: 11, color: '#bbb' }}>{p.department}</div>}
                        </div>
                        {p.email
                          ? <a href={`mailto:${p.email}`} onClick={e => e.stopPropagation()} style={{ fontSize: 12, flexShrink: 0 }}>{p.email}</a>
                          : (
                            <Button
                              size="small" type="link" icon={<PlusOutlined />}
                              style={{ fontSize: 11, flexShrink: 0, padding: 0, height: 'auto' }}
                              onClick={(e) => { e.stopPropagation(); setEmailModalFor(p); emailForm.setFieldsValue({ email: '' }); }}
                            >
                              нет email
                            </Button>
                          )}
                      </div>
                    ))}
                  </div>
                ) : <Empty description="Никого не найдено" />
              )}
            </div>
          </div>
        </Card>
      </Reveal>

      <Modal open={!!selectedPerson} onCancel={() => setSelectedPerson(null)} footer={null} width={620} title={null}>
        {selectedPerson && (
          <div style={{ paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <Avatar size={56} icon={<UserOutlined />} style={{ background: '#1677ff', flexShrink: 0 }} />
              <div>
                <Typography.Title level={5} style={{ margin: 0 }}>{selectedPerson.fullName}</Typography.Title>
                {selectedPerson.position && <Typography.Text type="secondary">{selectedPerson.position}</Typography.Text>}
              </div>
            </div>
            <Descriptions bordered column={1} size="small" labelStyle={{ width: 160, whiteSpace: 'nowrap' }} contentStyle={{ wordBreak: 'break-word' }}>
              <Descriptions.Item label={<span><ApartmentOutlined style={{ marginRight: 6 }} />Подразделение</span>}>
                {selectedPerson.department || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={<span><BankOutlined style={{ marginRight: 6 }} />Организация</span>}>
                {selectedPerson.company || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={<span><EnvironmentOutlined style={{ marginRight: 6 }} />Город</span>}>
                {selectedPerson.city || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={<span><TeamOutlined style={{ marginRight: 6 }} />Руководитель</span>}>
                {selectedPerson.chief || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={<span><MailOutlined style={{ marginRight: 6 }} />Email</span>}>
                {selectedPerson.email ? (
                  <a href={`mailto:${selectedPerson.email}`}>{selectedPerson.email}</a>
                ) : (
                  <Space size={8}>
                    <Typography.Text type="secondary">не указан в источнике</Typography.Text>
                    <Button
                      size="small" type="link" icon={<PlusOutlined />} style={{ padding: 0, height: 'auto' }}
                      onClick={() => { setEmailModalFor(selectedPerson); emailForm.setFieldsValue({ email: '' }); }}
                    >
                      Добавить
                    </Button>
                  </Space>
                )}
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Modal>

      <Modal
        title={`Email для ${emailModalFor?.fullName}`}
        open={!!emailModalFor}
        onCancel={() => { setEmailModalFor(null); emailForm.resetFields(); }}
        onOk={() => emailForm.submit()}
        confirmLoading={setEmailMutation.isPending}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          В базе сотрудников (HR) для этого человека email не заполнен — из-за этого его нельзя
          выбрать в «Заявитель другой» при создании заявки. Email ниже сохраняется в этой системе
          отдельно и не будет затёрт следующей синхронизацией с HR.
        </Typography.Paragraph>
        <Form
          form={emailForm}
          layout="vertical"
          onFinish={(v) => emailModalFor && setEmailMutation.mutate({ inn: emailModalFor.inn, email: v.email })}
        >
          <Form.Item
            name="email" label="Email"
            rules={[{ required: true, message: 'Укажите email' }, { type: 'email', message: 'Некорректный email' }]}
          >
            <Input placeholder="ivanov@example.com" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
