import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Typography, message,
  Popconfirm, Space, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DatabaseOutlined, FileExcelOutlined, GlobalOutlined } from '@ant-design/icons';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';

const TYPE_OPTIONS = [
  { value: 'db', label: 'База данных' },
  { value: 'excel', label: 'Excel файл' },
  { value: 'google_doc', label: 'Google Таблица / Документ' },
  { value: 'api', label: 'REST API / Веб-сервис' },
  { value: 'other', label: 'Прочее' },
];

const DB_ENGINE_OPTIONS = [
  { value: 'mssql', label: 'MS SQL Server' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'other', label: 'Другая' },
];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  db: <DatabaseOutlined style={{ color: '#1677ff' }} />,
  excel: <FileExcelOutlined style={{ color: '#52c41a' }} />,
  google_doc: <GlobalOutlined style={{ color: '#fa8c16' }} />,
  api: <GlobalOutlined style={{ color: '#722ed1' }} />,
  other: <GlobalOutlined style={{ color: '#aaa' }} />,
};

const TYPE_COLORS: Record<string, string> = {
  db: 'blue', excel: 'green', google_doc: 'orange', api: 'purple', other: 'default',
};

const TYPE_LABELS: Record<string, string> = {
  db: 'База данных', excel: 'Excel', google_doc: 'Google', api: 'API', other: 'Прочее',
};

const DB_LABELS: Record<string, string> = {
  mssql: 'MS SQL', postgresql: 'PostgreSQL', oracle: 'Oracle', mysql: 'MySQL', other: 'Другая',
};

export default function DataSourcesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const typeValue = Form.useWatch('type', form);

  const { data = [], isLoading } = useQuery({
    queryKey: ['data-sources'],
    queryFn: () => api.get('/data-sources').then(r => r.data),
  });

  const openEdit = (item: any) => { setEditing(item); form.setFieldsValue(item); setModal(true); };
  const openCreate = () => { setEditing(null); form.resetFields(); form.setFieldValue('type', 'db'); setModal(true); };

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing
      ? api.put(`/data-sources/${editing.id}`, dto)
      : api.post('/data-sources', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['data-sources'] }); setModal(false); message.success('Сохранено'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/data-sources/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['data-sources'] }); message.success('Удалено'); },
  });

  const columns = [
    {
      title: '№', width: 50,
      render: (_: any, __: any, i: number) => <span style={{ color: '#aaa', fontSize: 12 }}>{i + 1}</span>,
    },
    { title: 'Код', dataIndex: 'code', width: 90, render: (v: string) => v ? <Tag>{v}</Tag> : '—' },
    {
      title: 'Название', dataIndex: 'name',
      render: (v: string, r: any) => (
        <Space>
          {TYPE_ICONS[r.type]}
          <span style={{ fontWeight: 500 }}>{v}</span>
        </Space>
      ),
    },
    {
      title: 'Тип', dataIndex: 'type', width: 130,
      render: (v: string) => <Tag color={TYPE_COLORS[v]}>{TYPE_LABELS[v] || v}</Tag>,
    },
    {
      title: 'СУБД / Движок', width: 120,
      render: (_: any, r: any) => r.dbEngine ? <Tag>{DB_LABELS[r.dbEngine] || r.dbEngine}</Tag> : '—',
    },
    {
      title: 'Сервер / БД', width: 180,
      render: (_: any, r: any) => {
        const parts = [r.dbServer, r.dbName].filter(Boolean).join(' / ');
        return parts || (r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Ссылка</a> : '—');
      },
    },
    {
      title: 'Статус', dataIndex: 'isActive', width: 90,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Активен' : 'Архив'}</Tag>,
    },
    {
      title: '', width: 100,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Ред.</Button>
          <Popconfirm
            title="Удалить источник?"
            description="Связи с отчётами будут удалены"
            okText="Удалить" okButtonProps={{ danger: true }} cancelText="Отмена"
            onConfirm={() => deleteMutation.mutate(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={deleteMutation.isPending && deleteMutation.variables === r.id} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="analytics-glass">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Источники данных</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
      </div>

      <Reveal>
      <Table dataSource={data} columns={columns} rowKey="id" loading={isLoading} size="small" />
      </Reveal>

      <Modal
        title={editing ? 'Редактировать источник' : 'Новый источник данных'}
        open={modal}
        onCancel={() => setModal(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
          <Form.Item name="type" label="Тип источника" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} onChange={() => {
              form.setFieldsValue({ dbEngine: undefined, dbServer: undefined, dbName: undefined, url: undefined });
            }} />
          </Form.Item>

          <Form.Item name="code" label="Код / номер" extra="Например: DS-001">
            <Input placeholder="DS-001" style={{ width: 160 }} />
          </Form.Item>

          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Например: Продажи 1С, Справочник сотрудников..." />
          </Form.Item>

          {typeValue === 'db' && (
            <>
              <Form.Item name="dbEngine" label="СУБД" rules={[{ required: true, message: 'Выберите СУБД' }]}>
                <Select options={DB_ENGINE_OPTIONS} placeholder="Выберите тип БД" />
              </Form.Item>
              <Form.Item name="dbServer" label="Сервер">
                <Input placeholder="sql-prod-01.company.local" />
              </Form.Item>
              <Form.Item name="dbName" label="Имя базы данных">
                <Input placeholder="SalesDB" />
              </Form.Item>
            </>
          )}

          {(typeValue === 'excel' || typeValue === 'google_doc' || typeValue === 'api' || typeValue === 'other') && (
            <Form.Item name="url" label={typeValue === 'api' ? 'URL эндпоинта' : 'Ссылка / путь'}>
              <Input placeholder={
                typeValue === 'excel' ? '\\\\server\\share\\file.xlsx' :
                typeValue === 'google_doc' ? 'https://docs.google.com/...' :
                'https://api.company.com/v1/...'
              } />
            </Form.Item>
          )}

          <Form.Item name="description" label="Описание (опционально)">
            <Input.TextArea rows={2} placeholder="Что содержит этот источник..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
