import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Form, Input, Select, Tag, message,
  Switch, InputNumber, Row, Col, Divider, Tabs,
} from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import api from '../api/client';

const DS_TYPE_LABELS: Record<string, string> = {
  db: 'БД', excel: 'Excel', google_doc: 'Google', api: 'API', other: 'Прочее',
};
const DS_TYPE_COLORS: Record<string, string> = {
  db: 'blue', excel: 'green', google_doc: 'orange', api: 'purple', other: 'default',
};
export const STATUS_OPTIONS = [
  { value: 'active', label: 'Активен' },
  { value: 'archived', label: 'Архивирован' },
  { value: 'development', label: 'В разработке' },
];

export default function ReportEditModal({
  open, editing, onClose, onSaved,
}: {
  open: boolean;
  editing: any | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [ownerSearch, setOwnerSearch] = useState('');

  const { data: allDataSources = [] } = useQuery({ queryKey: ['data-sources'], queryFn: () => api.get('/data-sources').then(r => r.data) });
  const { data: owners = [] } = useQuery({
    queryKey: ['report-owners'],
    queryFn: () => api.get('/report-owners').then(r => r.data),
  });

  const createOwnerMutation = useMutation({
    mutationFn: (fullName: string) => api.post('/report-owners', { fullName }).then(r => r.data),
    onSuccess: (owner) => {
      qc.invalidateQueries({ queryKey: ['report-owners'] });
      form.setFieldValue('ownerId', owner.id);
      setOwnerSearch('');
    },
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      api.get(`/reports-ref/${editing.id}`).then(r => r.data).then((full) => {
        form.setFieldsValue({ ...full, statusReason: undefined, dataSourceIds: full.dataSources?.map((d: any) => d.id) ?? [] });
      });
    } else {
      form.resetFields();
    }
    setOwnerSearch('');
  }, [open, editing]);

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing ? api.put(`/reports-ref/${editing.id}`, dto) : api.post('/reports-ref', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-ref'] });
      message.success('Сохранено');
      onSaved?.();
      onClose();
    },
    onError: (e: any) => message.error(e?.response?.data?.message || 'Не удалось сохранить'),
  });

  const watchedStatus = Form.useWatch('status', form);
  const statusChanged = !!editing && watchedStatus !== undefined && watchedStatus !== editing.status;

  return (
    <Modal
      title={editing ? 'Редактировать паспорт дашборда' : 'Новый дашборд'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saveMutation.isPending}
      width={760}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
        <Tabs
          size="small"
          items={[
            {
              key: 'general',
              label: 'Общие сведения',
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={16}>
                      <Form.Item name="name" label="Наименование дашборда (п.1.1)" rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="version" label="Версия (п.1.7)" initialValue="1.0">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="environment" label="Среда (п.1.5)" initialValue="prod">
                        <Select>
                          <Select.Option value="dev">Разработка</Select.Option>
                          <Select.Option value="test">Тестирование</Select.Option>
                          <Select.Option value="prod">Продуктив</Select.Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      {editing && (
                        <Form.Item name="status" label="Статус">
                          <Select options={STATUS_OPTIONS} />
                        </Form.Item>
                      )}
                    </Col>
                  </Row>
                  {statusChanged && (
                    <Form.Item
                      name="statusReason"
                      label={`Причина смены статуса (${STATUS_OPTIONS.find(s => s.value === editing.status)?.label} → ${STATUS_OPTIONS.find(s => s.value === watchedStatus)?.label})`}
                      rules={[{ required: true, message: 'Укажите причину смены статуса' }]}
                    >
                      <Input.TextArea rows={2} placeholder="Например: источник данных изменился, дашборд поставлен на паузу до..." />
                    </Form.Item>
                  )}
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="workspace" label="Workspace Power BI (п.1.3)">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="pbiLink" label="Ссылка на отчёт (п.1.4)">
                        <Input placeholder="https://app.powerbi.com/..." />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="description" label="Описание / Назначение">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'ownership',
              label: 'Владение и аудитория',
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="ownerId"
                        label="Владелец (бизнес, п.2.1)"
                        extra={
                          ownerSearch.trim() && !owners.some((o: any) => o.fullName.toLowerCase() === ownerSearch.trim().toLowerCase())
                            ? (
                              <a onClick={() => createOwnerMutation.mutate(ownerSearch.trim())}>
                                Нет в списке — добавить «{ownerSearch.trim()}» в справочник
                              </a>
                            )
                            : editing && !editing.ownerId && editing.owner
                              ? `Старое значение (текст, не привязан к пользователю): «${editing.owner}»`
                              : undefined
                        }
                      >
                        <Select
                          allowClear
                          showSearch
                          placeholder="Выберите владельца..."
                          optionFilterProp="label"
                          onSearch={setOwnerSearch}
                          onChange={() => setOwnerSearch('')}
                          options={owners.map((o: any) => ({
                            value: o.id,
                            label: o.fullName + (o.userEmail ? ` (${o.userEmail})` : ''),
                          }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="techOwner" label="Разработчик BI (п.2.2)">
                        <Input placeholder="ФИО разработчика" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="dataOwner" label="Владелец данных (п.2.3)">
                    <Input placeholder="Подразделение / ФИО" />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="targetAudience" label="Целевая аудитория (п.3.1)">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="useCase" label="Сценарий использования (п.3.3)">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="userCount" label="Кол-во пользователей (п.3.2)">
                    <InputNumber style={{ width: 160 }} min={0} />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'technical',
              label: 'Технические параметры',
              children: (
                <>
                  <Form.Item
                    name="dataSourceIds"
                    label={<span><DatabaseOutlined style={{ marginRight: 6, color: '#1677ff' }} />Источники данных</span>}
                    extra={
                      allDataSources.length === 0
                        ? <span style={{ color: '#fa8c16' }}>Справочник источников пуст — сначала добавьте их в <a href="/admin/data-sources" target="_blank">Источники данных</a></span>
                        : 'Выберите из справочника (можно несколько)'
                    }
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="Выберите источники данных..."
                      optionFilterProp="label"
                      options={allDataSources.map((ds: any) => ({
                        value: ds.id,
                        label: `${ds.code ? `[${ds.code}] ` : ''}${ds.name}`,
                        ds,
                      }))}
                      optionRender={(opt) => {
                        const ds = (opt.data as any).ds;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Tag color={DS_TYPE_COLORS[ds.type]} style={{ fontSize: 10, margin: 0 }}>
                              {DS_TYPE_LABELS[ds.type]}
                            </Tag>
                            {ds.code && <span style={{ color: '#aaa', fontSize: 11 }}>{ds.code}</span>}
                            <span>{ds.name}</span>
                            {ds.dbServer && <span style={{ color: '#999', fontSize: 11 }}>{ds.dbServer}</span>}
                          </div>
                        );
                      }}
                    />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="updateFrequency" label="Частота обновления (п.4.3)">
                        <Input placeholder="Ежедневно в 07:00" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="slaRefreshHours" label="SLA обновления, ч (п.4.5)">
                        <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="hasRLS" label="Row-Level Security (п.5.2)" valuePropName="checked" initialValue={false}>
                    <Switch checkedChildren="Включён" unCheckedChildren="Нет RLS" />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'acceptance',
              label: 'Приёмка',
              children: (
                <>
                  <Divider orientation="left" plain>Чеклист приёмки (п.6.2–6.3)</Divider>
                  <Form.Item name="checklistDone" label="Чеклист тестирования выполнен" valuePropName="checked" initialValue={false}>
                    <Switch checkedChildren="Выполнен" unCheckedChildren="Не выполнен" />
                  </Form.Item>
                  <Form.Item name="protocolSigned" label="Протокол приёмки подписан" valuePropName="checked" initialValue={false}>
                    <Switch checkedChildren="Подписан" unCheckedChildren="Не подписан" />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
