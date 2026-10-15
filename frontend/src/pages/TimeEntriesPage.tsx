import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Space, Select, DatePicker, Typography, Card, Statistic, Row, Col,
  Modal, Form, Input, InputNumber, message, Tooltip, Tag,
} from 'antd';
import { PlusOutlined, DeleteOutlined, DownloadOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import api from '../api/client';
import { downloadExcel } from '../api/downloadExcel';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import Reveal from '../components/Reveal';
import { useNavigate } from 'react-router-dom';
import '../analytics-glass.css';

const REPORT_FILTER_KEY = 'bi_time_entries_report_filter';

export default function TimeEntriesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isExecutor = user?.role === UserRole.EXECUTOR;
  const isAdmin = user?.role === UserRole.ADMIN;

  // "Дашборд" filter survives closing the tab/browser, same convention as RequestsPage.
  const [filters, setFilters] = useState<any>(() => {
    const savedReportId = localStorage.getItem(REPORT_FILTER_KEY);
    return savedReportId ? { reportId: Number(savedReportId) } : {};
  });
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState<any>(null);   // entry being edited
  const [deleteModal, setDeleteModal] = useState<any>(null); // entry pending deletion

  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [deleteForm] = Form.useForm();
  const [selectedContractorId, setSelectedContractorId] = useState<number | null>(null);

  // Multi-select "Исполнитель" sends an array in filters (for the Select's own value) — joined
  // into a comma-separated string for the actual request, sidestepping axios's array-param
  // serialization entirely (the backend parses the same comma list either way).
  const queryParams = {
    ...filters,
    contractorId: filters.contractorId?.length ? filters.contractorId.join(',') : undefined,
  };

  const { data: rawEntries = [], isLoading } = useQuery({
    queryKey: ['time-entries', filters],
    queryFn: () => api.get('/time-entries', { params: queryParams }).then(r => r.data),
  });
  const entries = rawEntries as any[];

  const { data: contractors = [] } = useQuery({
    queryKey: ['contractors'],
    queryFn: () => api.get('/contractors').then(r => r.data),
  });
  const { data: requests = [] } = useQuery({
    queryKey: ['requests-all'],
    queryFn: () => api.get('/requests').then(r => r.data),
  });
  const { data: reportsRef = [] } = useQuery({
    queryKey: ['reports-ref'],
    queryFn: () => api.get('/reports-ref').then(r => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['time-entries'] });

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/time-entries', dto),
    onSuccess: () => { invalidate(); setModal(false); form.resetFields(); setSelectedContractorId(null); message.success('Записано'); },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка сохранения'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: any }) => api.put(`/time-entries/${id}`, dto),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['request', String(editModal?.requestId)] });
      setEditModal(null);
      editForm.resetFields();
      message.success('Запись обновлена');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка сохранения'),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ entry, reason }: { entry: any; reason: string }) => {
      // Log reason to request activity feed before deleting
      await api.post(`/requests/${entry.requestId}/comments`, {
        text: `🗑 Удалена запись трудозатрат «${entry.workName || entry.workKind || '—'}» (${Number(entry.hours).toFixed(1)} ч · ${dayjs(entry.date).format('DD.MM.YYYY')}). Причина: ${reason}`,
      }).catch(() => {});
      return api.delete(`/time-entries/${entry.id}`);
    },
    onSuccess: () => {
      invalidate();
      setDeleteModal(null);
      deleteForm.resetFields();
      message.success('Запись удалена');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка удаления'),
  });

  const openEdit = (entry: any) => {
    setEditModal(entry);
    editForm.setFieldsValue({
      workName: entry.workName || entry.workKind,
      hours: Number(entry.hours),
      quantity: Number(entry.quantity || 1),
      date: dayjs(entry.date),
    });
  };

  const totalHours = entries.reduce((s, e) => s + Number(e.hours) * Number(e.quantity || 1), 0);
  const totalCost = entries.reduce((s, e) => s + Number(e.cost || 0), 0);
  const hasCost = totalCost > 0;
  const selectedContractor = contractors.find((c: any) => c.id === selectedContractorId);

  const columns: ColumnsType<any> = [
    { title: '#', width: 50, align: 'center' as const, render: (_: any, __: any, idx: number) => idx + 1 },
    { title: '№ Заявки', dataIndex: 'requestNumber', width: 110 },
    {
      title: 'Заявка', dataIndex: 'requestName', ellipsis: true, width: 220,
      render: (v: string, r: any) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
          {r.dashboardName && (
            <Tag
              color="blue"
              style={{ margin: 0, marginTop: 2, fontSize: 11, cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); navigate(`/admin/reports-ref/${r.reportId}`); }}
            >
              {r.dashboardName}
            </Tag>
          )}
        </div>
      ),
    },
    { title: 'Исполнитель', width: 150, ellipsis: true, render: (_: any, r: any) => r.contractorName || r.userName || '—' },
    {
      title: 'Наименование работ', ellipsis: true,
      render: (_: any, r: any) => <Tooltip title={r.workName || r.workKind}>{r.workName || r.workKind || '—'}</Tooltip>,
    },
    { title: 'Дата', dataIndex: 'date', width: 95, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    { title: 'Час', dataIndex: 'hours', width: 65, align: 'right' as const, render: (v: any) => Number(v).toFixed(1) },
    { title: 'Кол-во', dataIndex: 'quantity', width: 70, align: 'right' as const, render: (v: any) => Number(v || 1).toFixed(0) },
    ...(!isExecutor ? [{
      title: 'Стоимость', dataIndex: 'cost', width: 120, align: 'right' as const,
      render: (v: any, r: any) => Number(v) > 0
        ? <span style={{ fontWeight: 600, color: '#1677ff' }}>{Number(v).toLocaleString()} {r.currency}</span>
        : <span style={{ color: '#ccc' }}>—</span>,
    }] : []),
    ...(isAdmin ? [{
      title: '', width: 90,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Tooltip title="Редактировать">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Tooltip title="Удалить с причиной">
            <Button size="small" icon={<DeleteOutlined />} danger onClick={() => { setDeleteModal(r); deleteForm.resetFields(); }} />
          </Tooltip>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div className="analytics-glass">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Журнал трудозатрат</Typography.Title>
        <Space>
          <Tooltip title="Экспорт в Excel">
            <Button
              icon={<DownloadOutlined />}
              onClick={() => downloadExcel('/time-entries/export', 'time-entries.xlsx',
                Object.fromEntries(Object.entries(queryParams).filter(([_, v]) => v != null))
              )}
            />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal(true)}>Добавить</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small"><Statistic title="Итого часов" value={totalHours.toFixed(1)} suffix="ч" /></Card>
        </Col>
        {!isExecutor && hasCost && (
          <Col span={6}>
            <Card size="small">
              <Statistic title="Итого стоимость" value={totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} suffix="₽" />
            </Card>
          </Col>
        )}
      </Row>

      <Space wrap style={{ marginBottom: 16 }}>
        <DatePicker.RangePicker
          format="DD.MM.YYYY"
          onChange={(dates: [Dayjs, Dayjs] | null) => setFilters((f: any) => ({
            ...f,
            dateFrom: dates?.[0]?.format('YYYY-MM-DD'),
            dateTo: dates?.[1]?.format('YYYY-MM-DD'),
          }))}
        />
        {!isExecutor && (
          <Select
            style={{ minWidth: 220, maxWidth: 420 }} placeholder="Исполнитель" allowClear
            mode="multiple" maxTagCount="responsive"
            value={filters.contractorId}
            onChange={v => setFilters((f: any) => ({ ...f, contractorId: v?.length ? v : undefined }))}
          >
            {contractors.map((c: any) => (
              <Select.Option key={c.id} value={c.id}>
                {c.name}{c.currentRate ? ` (${Number(c.currentRate).toLocaleString()} ${c.currentCurrency}/ч)` : ''}
              </Select.Option>
            ))}
          </Select>
        )}
        <Select
          style={{ width: 220 }} placeholder="Дашборд" allowClear showSearch
          value={filters.reportId}
          optionFilterProp="label"
          onChange={v => {
            setFilters((f: any) => ({ ...f, reportId: v }));
            if (v) localStorage.setItem(REPORT_FILTER_KEY, String(v));
            else localStorage.removeItem(REPORT_FILTER_KEY);
          }}
          options={reportsRef.map((r: any) => ({ value: r.id, label: r.name }))}
        />
      </Space>

      <Reveal>
        <Table
          dataSource={entries}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={{ pageSize: 30 }}
          scroll={{ x: 1100 }}
          summary={() => (
            <Table.Summary.Row style={{ background: '#fafafa' }}>
              <Table.Summary.Cell index={0} colSpan={6}>
                <Typography.Text strong>Итого по выборке</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <Typography.Text strong>{totalHours.toFixed(1)}</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} />
              {!isExecutor && (
                <Table.Summary.Cell index={8} align="right">
                  {hasCost && (
                    <Typography.Text strong style={{ color: '#1677ff' }}>
                      {totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₽
                    </Typography.Text>
                  )}
                </Table.Summary.Cell>
              )}
              <Table.Summary.Cell index={isAdmin ? 9 : 8} />
            </Table.Summary.Row>
          )}
        />
      </Reveal>

      {/* Add modal */}
      <Modal title="Добавить трудозатраты" open={modal}
        onCancel={() => { setModal(false); setSelectedContractorId(null); }}
        onOk={() => form.submit()} confirmLoading={createMutation.isPending} width={520}>
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate({ ...v, date: v.date.format('YYYY-MM-DD'), quantity: v.quantity || 1 })}>
          <Form.Item name="requestId" label="Заявка" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="children">
              {requests.map((r: any) => <Select.Option key={r.id} value={r.id}>{r.number} — {r.name}</Select.Option>)}
            </Select>
          </Form.Item>
          {!isExecutor && (
            <>
              <Form.Item name="contractorId" label="Исполнитель">
                <Select allowClear placeholder="Выбрать" onChange={(v) => setSelectedContractorId(v ?? null)}>
                  {contractors.map((c: any) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}
                      {c.currentRate && <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>{Number(c.currentRate).toLocaleString()} {c.currentCurrency}/ч</span>}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              {selectedContractor?.currentRate && (
                <div style={{ background: '#e6f4ff', borderRadius: 4, padding: '6px 12px', marginBottom: 12, fontSize: 12, color: '#1677ff' }}>
                  Ставка: <strong>{Number(selectedContractor.currentRate).toLocaleString()} {selectedContractor.currentCurrency || 'RUB'}/ч</strong> — стоимость рассчитается автоматически
                </div>
              )}
            </>
          )}
          <Form.Item name="workName" label="Наименование работ" rules={[{ required: true, message: 'Укажите наименование' }]}>
            <Input.TextArea placeholder="Например: Разработка ETL-процесса" autoSize={{ minRows: 1, maxRows: 8 }} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="date" label="Дата" rules={[{ required: true }]} initialValue={dayjs()}>
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="hours" label="Час" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0.1} step={0.5} placeholder="ч" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="quantity" label="Кол-во" initialValue={1}>
                <InputNumber style={{ width: '100%' }} min={1} step={1} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Edit modal (admin only) */}
      <Modal
        title={`Редактировать запись: ${editModal?.requestNumber} — ${editModal?.requestName || ''}`}
        open={!!editModal}
        onCancel={() => { setEditModal(null); editForm.resetFields(); }}
        onOk={() => editForm.submit()}
        confirmLoading={editMutation.isPending}
        width={480}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => editMutation.mutate({
            id: editModal.id,
            dto: { ...v, date: v.date.format('YYYY-MM-DD') },
          })}
        >
          <Form.Item name="workName" label="Наименование работ" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 1, maxRows: 6 }} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="date" label="Дата" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="hours" label="Час" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0.1} step={0.5} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="quantity" label="Кол-во">
                <InputNumber style={{ width: '100%' }} min={1} step={1} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Delete with reason modal (admin only) */}
      <Modal
        title="Удаление записи трудозатрат"
        open={!!deleteModal}
        onCancel={() => { setDeleteModal(null); deleteForm.resetFields(); }}
        onOk={() => deleteForm.submit()}
        okText="Удалить"
        okButtonProps={{ danger: true, loading: deleteMutation.isPending }}
        width={460}
      >
        {deleteModal && (
          <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
            <Typography.Text strong>{deleteModal.requestNumber}</Typography.Text>
            <Typography.Text> — {deleteModal.requestName}</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {deleteModal.workName || deleteModal.workKind || '—'} · {Number(deleteModal.hours).toFixed(1)} ч · {dayjs(deleteModal.date).format('DD.MM.YYYY')} · {deleteModal.contractorName || deleteModal.userName}
            </Typography.Text>
          </div>
        )}
        <Form
          form={deleteForm}
          layout="vertical"
          onFinish={(v) => deleteMutation.mutate({ entry: deleteModal, reason: v.reason })}
        >
          <Form.Item
            name="reason"
            label="Причина удаления"
            rules={[{ required: true, message: 'Укажите причину' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="Например: ошибочная запись, данные внесены повторно, не обновившийся дашборд…"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
