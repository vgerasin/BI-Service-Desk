import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Tag, Typography, message, Tooltip, Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, LinkOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import ReportEditModal, { STATUS_OPTIONS } from '../../components/ReportEditModal';
import '../../analytics-glass.css';

const ENV_LABELS: Record<string, string> = {
  dev: 'Разработка', test: 'Тестирование', prod: 'Продуктив',
};

const PAGE_SIZE = 20;

export default function ReportsRegistryPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [page, setPage] = useState(1);

  const { data = [], isLoading } = useQuery({ queryKey: ['reports-ref'], queryFn: () => api.get('/reports-ref').then(r => r.data) });

  const openEdit = (item: any) => { setEditing(item); setModal(true); };
  const openCreate = () => { setEditing(null); setModal(true); };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/reports-ref/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reports-ref'] }); message.success('Удалено'); },
  });

  const columns = [
    {
      title: '№', width: 50,
      render: (_: any, __: any, index: number) => (
        <span style={{ color: '#aaa', fontSize: 12 }}>{(page - 1) * PAGE_SIZE + index + 1}</span>
      ),
    },
    {
      title: 'Наименование', dataIndex: 'name', ellipsis: true,
      render: (v: string, r: any) => (
        <a onClick={() => navigate(`/admin/reports-ref/${r.id}`)} style={{ fontWeight: 500 }}>{v}</a>
      ),
    },
    {
      title: 'Владелец (БП)', width: 160, ellipsis: true,
      render: (_: any, r: any) => r.ownerName || r.owner || <span style={{ color: '#ccc' }}>—</span>,
    },
    { title: 'Разработчик BI', dataIndex: 'techOwner', width: 140, ellipsis: true },
    {
      title: 'Источник', width: 110,
      render: (_: any, r: any) => r.requestNumber
        ? (
          <Tooltip title={r.requestName}>
            <a href={`/requests/${r.requestNumber}`} style={{ fontSize: 12 }}>
              <LinkOutlined style={{ marginRight: 4 }} />{r.requestNumber}
            </a>
          </Tooltip>
        )
        : <span style={{ color: '#ccc' }}>—</span>,
    },
    { title: 'Среда', dataIndex: 'environment', width: 100, render: (v: string) => ENV_LABELS[v] || v },
    { title: 'Версия', dataIndex: 'version', width: 70 },
    {
      title: 'Статус', dataIndex: 'status', width: 120,
      render: (v: string) => (
        <Tag color={v === 'active' ? 'success' : v === 'development' ? 'processing' : 'default'}>
          {STATUS_OPTIONS.find(s => s.value === v)?.label || v}
        </Tag>
      ),
    },
    {
      title: 'RLS', dataIndex: 'hasRLS', width: 60,
      render: (v: boolean) => v ? <Tag color="orange">Да</Tag> : <Tag>Нет</Tag>,
    },
    {
      title: 'Чеклист', dataIndex: 'checklistDone', width: 80,
      render: (v: boolean) => v ? <Tag color="green">✓</Tag> : <Tag color="red">✗</Tag>,
    },
    {
      title: 'Публикация', dataIndex: 'publishedAt', width: 110,
      render: (v: string) => v ? dayjs(v).format('DD.MM.YYYY') : '—',
    },
    { title: 'Ссылка', dataIndex: 'pbiLink', width: 80, render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer">Открыть</a> : '—' },
    {
      title: '', width: 120, render: (_: any, r: any) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Ред.</Button>
          <Popconfirm
            title="Удалить дашборд?"
            description="Это действие нельзя отменить"
            okText="Удалить"
            okButtonProps={{ danger: true }}
            cancelText="Отмена"
            onConfirm={() => deleteMutation.mutate(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={deleteMutation.isPending} />
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="analytics-glass">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Реестр дашбордов / Отчётов</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
      </div>
      <Reveal>
      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        scroll={{ x: 1200 }}
        pagination={{
          current: page, pageSize: PAGE_SIZE, showSizeChanger: false,
          onChange: setPage, showTotal: (t) => `Всего: ${t}`,
        }}
      />
      </Reveal>

      <ReportEditModal open={modal} editing={editing} onClose={() => setModal(false)} />
    </div>
  );
}
