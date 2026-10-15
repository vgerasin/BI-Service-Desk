import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Form, Input, Select, Button, Typography, message, Upload, Space, Modal, Alert,
} from 'antd';
import { SendOutlined, PaperClipOutlined, DeleteOutlined, BugOutlined, ToolOutlined, BarChartOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import type { ReportRef } from '../../types';
import RichEditor from '../../components/RichEditor';

const TYPE_CARDS = [
  {
    value: 'bugfix',
    icon: <BugOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />,
    label: 'Ошибка / Баг',
    desc: 'Что-то не работает или работает неправильно',
    color: '#fff2f0',
    border: '#ffccc7',
  },
  {
    value: 'improvement',
    icon: <ToolOutlined style={{ fontSize: 32, color: '#fa8c16' }} />,
    label: 'Доработка',
    desc: 'Изменение или улучшение существующего дашборда',
    color: '#fff7e6',
    border: '#ffd591',
  },
  {
    value: 'development',
    icon: <BarChartOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
    label: 'Новый дашборд',
    desc: 'Разработка нового отчёта или дашборда',
    color: '#e6f4ff',
    border: '#91caff',
  },
];

export default function PortalNewRequestPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [briefFile, setBriefFile] = useState<UploadFile[]>([]);
  const [tzFile, setTzFile] = useState<UploadFile[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [debouncedName, setDebouncedName] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(nameInput), 600);
    return () => clearTimeout(t);
  }, [nameInput]);

  const { data: reports = [] } = useQuery<ReportRef[]>({
    queryKey: ['reports-ref'],
    queryFn: () => api.get('/reports-ref').then(r => r.data),
  });

  const { data: similarRequests = [] } = useQuery({
    queryKey: ['similar-requests', debouncedName, selectedType],
    queryFn: () => api.get('/requests/similar', { params: { q: debouncedName, type: selectedType || undefined } }).then(r => r.data),
    enabled: debouncedName.length >= 5,
  });

  const mutation = useMutation({
    mutationFn: async (values: any) => {
      const res = await api.post('/requests', { ...values, type: selectedType });
      const requestId = res.data.id;

      const uploads: Promise<any>[] = [];

      if (briefFile[0]?.originFileObj) {
        const fd = new FormData();
        fd.append('file', briefFile[0].originFileObj);
        fd.append('artifactType', 'grif');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
      }
      if (tzFile[0]?.originFileObj) {
        const fd = new FormData();
        fd.append('file', tzFile[0].originFileObj);
        fd.append('artifactType', 'requirements');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
      }
      for (const f of fileList) {
        if (!f.originFileObj) continue;
        const fd = new FormData();
        fd.append('file', f.originFileObj);
        fd.append('artifactType', 'other');
        uploads.push(api.post(`/requests/${requestId}/artifacts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
      }

      await Promise.all(uploads);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-requests'] });
      message.success('Заявка отправлена! Мы рассмотрим её в ближайшее время.');
      setModalOpen(false);
      navigate('/portal');
    },
    onError: () => message.error('Ошибка при отправке заявки'),
  });

  const openModal = (type: string) => {
    setSelectedType(type);
    form.resetFields();
    setFileList([]);
    setBriefFile([]);
    setTzFile([]);
    setModalOpen(true);
  };

  const needsReportId = selectedType === 'bugfix' || selectedType === 'improvement';
  const needsBriefTz = selectedType === 'improvement' || selectedType === 'development';
  const card = TYPE_CARDS.find(c => c.value === selectedType);

  return (
    <div style={{ maxWidth: 700 }}>
      <Typography.Title level={4} style={{ margin: '0 0 8px' }}>Новая заявка</Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Выберите тип заявки, чтобы продолжить
      </Typography.Text>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {TYPE_CARDS.map(c => (
          <Card
            key={c.value}
            hoverable
            onClick={() => openModal(c.value)}
            style={{
              cursor: 'pointer',
              borderColor: c.border,
              borderWidth: 2,
              background: c.color,
              textAlign: 'center',
              transition: 'all 0.15s',
            }}
            bodyStyle={{ padding: '24px 16px' }}
          >
            <div style={{ marginBottom: 10 }}>{c.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{c.label}</div>
            <div style={{ color: '#888', fontSize: 12, lineHeight: 1.45 }}>{c.desc}</div>
          </Card>
        ))}
      </div>

      <Modal
        title={
          <Space>
            {card?.icon}
            <span>{card?.label}</span>
          </Space>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={620}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 8 }}
          onFinish={(v) => mutation.mutate(v)}
        >
          <Form.Item name="name" label="Тема заявки" rules={[{ required: true, message: 'Укажите тему' }]}>
            <Input
              placeholder="Кратко опишите суть запроса"
              size="large"
              onChange={e => setNameInput(e.target.value)}
            />
          </Form.Item>
          {(similarRequests as any[]).length > 0 && (
            <Alert
              type="warning"
              icon={<ExclamationCircleOutlined />}
              showIcon
              style={{ marginBottom: 16, marginTop: -8 }}
              message="Похожие заявки уже существуют"
              description={
                <div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>
                    Возможно, ваш вопрос уже рассматривается:
                  </div>
                  {(similarRequests as any[]).map((r: any) => (
                    <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <Typography.Link
                        href={`/portal/requests/${r.number}`}
                        target="_blank"
                        style={{ fontSize: 12 }}
                      >
                        {r.number} — {r.name}
                      </Typography.Link>
                      <span style={{ fontSize: 11, color: '#8c8c8c' }}>[{r.status}]</span>
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {needsReportId && (
            <Form.Item
              name="reportId"
              label="Дашборд / отчёт"
              rules={selectedType === 'improvement' ? [{ required: true, message: 'Выберите дашборд' }] : []}
            >
              <Select
                showSearch
                placeholder="Выберите из реестра отчётов"
                allowClear
                filterOption={(input, opt) =>
                  (opt?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
                options={reports.map(r => ({ value: r.id, label: r.name }))}
              />
            </Form.Item>
          )}

          <Form.Item
            name="description"
            label="Описание"
            rules={[{ required: true, message: 'Опишите задачу' }]}
            extra={
              selectedType === 'bugfix'
                ? 'Что происходит, когда возникло, как воспроизвести'
                : 'Что нужно сделать, какие данные использовать'
            }
          >
            <RichEditor placeholder="Подробное описание..." minHeight={140} />
          </Form.Item>

          {/* ── Service Catalog: Bug-specific fields ── */}
          {selectedType === 'bugfix' && (
            <>
              <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#cf1322', marginBottom: 12 }}>
                  🐛 Детали ошибки
                </div>
                <Form.Item name="impact" label="Влияние на работу" style={{ marginBottom: 12 }}>
                  <Select placeholder="Выберите уровень влияния" allowClear
                    options={[
                      { value: 'critical', label: '🔴 Критическое — ничего не работает' },
                      { value: 'high', label: '🟠 Высокое — основная функция недоступна' },
                      { value: 'medium', label: '🟡 Среднее — частичная потеря функциональности' },
                      { value: 'low', label: '🟢 Низкое — незначительные проблемы' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="affectedUsers" label="Кто пострадал?" style={{ marginBottom: 12 }}>
                  <Input placeholder="Например: все пользователи / только я / отдел X" />
                </Form.Item>
                <Form.Item name="stepsToReproduce" label="Шаги воспроизведения" style={{ marginBottom: 12 }}>
                  <Input.TextArea rows={3} placeholder="1. Открыть дашборд X&#10;2. Нажать фильтр Y&#10;3. ..." />
                </Form.Item>
                <Form.Item name="expectedBehavior" label="Ожидаемый результат" style={{ marginBottom: 12 }}>
                  <Input.TextArea rows={2} placeholder="Должно показывать..." />
                </Form.Item>
                <Form.Item name="actualBehavior" label="Фактический результат" style={{ marginBottom: 12 }}>
                  <Input.TextArea rows={2} placeholder="Показывает / происходит..." />
                </Form.Item>
                <Form.Item name="environment" label="Среда (браузер / ОС)" style={{ marginBottom: 0 }}>
                  <Input placeholder="Chrome 120 / Windows 11" />
                </Form.Item>
              </div>
            </>
          )}

          {/* ── Service Catalog: Development-specific fields ── */}
          {selectedType === 'development' && (
            <div style={{ background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#0958d9', marginBottom: 12 }}>
                📊 Требования к дашборду
              </div>
              <Form.Item name="targetAudience" label="Целевая аудитория" style={{ marginBottom: 12 }}>
                <Input placeholder="Кто будет использовать дашборд?" />
              </Form.Item>
              <Form.Item name="dataSources" label="Источники данных" style={{ marginBottom: 12 }}>
                <Input.TextArea rows={2} placeholder="1С, SAP, PostgreSQL, Excel файлы и т.д." />
              </Form.Item>
              <Form.Item name="refreshFrequency" label="Частота обновления данных" style={{ marginBottom: 0 }}>
                <Select placeholder="Выберите частоту" allowClear
                  options={[
                    { value: 'realtime', label: 'В реальном времени' },
                    { value: 'hourly', label: 'Каждый час' },
                    { value: 'daily', label: 'Ежедневно' },
                    { value: 'weekly', label: 'Еженедельно' },
                    { value: 'monthly', label: 'Ежемесячно' },
                  ]}
                />
              </Form.Item>
            </div>
          )}

          {/* ── Service Catalog: Improvement-specific fields ── */}
          {selectedType === 'improvement' && (
            <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#d46b08', marginBottom: 12 }}>
                🔧 Детали доработки
              </div>
              <Form.Item name="targetAudience" label="Кто запросил / целевая аудитория" style={{ marginBottom: 12 }}>
                <Input placeholder="Название подразделения или роль" />
              </Form.Item>
              <Form.Item name="refreshFrequency" label="Нужно изменить частоту обновления?" style={{ marginBottom: 0 }}>
                <Select placeholder="Оставить текущую / изменить" allowClear
                  options={[
                    { value: 'no_change', label: 'Оставить текущую' },
                    { value: 'realtime', label: 'В реальном времени' },
                    { value: 'hourly', label: 'Каждый час' },
                    { value: 'daily', label: 'Ежедневно' },
                    { value: 'weekly', label: 'Еженедельно' },
                    { value: 'monthly', label: 'Ежемесячно' },
                  ]}
                />
              </Form.Item>
            </div>
          )}

          {needsBriefTz && (
            <>
              <Form.Item label="Бриф" extra="PDF, Word, Excel">
                <Upload
                  maxCount={1} beforeUpload={() => false}
                  fileList={briefFile} onChange={({ fileList: fl }) => setBriefFile(fl)}
                  onRemove={() => setBriefFile([])}
                  showUploadList={{ showDownloadIcon: false, removeIcon: <DeleteOutlined /> }}
                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                >
                  <Button icon={<PaperClipOutlined />}>Прикрепить бриф</Button>
                </Upload>
              </Form.Item>

              <Form.Item label="Техническое задание" extra="PDF, Word, Excel">
                <Upload
                  maxCount={1} beforeUpload={() => false}
                  fileList={tzFile} onChange={({ fileList: fl }) => setTzFile(fl)}
                  onRemove={() => setTzFile([])}
                  showUploadList={{ showDownloadIcon: false, removeIcon: <DeleteOutlined /> }}
                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                >
                  <Button icon={<PaperClipOutlined />}>Прикрепить ТЗ</Button>
                </Upload>
              </Form.Item>
            </>
          )}

          <Form.Item
            label={selectedType === 'bugfix' ? 'Вложения' : 'Дополнительные файлы'}
            extra="Скриншоты, примеры, макеты — любые файлы до 20 МБ"
          >
            <Upload
              multiple beforeUpload={() => false}
              fileList={fileList} onChange={({ fileList: fl }) => setFileList(fl)}
              onRemove={(f) => setFileList(prev => prev.filter(x => x.uid !== f.uid))}
              showUploadList={{ showDownloadIcon: false, removeIcon: <DeleteOutlined /> }}
            >
              <Button icon={<PaperClipOutlined />}>Прикрепить файл</Button>
            </Upload>
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
            <Button onClick={() => setModalOpen(false)}>Отмена</Button>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SendOutlined />}
              loading={mutation.isPending}
            >
              Отправить заявку
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
