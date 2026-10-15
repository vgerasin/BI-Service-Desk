import { useState } from 'react';
import {
  Card, Button, Upload, Typography, Space, Alert, Modal,
  Descriptions, Divider, message, Tag,
} from 'antd';
import {
  DownloadOutlined, UploadOutlined, WarningOutlined,
  DatabaseOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import api from '../../api/client';
import Reveal from '../../components/Reveal';
import '../../analytics-glass.css';

const { Title, Text, Paragraph } = Typography;

interface BackupMeta {
  version: string;
  exportedAt: string;
  counts: Record<string, number>;
}

const COUNT_LABELS: Record<string, string> = {
  users: 'Пользователи',
  customers: 'Заказчики',
  contractors: 'Подрядчики',
  dictionaries: 'Словари',
  reports: 'Реестр отчётов',
  requests: 'Заявки',
  timeEntries: 'Трудозатраты',
  artifacts: 'Вложения',
  activities: 'История',
  rates: 'Ставки',
  ratings: 'Оценки заявок',
};

export default function BackupPage() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewMeta, setPreviewMeta] = useState<BackupMeta | null>(null);
  const [importDone, setImportDone] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/admin/backup/export', { responseType: 'blob' });
      const date = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bi-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('Резервная копия скачана');
    } catch {
      message.error('Ошибка при экспорте');
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (file: UploadFile) => {
    const raw = file.originFileObj as File;
    if (!raw) return false;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!parsed.version || !parsed.data) {
          message.error('Неверный формат файла');
          return;
        }
        setPendingFile(raw);
        setPreviewMeta({ version: parsed.version, exportedAt: parsed.exportedAt, counts: parsed.counts });
        setConfirmOpen(true);
      } catch {
        message.error('Не удалось прочитать файл — убедитесь, что это корректный JSON');
      }
    };
    reader.readAsText(raw);
    return false;
  };

  const handleImportConfirm = async () => {
    if (!pendingFile) return;
    setImporting(true);
    setConfirmOpen(false);
    try {
      const formData = new FormData();
      formData.append('file', pendingFile);
      await api.post('/admin/backup/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportDone(true);
      message.success('База данных восстановлена из резервной копии');
    } catch (e: any) {
      message.error(e.response?.data?.message || 'Ошибка при импорте');
    } finally {
      setImporting(false);
      setPendingFile(null);
      setPreviewMeta(null);
    }
  };

  return (
    <div className="analytics-glass" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Резервное копирование</Title>
          <Text type="secondary">Экспорт и импорт всех данных системы</Text>
        </div>

        {importDone && (
          <Alert
            type="success"
            icon={<CheckCircleOutlined />}
            showIcon
            message="Импорт выполнен успешно"
            description="Данные восстановлены. Рекомендуется обновить страницу."
            action={<Button size="small" onClick={() => window.location.reload()}>Обновить</Button>}
          />
        )}

        {/* Export */}
        <Reveal>
        <Card>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space>
              <DatabaseOutlined style={{ fontSize: 20, color: '#007AFF' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Экспорт данных</div>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Скачать все данные системы в формате JSON
                </Text>
              </div>
            </Space>
            <Alert
              type="info"
              showIcon
              message="Что входит в резервную копию"
              description={
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  <div>✅ Пользователи, заявки, трудозатраты, заказчики, исполнители, словари, реестр отчётов, история изменений, оценки заявок (токены и баллы)</div>
                  <div style={{ marginTop: 6, color: '#d48806' }}>
                    ⚠️ <strong>Не включаются физические файлы</strong> вложений (загруженные документы и скриншоты).
                    После восстановления из копии ссылки на вложения в заявках будут нерабочими, если файлы не перенесены вручную из папки <code>uploads/</code>.
                  </div>
                </div>
              }
              style={{ fontSize: 13 }}
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={handleExport}
              size="large"
            >
              Скачать резервную копию
            </Button>
          </Space>
        </Card>
        </Reveal>

        <Divider style={{ margin: 0 }} />

        {/* Import */}
        <Reveal delay={0.08}>
        <Card>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space>
              <UploadOutlined style={{ fontSize: 20, color: '#cf1322' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Импорт данных</div>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Восстановить данные из файла резервной копии
                </Text>
              </div>
            </Space>
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message="Внимание: импорт полностью заменяет все текущие данные"
              description="Все существующие заявки, пользователи, справочники и прочие данные будут удалены и заменены данными из файла. Операция необратима."
              style={{ fontSize: 13 }}
            />
            <Upload
              accept=".json"
              showUploadList={false}
              beforeUpload={(file) => handleFileSelect(file as any)}
              disabled={importing}
            >
              <Button
                icon={<UploadOutlined />}
                loading={importing}
                danger
                size="large"
              >
                {importing ? 'Импорт...' : 'Выбрать файл для импорта'}
              </Button>
            </Upload>
          </Space>
        </Card>
        </Reveal>
      </Space>

      {/* Confirm modal */}
      <Modal
        title={<Space><WarningOutlined style={{ color: '#faad14' }} /> Подтвердите импорт</ Space>}
        open={confirmOpen}
        onCancel={() => { setConfirmOpen(false); setPendingFile(null); setPreviewMeta(null); }}
        onOk={handleImportConfirm}
        okText="Да, заменить все данные"
        cancelText="Отмена"
        okButtonProps={{ danger: true, loading: importing }}
        width={520}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Paragraph style={{ margin: 0 }}>
            Вы собираетесь <strong>полностью заменить</strong> все данные системы данными из резервной копии.
            Это действие <strong>нельзя отменить</strong>.
          </Paragraph>

          {previewMeta && (
            <Descriptions bordered size="small" column={1} style={{ fontSize: 13 }}>
              <Descriptions.Item label="Версия">{previewMeta.version}</Descriptions.Item>
              <Descriptions.Item label="Дата создания">
                {new Date(previewMeta.exportedAt).toLocaleString('ru-RU')}
              </Descriptions.Item>
              <Descriptions.Item label="Содержимое">
                <Space wrap size={4}>
                  {Object.entries(previewMeta.counts || {}).map(([key, count]) => (
                    <Tag key={key} color={count > 0 ? 'blue' : 'default'}>
                      {COUNT_LABELS[key] || key}: {count}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
            </Descriptions>
          )}

          <Alert type="error" showIcon message="После импорта все текущие данные будут безвозвратно удалены." />
        </Space>
      </Modal>
    </div>
  );
}
