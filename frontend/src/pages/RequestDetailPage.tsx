import { APP_NAME } from '../branding';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Descriptions, Tag, Button, Space, Timeline, Upload,
  Table, Modal, Form, Input, Select, InputNumber, DatePicker,
  Typography, Spin, Popconfirm, message, Row, Col, List, Avatar, Tooltip, Statistic, Progress, Image, Badge,
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined, UploadOutlined, DeleteOutlined,
  DownloadOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  LinkOutlined, CopyOutlined, InfoCircleOutlined, ClockCircleOutlined, FileOutlined, PaperClipOutlined as PaperClip2,
  PrinterOutlined, StarFilled, EditOutlined, CloseOutlined, BellOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import {
  BiRequest, RequestStatus, RequestType, UserRole,
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, PRIORITY_LABELS, PRIORITY_COLORS,
} from '../types';
import RichEditor from '../components/RichEditor';
import Reveal from '../components/Reveal';
import EmployeePicker, { EmployeeOption } from '../components/EmployeePicker';
import { useFeatures } from '../hooks/useFeatures';
import CsiQuestionBlock from '../components/CsiQuestionBlock';
import CsiAnswersDisplay from '../components/CsiAnswersDisplay';
import {
  CSI_QUESTIONS, makeCsiInitialAnswers, csiAllAnswered, csiScore, csiAnsweredCount, toCsiAnswerPayload,
} from '../csiQuestions';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { requesterDisplay, shortCompanyName } from '../utils/formatName';
import '../request-detail-glass.css';


// Keep in sync with backend STATUS_TRANSITIONS (requests.service.ts) — "На уточнении" and
// "Согласование" were folded into "Ожидание заказчика" / "На проверке" respectively (too many
// near-duplicate statuses; neither carried distinct SLA/analytics behavior from the status it
// merged into). "В работе → Готово" is now a direct edge for every type, not just bugs — nothing
// forces a request through a review step it doesn't need.
const STATUS_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  [RequestStatus.NEW]: [RequestStatus.QUEUED, RequestStatus.IN_PROGRESS, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.QUEUED]: [RequestStatus.IN_PROGRESS, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.IN_PROGRESS]: [RequestStatus.QUEUED, RequestStatus.WAITING_CUSTOMER, RequestStatus.REVIEW, RequestStatus.DONE, RequestStatus.CANCELLED],
  [RequestStatus.WAITING_CUSTOMER]: [RequestStatus.IN_PROGRESS, RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.REVIEW]: [RequestStatus.IN_PROGRESS, RequestStatus.WAITING_CUSTOMER, RequestStatus.DONE, RequestStatus.REWORK],
  [RequestStatus.REWORK]: [RequestStatus.IN_PROGRESS],
  [RequestStatus.DONE]: [RequestStatus.REVIEW, RequestStatus.IN_PROGRESS, RequestStatus.REWORK],
  [RequestStatus.REJECTED]: [RequestStatus.NEW],
  [RequestStatus.CANCELLED]: [RequestStatus.NEW],
};

const BUG_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  [RequestStatus.NEW]: [RequestStatus.IN_PROGRESS, RequestStatus.WAITING_CUSTOMER, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.QUEUED]: [RequestStatus.IN_PROGRESS, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.IN_PROGRESS]: [RequestStatus.WAITING_CUSTOMER, RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.WAITING_CUSTOMER]: [RequestStatus.IN_PROGRESS, RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.REVIEW]: [RequestStatus.IN_PROGRESS, RequestStatus.DONE, RequestStatus.REWORK],
  [RequestStatus.REWORK]: [RequestStatus.IN_PROGRESS],
  [RequestStatus.DONE]: [RequestStatus.IN_PROGRESS, RequestStatus.REWORK],
  [RequestStatus.REJECTED]: [RequestStatus.NEW],
  [RequestStatus.CANCELLED]: [RequestStatus.NEW],
};

const CLOSE_REASONS = ['Решено', 'Дубль', 'Не воспроизводится', 'Отклонено', 'Отменено инициатором'];
const CLOSE_STATUSES: RequestStatus[] = [RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED];

export default function RequestDetailPage() {
  const features = useFeatures();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [timeModal, setTimeModal] = useState(false);
  const [editingRequester, setEditingRequester] = useState(false);
  const [requesterPick, setRequesterPick] = useState<EmployeeOption | null>(null);
  const [commentModal, setCommentModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [returnModal, setReturnModal] = useState(false);
  const [resumeModal, setResumeModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<RequestStatus | null>(null);
  const [commentHtml, setCommentHtml] = useState('');
  const [returnCommentHtml, setReturnCommentHtml] = useState('');
  const [resumeCommentHtml, setResumeCommentHtml] = useState('');
  const [ratingAnswers, setRatingAnswers] = useState(makeCsiInitialAnswers());
  const [ratingComment, setRatingComment] = useState('');
  const [timeForm] = Form.useForm();
  const [closeForm] = Form.useForm();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [uploadingTypes, setUploadingTypes] = useState<Record<string, boolean>>({});

  const { data: req, isLoading } = useQuery<BiRequest>({
    queryKey: ['request', id],
    queryFn: () => api.get(`/requests/${id}`).then(r => r.data),
  });
  useDocumentTitle(req ? `${req.number} · ${req.name}` : undefined);
  // "Исполнитель" assigns an internal staff member (assigneeId), not an external contractor —
  // contractors are a separate concept used only for Act generation.
  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data.filter((u: any) => u.role !== UserRole.CUSTOMER)),
    enabled: user?.role === UserRole.ADMIN,
  });
  const { data: assigneeLoad = [] } = useQuery({
    queryKey: ['assignee-load'],
    queryFn: () => api.get('/requests', { params: { status: 'in_progress,queued,review,waiting_customer', pageSize: 500 } })
      .then(r => {
        const counts: Record<number, number> = {};
        const list = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        for (const req of list) if (req.assigneeId) counts[req.assigneeId] = (counts[req.assigneeId] || 0) + 1;
        return counts;
      }),
    enabled: user?.role === UserRole.ADMIN,
  });
  const { data: reportsRef = [] } = useQuery({ queryKey: ['reports-ref'], queryFn: () => api.get('/reports-ref').then(r => r.data) });
  const { data: billingCompanies = [] } = useQuery({
    queryKey: ['billing-companies'],
    queryFn: () => api.get('/billing-companies').then(r => r.data),
    enabled: user?.role === UserRole.ADMIN || user?.role === UserRole.EXECUTOR,
  });
  const { data: surveyData } = useQuery({
    queryKey: ['survey-link', id],
    queryFn: () => api.get(`/ratings/request/${id}`).then(r => r.data),
    enabled: req?.status === RequestStatus.DONE,
  });

  const { data: knownErrors = [] } = useQuery({
    queryKey: ['known-errors-list'],
    queryFn: () => api.get('/known-errors').then(r => r.data),
    enabled: req?.type === RequestType.BUGFIX,
  });

  const linkKeMutation = useMutation({
    mutationFn: (keId: number | null) => keId
      ? api.post(`/known-errors/${keId}/link/${id}`)
      : api.put(`/requests/${id}`, { knownErrorId: null }),
    onSuccess: () => { invalidate(); message.success('Known Error обновлён'); },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['request', id] });

  const handleUploadChange = (type: string, successMsg: string) => ({ file }: any) => {
    if (file.status === 'uploading') {
      setUploadingTypes((prev) => ({ ...prev, [type]: true }));
    } else if (file.status === 'done') {
      setUploadingTypes((prev) => ({ ...prev, [type]: false }));
      invalidate();
      message.success(successMsg);
    } else if (file.status === 'error') {
      setUploadingTypes((prev) => ({ ...prev, [type]: false }));
      const serverMsg = file.response?.message;
      message.error(serverMsg ? `Не удалось загрузить файл: ${serverMsg}` : 'Не удалось загрузить файл');
    }
  };

  const statusMutation = useMutation({
    mutationFn: (body: any) => api.post(`/requests/${id}/status`, body),
    onSuccess: () => { invalidate(); message.success('Статус изменён'); },
    // Without this, a rejected transition (e.g. the server's allowed-transitions table disagreeing
    // with this file's copy — see STATUS_TRANSITIONS/BUG_TRANSITIONS above) failed completely
    // silently: no toast, no visible change, nothing — indistinguishable from the button doing
    // nothing at all. Found via a real report: a request stuck in "Ожидание заказчика" couldn't be
    // closed and gave no indication why.
    onError: (err: any) => message.error(err?.response?.data?.message || 'Не удалось изменить статус'),
  });

  const updateMutation = useMutation({
    mutationFn: (dto: any) => api.put(`/requests/${id}`, dto),
    onSuccess: () => { invalidate(); message.success('Сохранено'); },
  });

  // Team leads (users.managerId points at them) can redistribute a request across their own
  // team at any point — not just once right after it lands on them — as long as it's currently
  // on the lead or on one of their direct reports (see RequestsService.delegate). Fetched only
  // for non-admins, since admins already get the full reassignment Select above and have no
  // "my subordinates" concept of their own.
  const { data: mySubordinates = [] } = useQuery({
    queryKey: ['my-subordinates'],
    queryFn: () => api.get('/users/my-subordinates').then(r => r.data),
    enabled: !!user && user.role !== UserRole.ADMIN,
  });
  const delegateMutation = useMutation({
    mutationFn: (assigneeId: number) => api.post(`/requests/${id}/delegate`, { assigneeId }),
    onSuccess: () => { invalidate(); message.success('Заявка передана'); },
  });

  const timeMutation = useMutation({
    mutationFn: (dto: any) => api.post('/time-entries', dto),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['time-entries', { requestId: req?.id }] });
      setTimeModal(false); timeForm.resetFields(); message.success('Записано');
    },
    onError: (e: any) => message.error(e.response?.data?.message || 'Ошибка сохранения'),
  });

  const deleteTimeMutation = useMutation({
    mutationFn: (teId: number) => api.delete(`/time-entries/${teId}`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['time-entries', { requestId: req?.id }] });
      message.success('Запись удалена');
    },
  });

  const commentMutation = useMutation({
    mutationFn: (dto: any) => api.post(`/requests/${id}/comments`, dto),
    onSuccess: () => { invalidate(); setCommentModal(false); setCommentHtml(''); },
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.post(`/requests/${id}/accept`),
    onSuccess: () => { invalidate(); message.success('Заявка принята. Спасибо!'); },
  });

  const remindRatingMutation = useMutation({
    mutationFn: () => api.post(`/requests/${id}/remind-rating`),
    onSuccess: (res: any) => message.success(`Напоминание отправлено на ${res.data.sentTo.join(', ')}`),
    onError: (err: any) => message.error(err?.response?.data?.message || 'Не удалось отправить напоминание'),
  });

  // Reuses the token-based survey endpoint (public, no auth guard) that SurveyPage.tsx posts to —
  // the token itself comes from the authenticated GET /ratings/request/:id call (surveyData
  // below), so no separate backend route is needed just to submit from inside the portal.
  const ratingMutation = useMutation({
    mutationFn: () => api.post(`/ratings/survey/${surveyData?.token}`, {
      answers: toCsiAnswerPayload(ratingAnswers),
      comment: ratingComment || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['survey-link', id] });
      message.success('Спасибо за вашу оценку!');
    },
    onError: () => message.error('Не удалось отправить оценку'),
  });

  const deleteArtifactMutation = useMutation({
    mutationFn: (artId: number) => api.delete(`/requests/artifacts/${artId}`),
    onSuccess: () => { invalidate(); message.success('Файл удалён'); },
  });

  const { data: timeEntriesEnriched = [] } = useQuery({
    queryKey: ['time-entries', { requestId: req?.id }],
    queryFn: () => api.get('/time-entries', { params: { requestId: req?.id } }).then(r => r.data),
    enabled: !!req?.id,
  });

  const factHours = (timeEntriesEnriched as any[]).reduce(
    (s, e) => s + Number(e.hours) * Number(e.quantity || 1), 0,
  );
  const totalCost = (timeEntriesEnriched as any[]).reduce((s, e) => s + Number(e.cost || 0), 0);

  // Click-to-enlarge for every screenshot rendered inside rich content on this page
  // (description, comments, activity log) — delegated so it covers all of them at once
  // instead of wiring up each container individually.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' && target.closest('.rich-content')) {
        setLightboxSrc((target as HTMLImageElement).src);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  if (isLoading) return <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 80 }} />;
  if (!req) return <div>Заявка не найдена</div>;

  const isCustomer = user?.role === UserRole.CUSTOMER;
  const isPortalView = isCustomer || sessionStorage.getItem('bi_view_mode') === 'portal';
  const canEdit = user?.role === UserRole.ADMIN;
  // Unlike the admin-only fields above, "который платит" is something the executor themselves
  // sets when taking a new-dashboard request into work (see requests.service.ts create/update) —
  // not just the admin.
  const canEditBilling = user?.role === UserRole.ADMIN
    || (user?.role === UserRole.EXECUTOR && (req.assignee as any)?.id === user.id);
  const canChangeStatus = !isPortalView && (user?.role === UserRole.ADMIN || user?.role === UserRole.EXECUTOR);
  const isExecutor = user?.role === UserRole.EXECUTOR;
  const transitionMap = req.type === RequestType.BUGFIX ? BUG_TRANSITIONS : STATUS_TRANSITIONS;
  const nextStatuses = transitionMap[req.status] || [];

  const handleStatusClick = (s: RequestStatus) => {
    if (CLOSE_STATUSES.includes(s)) {
      setPendingStatus(s);
      setCloseModal(true);
    } else {
      statusMutation.mutate({ status: s });
    }
  };

  const teColumns = [
    {
      title: '#', width: 50, align: 'center' as const,
      render: (_: any, __: any, idx: number) => idx + 1,
    },
    { title: 'Наименование работ', dataIndex: 'workName',
      render: (v: string, r: any) => (
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || r.workKind || '—'}</div>
      ) },
    { title: 'Дата', dataIndex: 'date', width: 100, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    {
      title: 'Час', dataIndex: 'hours', width: 70, align: 'right' as const,
      render: (v: any) => Number(v).toFixed(1),
    },
    {
      title: 'Кол-во', dataIndex: 'quantity', width: 75, align: 'right' as const,
      render: (v: any) => Number(v || 1).toFixed(0),
    },
    ...(!isExecutor ? [{
      title: 'Стоимость', dataIndex: 'cost', width: 130, align: 'right' as const,
      render: (v: any, r: any) => Number(v) > 0
        ? <span style={{ fontWeight: 600, color: '#1677ff' }}>{Number(v).toLocaleString()} {r.currency}</span>
        : <span style={{ color: '#ccc' }}>—</span>,
    }] : []),
    {
      title: '', width: 50, render: (_: any, r: any) => (
        <Popconfirm title="Удалить запись?" onConfirm={() => deleteTimeMutation.mutate(r.id)}>
          <Button size="small" icon={<DeleteOutlined />} danger />
        </Popconfirm>
      ),
    },
  ];

  const brief = req.artifacts?.find((a: any) => a.artifactType === 'grif');
  const requirements = req.artifacts?.find((a: any) => a.artifactType === 'requirements');
  const graphicsFiles = req.artifacts?.filter((a: any) => a.artifactType === 'graphics') || [];
  const otherFiles = req.artifacts?.filter((a: any) => a.artifactType === 'other' || !a.artifactType) || [];
  const isDevelopment = req.type === 'development';

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => message.success('Ссылка скопирована'))
      .catch(() => message.error('Не удалось скопировать ссылку'));
  };

  // Print-only summary card — hidden on screen, shown (and everything else hidden) via the
  // @media print rules below. Plain HTML/inline styles on purpose: antd's shadows/box-sizing
  // print inconsistently across browsers, a plain sheet is what actually comes out on paper.
  const printMeta: { label: string; value: React.ReactNode }[] = [
    { label: 'Тип услуги', value: TYPE_LABELS[req.type] || req.type },
    { label: 'Статус', value: STATUS_LABELS[req.status] || req.status },
    { label: 'Приоритет', value: PRIORITY_LABELS[req.priority] || req.priority },
    { label: 'Дата подачи', value: dayjs(req.createdAt).format('DD.MM.YYYY') },
    ...(req.plannedDate ? [{ label: 'Плановый срок', value: dayjs(req.plannedDate).format('DD.MM.YYYY') }] : []),
    ...(req.closedAt ? [{ label: 'Дата решения', value: dayjs(req.closedAt).format('DD.MM.YYYY') }] : []),
    {
      label: 'Заявитель',
      value: (() => {
        const r = requesterDisplay(req);
        if (!r.name) return '—';
        return `${r.name}${r.email ? ` (${r.email})` : ''}${r.via ? ` — оформил(а): ${r.via}` : ''}`;
      })(),
    },
    { label: 'Исполнитель', value: (req.assignee as any)?.fullName || '—' },
  ];
  const printAttachments = [
    ...(brief ? [{ label: 'Бриф', name: brief.originalFilename }] : []),
    ...(requirements ? [{ label: 'ТЗ', name: requirements.originalFilename }] : []),
    ...otherFiles.map((a: any) => ({ label: 'Файл', name: a.originalFilename })),
  ];

  const printArea = (
    <div className="bi-print-area">
      <style>{`
        @media screen { .bi-print-area { display: none; } }
        @media print {
          body * { visibility: hidden; }
          .bi-print-area, .bi-print-area * { visibility: visible; }
          .bi-print-area { position: absolute; top: 0; left: 0; width: 100%; padding: 16px 24px; }
        }
      `}</style>
      <div style={{ fontFamily: 'Arial, sans-serif', color: '#1a1a1a' }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{APP_NAME}</div>
        <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>Заявка № {req.number}</h1>
        <div style={{ fontSize: 15, color: '#333', marginBottom: 16 }}>{req.name}</div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <tbody>
            {printMeta.map((m, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px 6px 0', color: '#888', fontSize: 12, width: 160, verticalAlign: 'top' }}>{m.label}</td>
                <td style={{ padding: '6px 0', fontSize: 13 }}>{m.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Описание</div>
        <div
          style={{ border: '1px solid #eee', borderRadius: 4, padding: 12, fontSize: 13, marginBottom: 16 }}
          dangerouslySetInnerHTML={{ __html: req.description || '<em>Не указано</em>' }}
        />

        {printAttachments.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Вложения</div>
            <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 13 }}>
              {printAttachments.map((a, i) => <li key={i}>{a.label}: {a.name}</li>)}
            </ul>
          </>
        )}

        <div style={{ fontSize: 11, color: '#aaa', marginTop: 24 }}>
          Сформировано {dayjs().format('DD.MM.YYYY HH:mm')}
        </div>
      </div>
    </div>
  );

  // Shared full-size preview for any screenshot clicked inside .rich-content (description,
  // comments, activity log) — rendered once so it works regardless of which branch (portal
  // or internal) is active below.
  const lightboxArea = lightboxSrc && (
    <Image
      style={{ display: 'none' }}
      src={lightboxSrc}
      preview={{
        visible: true,
        src: lightboxSrc,
        onVisibleChange: (vis) => { if (!vis) setLightboxSrc(null); },
      }}
    />
  );

  const renderArtifactCard = (label: string, artifact: any, type: string) => (
    <Card
      size="small"
      style={{ borderColor: artifact ? '#52c41a' : '#ff4d4f', background: artifact ? '#f6ffed' : '#fff2f0' }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        <Space>
          {artifact
            ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 15 }} />
            : <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 15 }} />}
          <Typography.Text strong>{label}</Typography.Text>
          {!artifact && <Typography.Text type="secondary" style={{ fontSize: 12 }}>не загружен</Typography.Text>}
        </Space>
        {artifact ? (
          <Space wrap size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{artifact.originalFilename}</Typography.Text>
            <a href={`/api/files/${artifact.storedFilename}`} target="_blank" rel="noreferrer">
              <Button size="small" icon={<DownloadOutlined />}>Скачать</Button>
            </a>
            <Upload
              action={`/api/requests/${id}/artifacts`}
              headers={{ Authorization: `Bearer ${localStorage.getItem('bi_token')}` }}
              data={{ artifactType: type }}
              onChange={handleUploadChange(type, 'Файл обновлён')}
              showUploadList={false} maxCount={1}
            >
              <Button size="small" icon={<UploadOutlined />} loading={!!uploadingTypes[type]}>Заменить</Button>
            </Upload>
            <Popconfirm title="Удалить документ?" onConfirm={() => deleteArtifactMutation.mutate(artifact.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ) : (
          <Upload
            action={`/api/requests/${id}/artifacts`}
            headers={{ Authorization: `Bearer ${localStorage.getItem('bi_token')}` }}
            data={{ artifactType: type }}
            onChange={handleUploadChange(type, 'Файл загружен')}
            showUploadList={false} maxCount={1}
          >
            <Button size="small" icon={<UploadOutlined />} loading={!!uploadingTypes[type]}>Загрузить</Button>
          </Upload>
        )}
      </Space>
    </Card>
  );

  // The "Закрыть заявку" modal already asks the executor for an optional comment when a
  // request moves to done — it's saved as this activity's `details`, but before now it was
  // only visible buried in the timeline. Surfacing the latest one as "Результат выполнения"
  // means whoever's checking (customer deciding whether to accept, or admin reviewing) doesn't
  // have to go dig for it. Shared by both views below since it doesn't depend on the role.
  const doneActivities = (req.activities || [])
    .filter((a: any) => a.action?.endsWith('→ done') && a.details?.trim())
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const completionResult = req.status === RequestStatus.DONE ? doneActivities[0] : undefined;

  // ── Customer / portal view ───────────────────────────────────────────────
  if (isPortalView) {
    const isOverdue = req.plannedDate && !['done', 'rejected', 'cancelled', 'waiting_customer'].includes(req.status)
      && dayjs(req.plannedDate).isBefore(dayjs(), 'day');
    const daysLeft = req.plannedDate && !['done', 'rejected', 'cancelled', 'waiting_customer'].includes(req.status)
      ? dayjs(req.plannedDate).diff(dayjs(), 'day') : null;
    const isNearBreach = daysLeft !== null && daysLeft >= 0 && daysLeft <= 2;

    const portalImgs = otherFiles.filter((a: any) => a.mimeType?.startsWith('image/'));
    const portalDocs = otherFiles.filter((a: any) => !a.mimeType?.startsWith('image/'));

    const infoRow = (label: string, value: React.ReactNode, last = false) => (
      <div style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: last ? 'none' : '1px solid #f5f5f5', alignItems: 'flex-start' }}>
        <span style={{ minWidth: 115, color: '#8c8c8c', fontSize: 12, flexShrink: 0, paddingTop: 1 }}>{label}</span>
        <span style={{ fontSize: 13, color: '#262626', flex: 1 }}>{value}</span>
      </div>
    );

    const infoItems: { label: string; value: React.ReactNode }[] = [
      { label: 'Тип услуги', value: TYPE_LABELS[req.type] },
      { label: 'Приоритет', value: <Tag color={PRIORITY_COLORS[req.priority]}>{PRIORITY_LABELS[req.priority]}</Tag> },
      { label: 'Статус', value: <Tag color={STATUS_COLORS[req.status]}>{STATUS_LABELS[req.status]}</Tag> },
      ...(req.report ? [{
        label: 'Дашборд',
        value: (req.report as any).pbiLink
          ? <a href={(req.report as any).pbiLink} target="_blank" rel="noreferrer">{(req.report as any).name}</a>
          : (req.report as any).name,
      }] : []),
      { label: 'Дата подачи', value: dayjs(req.createdAt).format('DD.MM.YYYY') },
      {
        label: 'Плановый срок',
        value: req.plannedDate
          ? req.status === 'waiting_customer'
            ? <span style={{ color: '#08979c' }}>
                {dayjs(req.plannedDate).format('DD.MM.YYYY')} <Tag color="cyan" style={{ marginLeft: 4 }}>⏸ SLA приостановлен</Tag>
              </span>
            : <span style={{ color: isOverdue ? '#ff4d4f' : isNearBreach ? '#d48806' : undefined, fontWeight: (isOverdue || isNearBreach) ? 600 : undefined }}>
                {dayjs(req.plannedDate).format('DD.MM.YYYY')}
                {isOverdue && <Tag color="red" style={{ marginLeft: 4 }}>Просрочено</Tag>}
                {isNearBreach && !isOverdue && <Tag color="orange" style={{ marginLeft: 4 }}>⚡ {daysLeft}д</Tag>}
              </span>
          : <span style={{ color: '#bbb' }}>—</span>,
      },
      ...(req.closedAt ? [{ label: 'Дата решения', value: dayjs(req.closedAt).format('DD.MM.YYYY') }] : []),
      ...(req.closeReason ? [{ label: 'Причина закрытия', value: <Tag>{req.closeReason}</Tag> }] : []),
      ...(req.acceptedByCustomerAt ? [{ label: 'Принято заказчиком', value: <span style={{ color: '#52c41a', fontWeight: 600 }}>✓ {dayjs(req.acceptedByCustomerAt).format('DD.MM.YYYY')}</span> }] : []),
    ];

    return (
      <div className="request-detail-glass">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/portal')} style={{ flexShrink: 0, marginTop: 2 }}>
            К списку
          </Button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Title level={4} style={{ margin: 0, lineHeight: 1.3 }}>{req.name}</Typography.Title>
            <div style={{ marginTop: 4, fontSize: 12, color: '#aaa' }}>{req.number}</div>
          </div>
          <Space style={{ flexShrink: 0 }}>
            <Tooltip title="Скопировать ссылку"><Button icon={<LinkOutlined />} onClick={copyLink} /></Tooltip>
            <Tooltip title="Печатная форма"><Button icon={<PrinterOutlined />} onClick={() => window.print()} /></Tooltip>
          </Space>
        </div>

        {/* REVIEW banner — unlike WAITING_CUSTOMER/DONE below, this status previously had no
            portal-facing explanation at all: a customer would see the "На проверке" status tag
            in the info panel and nothing else, with no clue what it means or what (if anything)
            they need to do. That silence read as "the app doesn't offer a way to close the
            request", prompting exactly that question. Now mirrors the WAITING_CUSTOMER banner's
            self-service close button — the backend (changeStatus's customer-role guard) accepts
            DONE from REVIEW the same way it already accepted DONE from WAITING_CUSTOMER, so a
            requester who's happy with the result doesn't have to wait for staff to formally
            close what they've already seen and approved. */}
        {req.status === RequestStatus.REVIEW && (
          <Card size="small" style={{ marginBottom: 16, borderColor: '#d3adf7', background: '#f9f0ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>🔍</span>
                <div>
                  <Typography.Text strong style={{ color: '#722ed1' }}>Заявка на финальной проверке</Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                    Наша команда завершает работу. Если результат уже вас устраивает — можете закрыть заявку сами.
                    Либо просто дождитесь уведомления: мы закроем её после проверки.
                  </Typography.Text>
                </div>
              </div>
              <Button
                type="primary"
                style={{ flexShrink: 0 }}
                loading={statusMutation.isPending}
                onClick={() => {
                  Modal.confirm({
                    title: 'Закрыть заявку как выполненную?',
                    content: 'Используйте, если результат уже устраивает и дальнейшая проверка не нужна.',
                    okText: 'Готово, выполнено',
                    cancelText: 'Отмена',
                    onOk: () => statusMutation.mutate({ status: RequestStatus.DONE }),
                  });
                }}
              >
                Всё устраивает, закрыть
              </Button>
            </div>
          </Card>
        )}

        {/* WAITING_CUSTOMER banner */}
        {req.status === RequestStatus.WAITING_CUSTOMER && (
          <Card size="small" style={{ marginBottom: 16, borderColor: '#08979c', background: '#e6fffb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>⏸</span>
                <div>
                  <Typography.Text strong style={{ color: '#08979c' }}>Ожидание вашего ответа</Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                    Выполнение заявки приостановлено. SLA не начисляется. Пожалуйста, ответьте на вопросы команды в комментариях.
                  </Typography.Text>
                </div>
              </div>
              <Space style={{ flexShrink: 0 }} wrap>
                <Button
                  loading={statusMutation.isPending}
                  onClick={() => {
                    Modal.confirm({
                      title: 'Закрыть заявку как выполненную?',
                      content: 'Используйте, если ваш ответ уже полностью закрывает вопрос и дальнейшая работа не нужна.',
                      okText: 'Готово, выполнено',
                      cancelText: 'Отмена',
                      onOk: () => statusMutation.mutate({ status: RequestStatus.DONE }),
                    });
                  }}
                >
                  Готово, выполнено
                </Button>
                <Button type="primary" onClick={() => setResumeModal(true)}>
                  Возобновить работу
                </Button>
              </Space>
            </div>
          </Card>
        )}

        {/* Done: accept or return for rework */}
        {req.status === RequestStatus.DONE && !req.acceptedByCustomerAt && (
          <Card size="small" style={{ marginBottom: 16, borderColor: '#52c41a', background: '#f6ffed' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <Typography.Text strong>Заявка выполнена.</Typography.Text>
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                  Пожалуйста, проверьте результат и подтвердите приёмку или верните на доработку.
                </Typography.Text>
              </div>
              <Space>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => acceptMutation.mutate()} loading={acceptMutation.isPending}>
                  Принять
                </Button>
                <Button danger onClick={() => setReturnModal(true)}>Вернуть на доработку</Button>
              </Space>
            </div>
          </Card>
        )}
        {req.status === RequestStatus.DONE && req.acceptedByCustomerAt && (
          <Card size="small" style={{ marginBottom: 16, borderColor: '#52c41a', background: '#f6ffed' }}>
            <Typography.Text style={{ color: '#52c41a', fontWeight: 600 }}>
              ✓ Заявка принята заказчиком {dayjs(req.acceptedByCustomerAt).format('DD.MM.YYYY')}
            </Typography.Text>
          </Card>
        )}

        <Row gutter={[16, 16]}>
          {/* LEFT: Description + Attachments */}
          <Col xs={24} md={16}>
            <Reveal>
            {req.description ? (
              <Card title="Описание" size="small" style={{ marginBottom: 12 }}>
                <div
                  className="rich-content"
                  dangerouslySetInnerHTML={{ __html: req.description }}
                />
              </Card>
            ) : (
              <Card size="small" style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary">Описание не указано</Typography.Text>
              </Card>
            )}

            {/* Rating form — embedded directly here (right under the description, where a
                customer is already looking) so they don't need the separate emailed
                /survey/:token link just to rate work they're already reviewing. */}
            {req.status === RequestStatus.DONE && surveyData?.token && (
              <Card
                size="small"
                style={{ marginBottom: 12, borderColor: '#ffe58f', background: surveyData.submittedAt ? undefined : '#fffbe6' }}
                title={<span style={{ color: '#d48806' }}><StarFilled style={{ marginRight: 6 }} />Оценка выполнения</span>}
              >
                {surveyData.submittedAt ? (
                  <div>
                    <Typography.Text style={{ color: '#52c41a', fontWeight: 600 }}>✓ Спасибо, ваша оценка учтена</Typography.Text>
                    <div style={{ marginTop: 6 }}>
                      <CsiAnswersDisplay answers={surveyData.answers} avgScore={surveyData.avgScore} comment={surveyData.comment} />
                    </div>
                  </div>
                ) : (
                  <>
                    {CSI_QUESTIONS.map((q, i) => (
                      <CsiQuestionBlock
                        key={q.key}
                        index={i}
                        question={q}
                        value={ratingAnswers[q.key]}
                        onChange={v => setRatingAnswers(a => ({ ...a, [q.key]: v }))}
                      />
                    ))}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: '#fff', borderRadius: 8, padding: '8px 12px', margin: '2px 0 14px', fontSize: 12.5, color: '#d48806',
                    }}>
                      <span>Отвечено: {csiAnsweredCount(ratingAnswers)} / 5</span>
                      <span style={{ fontWeight: 700 }}>{csiAnsweredCount(ratingAnswers) > 0 ? csiScore(ratingAnswers) : '—'} / 5</span>
                    </div>
                    <Input.TextArea
                      rows={2}
                      style={{ marginTop: 0 }}
                      placeholder="Комментарий (необязательно)"
                      value={ratingComment}
                      onChange={e => setRatingComment(e.target.value)}
                    />
                    <Button
                      type="primary"
                      style={{ marginTop: 12, background: '#d48806', borderColor: '#d48806' }}
                      disabled={!csiAllAnswered(ratingAnswers)}
                      loading={ratingMutation.isPending}
                      onClick={() => ratingMutation.mutate()}
                    >
                      Отправить оценку
                    </Button>
                  </>
                )}
              </Card>
            )}

            {completionResult && (
              <Card
                size="small"
                style={{ marginBottom: 12, borderColor: '#b7eb8f', background: '#f6ffed' }}
                title={<span style={{ color: '#389e0d' }}><CheckCircleOutlined style={{ marginRight: 6 }} />Результат выполнения</span>}
              >
                <div className="rich-content" dangerouslySetInnerHTML={{ __html: completionResult.details }} />
              </Card>
            )}

            {(portalImgs.length > 0 || portalDocs.length > 0 || brief || requirements) && (
              <Card
                title={`Вложения (${otherFiles.length + (brief ? 1 : 0) + (requirements ? 1 : 0)})`}
                size="small"
              >
                {/* Screenshots grid — clickable */}
                {portalImgs.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: portalDocs.length || brief || requirements ? 12 : 0 }}>
                    {portalImgs.map((a: any) => (
                      <div
                        key={a.id}
                        onClick={() => setLightboxSrc(`/api/files/${a.storedFilename}`)}
                        style={{
                          width: 90, height: 90, borderRadius: 8, overflow: 'hidden',
                          border: '1px solid #e8e8e8', cursor: 'zoom-in', flexShrink: 0,
                          background: '#f5f5f5',
                        }}
                      >
                        <img
                          src={`/api/files/${a.storedFilename}`}
                          alt={a.originalFilename}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Docs list */}
                {portalDocs.map((a: any) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <Typography.Text style={{ fontSize: 13 }} ellipsis>{a.originalFilename}</Typography.Text>
                    <a href={`/api/files/${a.storedFilename}`} target="_blank" rel="noreferrer">
                      <Button size="small" icon={<DownloadOutlined />} />
                    </a>
                  </div>
                ))}
                {brief && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <Typography.Text style={{ fontSize: 13 }}>Бриф: {brief.originalFilename}</Typography.Text>
                    <a href={`/api/files/${brief.storedFilename}`} target="_blank" rel="noreferrer">
                      <Button size="small" icon={<DownloadOutlined />} />
                    </a>
                  </div>
                )}
                {requirements && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                    <Typography.Text style={{ fontSize: 13 }}>ТЗ: {requirements.originalFilename}</Typography.Text>
                    <a href={`/api/files/${requirements.storedFilename}`} target="_blank" rel="noreferrer">
                      <Button size="small" icon={<DownloadOutlined />} />
                    </a>
                  </div>
                )}
              </Card>
            )}
            </Reveal>
          </Col>

          {/* RIGHT: Info + Заявитель + Исполнитель + Discussion */}
          <Col xs={24} md={8}>
            <Reveal delay={0.08}>
            {/* Info card */}
            <Card size="small" style={{ marginBottom: 12 }}>
              {infoItems.map((item, idx) => infoRow(item.label, item.value, idx === infoItems.length - 1))}
            </Card>

            {/* Заявитель */}
            <Card
              size="small"
              title={<span style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>Заявитель</span>}
              style={{ marginBottom: 12 }}
            >
              {requesterDisplay(req).name ? (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{requesterDisplay(req).name}</div>
                  {!requesterDisplay(req).via && (req.createdBy as any)?.position && (
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>{(req.createdBy as any).position}</div>
                  )}
                  {requesterDisplay(req).email && (
                    <div style={{ fontSize: 12, color: '#555' }}>✉ {requesterDisplay(req).email}</div>
                  )}
                  {requesterDisplay(req).via && (
                    <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>оформил(а): {requesterDisplay(req).via}</div>
                  )}
                </div>
              ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>—</Typography.Text>}
            </Card>

            {/* Исполнитель */}
            <Card
              size="small"
              title={<span style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>Исполнитель</span>}
              style={{ marginBottom: 12 }}
            >
              {req.assignee ? (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{(req.assignee as any).fullName}</div>
                  {(req.assignee as any).email && (
                    <div style={{ fontSize: 12, color: '#555' }}>✉ {(req.assignee as any).email}</div>
                  )}
                </div>
              ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>Не назначен</Typography.Text>}
            </Card>

            {/* Discussion */}
            <Card
              size="small"
              title="Обсуждение"
              extra={<Button size="small" onClick={() => setCommentModal(true)}>+ Комментарий</Button>}
              style={{ maxHeight: 520, overflowY: 'auto' }}
            >
              {(req.activities || []).length === 0
                ? <Typography.Text type="secondary" style={{ fontSize: 13 }}>Активностей пока нет</Typography.Text>
                : (
                  <Timeline
                    style={{ marginTop: 4 }}
                    items={[...(req.activities || [])].reverse().map(a => ({
                      color: a.action.includes('Статус') ? 'blue' : a.action.includes('Комментарий') ? 'green' : 'gray',
                      children: (
                        <div>
                          <div><Typography.Text strong style={{ fontSize: 12 }}>{a.action}</Typography.Text></div>
                          {a.details && (
                            <div
                              className="rich-content"
                              style={{ color: '#555', fontSize: 12 }}
                              dangerouslySetInnerHTML={{ __html: a.details }}
                            />
                          )}
                          <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                            {a.author?.fullName} · {dayjs(a.createdAt).format('DD.MM.YYYY HH:mm')}
                          </div>
                        </div>
                      ),
                    }))}
                  />
                )}
            </Card>
            </Reveal>
          </Col>
        </Row>

        {lightboxArea}

        {/* Comment modal */}
        <Modal title="Добавить комментарий" open={commentModal}
          onCancel={() => { setCommentModal(false); setCommentHtml(''); }}
          onOk={() => {
            if (!commentHtml.trim()) { message.warning('Введите текст'); return; }
            commentMutation.mutate({ text: commentHtml });
          }}
          confirmLoading={commentMutation.isPending} width={560}
        >
          <div style={{ marginTop: 8 }}>
            <RichEditor value={commentHtml} onChange={setCommentHtml} placeholder="Ваш комментарий..." minHeight={120} requestId={Number(id)} />
          </div>
        </Modal>

        {/* Return for rework modal */}
        <Modal title="Вернуть на доработку" open={returnModal}
          onCancel={() => { setReturnModal(false); setReturnCommentHtml(''); }}
          onOk={() => {
            if (!returnCommentHtml.trim()) { message.warning('Опишите, что нужно исправить'); return; }
            statusMutation.mutate({ status: RequestStatus.REWORK, comment: returnCommentHtml });
            setReturnModal(false);
            setReturnCommentHtml('');
          }}
          confirmLoading={statusMutation.isPending}
          okText="Вернуть на доработку"
          okButtonProps={{ danger: true }}
          width={560}
        >
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Опишите, что не соответствует ожиданиям. Исполнитель увидит этот комментарий.
          </Typography.Text>
          <RichEditor value={returnCommentHtml} onChange={setReturnCommentHtml} placeholder="Что нужно исправить..." minHeight={120} requestId={Number(id)} />
        </Modal>

        {/* Resume after answering the team's question */}
        <Modal title="Возобновить работу" open={resumeModal}
          onCancel={() => { setResumeModal(false); setResumeCommentHtml(''); }}
          onOk={() => {
            if (!resumeCommentHtml.trim()) { message.warning('Введите ваш ответ команде'); return; }
            statusMutation.mutate({ status: RequestStatus.IN_PROGRESS, comment: resumeCommentHtml });
            setResumeModal(false);
            setResumeCommentHtml('');
          }}
          confirmLoading={statusMutation.isPending}
          okText="Возобновить работу"
          width={560}
        >
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Ваш ответ появится в обсуждении заявки, команда увидит его и продолжит работу.
          </Typography.Text>
          <RichEditor value={resumeCommentHtml} onChange={setResumeCommentHtml} placeholder="Ваш ответ на вопрос команды..." minHeight={120} requestId={Number(id)} />
        </Modal>

        {printArea}
      </div>
    );
  }

  // ── Admin / internal staff view ──────────────────────────────────────────
  return (
    <div className="request-detail-glass">
      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/requests')}>К списку</Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {req.number} — {req.name}
        </Typography.Title>
        <Tag color={STATUS_COLORS[req.status]}>{STATUS_LABELS[req.status]}</Tag>
        <Tag color={PRIORITY_COLORS[req.priority]}>{PRIORITY_LABELS[req.priority]}</Tag>
        <Tooltip title="Скопировать ссылку"><Button size="small" icon={<LinkOutlined />} onClick={copyLink} /></Tooltip>
        <Tooltip title="Печатная форма"><Button size="small" icon={<PrinterOutlined />} onClick={() => window.print()} /></Tooltip>
      </Space>

      {canChangeStatus && nextStatuses.length > 0 && (
        <Space wrap style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">Перевести в:</Typography.Text>
          {nextStatuses.map(s => (
            <Button
              key={s}
              size="small"
              danger={s === RequestStatus.REJECTED || s === RequestStatus.CANCELLED}
              type={s === RequestStatus.DONE ? 'primary' : 'default'}
              onClick={() => handleStatusClick(s)}
            >
              {STATUS_LABELS[s]}
            </Button>
          ))}
        </Space>
      )}

      <Tabs defaultActiveKey="info" size="large" items={[
        {
          key: 'info', label: <span><InfoCircleOutlined /> Детали</span>,
          children: (() => {
            const adminIsOverdue = req.plannedDate && !['done', 'rejected', 'cancelled', 'waiting_customer'].includes(req.status)
              && dayjs(req.plannedDate).isBefore(dayjs(), 'day');
            const adminDaysLeft = req.plannedDate && !['done', 'rejected', 'cancelled', 'waiting_customer'].includes(req.status)
              ? dayjs(req.plannedDate).diff(dayjs(), 'day') : null;
            const adminNearBreach = adminDaysLeft !== null && adminDaysLeft >= 0 && adminDaysLeft <= 2;

            const adminInfoRow = (label: string, value: React.ReactNode, last = false) => (
              <div style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: last ? 'none' : '1px solid #f5f5f5', alignItems: 'flex-start' }}>
                <span style={{ minWidth: 115, color: '#8c8c8c', fontSize: 12, flexShrink: 0, paddingTop: 2 }}>{label}</span>
                <span style={{ fontSize: 13, color: '#262626', flex: 1 }}>{value}</span>
              </div>
            );

            const adminInfoItems: { label: string; value: React.ReactNode }[] = [
              {
                label: 'Тип услуги',
                value: canEdit
                  ? <Select size="small" value={req.type} style={{ width: '100%' }}
                      onChange={v => updateMutation.mutate({ type: v })}
                      options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
                  : TYPE_LABELS[req.type],
              },
              { label: 'Приоритет', value: <Tag color={PRIORITY_COLORS[req.priority]}>{PRIORITY_LABELS[req.priority]}</Tag> },
              { label: 'Статус', value: <Tag color={STATUS_COLORS[req.status]}>{STATUS_LABELS[req.status]}</Tag> },
              {
                label: 'Юрлицо',
                value: canEditBilling
                  ? <Select
                      size="small" style={{ width: '100%' }}
                      value={(req as any).billingCompanyId ?? undefined}
                      placeholder="Выберите юрлицо"
                      onChange={v => updateMutation.mutate({ billingCompanyId: v })}
                      options={billingCompanies.map((c: any) => ({ value: c.id, label: c.shortName || shortCompanyName(c.name) }))}
                    />
                  : ((req as any).billingCompany?.name
                      ? <Tooltip title={(req as any).billingCompany.name}>
                          <span>{(req as any).billingCompany.shortName || shortCompanyName((req as any).billingCompany.name)}</span>
                        </Tooltip>
                      : <span style={{ color: '#bbb' }}>—</span>),
              },
              ...(req.report ? [{
                label: 'Дашборд',
                // No href on purpose (in-app navigate, not a real URL) — but without one a
                // bare <a> gets no default browser link styling at all, so it must be styled
                // explicitly or it's visually indistinguishable from plain text.
                value: (
                  <a
                    onClick={() => navigate(`/admin/reports-ref/${(req.report as any).id}`)}
                    style={{ color: '#1677ff', cursor: 'pointer' }}
                  >
                    {(req.report as any).name}
                  </a>
                ),
              }] : []),
              { label: 'Дата подачи', value: dayjs(req.createdAt).format('DD.MM.YYYY HH:mm') },
              {
                label: 'Плановый срок',
                value: canEdit
                  ? <DatePicker
                      size="small" style={{ width: '100%' }} format="DD.MM.YYYY"
                      value={req.plannedDate ? dayjs(req.plannedDate) : null}
                      onChange={d => updateMutation.mutate({ plannedDate: d ? d.format('YYYY-MM-DD') : null })}
                    />
                  : req.plannedDate
                  ? req.status === 'waiting_customer'
                    ? <span style={{ color: '#08979c' }}>{dayjs(req.plannedDate).format('DD.MM.YYYY')} <Tag color="cyan">⏸ Приостановлен</Tag></span>
                    : <span style={{ color: adminIsOverdue ? '#ff4d4f' : adminNearBreach ? '#d48806' : undefined, fontWeight: (adminIsOverdue || adminNearBreach) ? 600 : undefined }}>
                        {dayjs(req.plannedDate).format('DD.MM.YYYY')}
                        {adminIsOverdue && <Tag color="red" style={{ marginLeft: 4 }}>Просрочено</Tag>}
                        {adminNearBreach && !adminIsOverdue && <Tag color="orange" style={{ marginLeft: 4 }}>⚡ {adminDaysLeft}д</Tag>}
                      </span>
                  : <span style={{ color: '#bbb' }}>—</span>,
              },
              ...(req.plannedHours ? [{ label: 'Плановые часы', value: `${req.plannedHours} ч` }] : []),
              ...(req.closedAt ? [{ label: 'Дата решения', value: dayjs(req.closedAt).format('DD.MM.YYYY') }] : []),
              ...(req.closeReason ? [{ label: 'Причина закрытия', value: <Tag>{req.closeReason}</Tag> }] : []),
              ...(req.acceptedByCustomerAt ? [{ label: 'Принято заказчиком', value: <span style={{ color: '#52c41a', fontWeight: 600 }}>✓ {dayjs(req.acceptedByCustomerAt).format('DD.MM.YYYY')}</span> }] : []),
              ...(req.waitingForCustomerSeconds && req.waitingForCustomerSeconds > 0 ? [{ label: 'Время ожидания', value: `${Math.round(req.waitingForCustomerSeconds / 3600)} ч (не считается в SLA)` }] : []),
            ];

            return (
              <Row gutter={[16, 16]}>
                {/* ── LEFT: Description + Plan/Fact + Survey ── */}
                <Col xs={24} md={16}>
                  <Reveal>
                  {req.description ? (
                    <Card title="Описание" size="small" style={{ marginBottom: 12 }}>
                      <div className="rich-content" dangerouslySetInnerHTML={{ __html: req.description }} />
                    </Card>
                  ) : (
                    <Card size="small" style={{ marginBottom: 12 }}>
                      <Typography.Text type="secondary">Описание не указано</Typography.Text>
                    </Card>
                  )}

                  {completionResult && (
                    <Card
                      size="small"
                      style={{ marginBottom: 12, borderColor: '#b7eb8f', background: '#f6ffed' }}
                      title={<span style={{ color: '#389e0d' }}><CheckCircleOutlined style={{ marginRight: 6 }} />Результат выполнения</span>}
                    >
                      <div className="rich-content" dangerouslySetInnerHTML={{ __html: completionResult.details }} />
                    </Card>
                  )}

                  {(req.plannedHours || factHours > 0) && (
                    <Card size="small" style={{ marginBottom: 12, background: '#f8f9fb', border: '1px solid #e6ebf1' }}>
                      <Row gutter={16}>
                        <Col span={8}>
                          <Statistic title="План, ч" value={req.plannedHours ?? 0} precision={1}
                            valueStyle={{ fontSize: 18, color: '#595959' }} />
                        </Col>
                        <Col span={8}>
                          <Statistic title="Факт, ч" value={factHours} precision={1}
                            valueStyle={{ fontSize: 18, color: factHours > (req.plannedHours ?? 0) && (req.plannedHours ?? 0) > 0 ? '#ff4d4f' : '#1677ff' }} />
                        </Col>
                        {!isExecutor && totalCost > 0 && (
                          <Col span={8}>
                            <Statistic title="Стоимость"
                              value={totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              suffix="₽" valueStyle={{ fontSize: 18, color: '#52c41a' }} />
                          </Col>
                        )}
                      </Row>
                      {req.plannedHours ? (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 4 }}>
                            <span>Выполнение</span>
                            <span>{Math.min(Math.round(factHours / req.plannedHours * 100), 100)}%</span>
                          </div>
                          <Progress percent={Math.min(Math.round(factHours / req.plannedHours * 100), 100)} size="small"
                            status={factHours > req.plannedHours ? 'exception' : 'active'} showInfo={false} />
                        </div>
                      ) : null}
                    </Card>
                  )}

                  {req.status === RequestStatus.DONE && surveyData?.token && (
                    <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: '#52c41a', fontWeight: 600, marginBottom: 2 }}>
                            <LinkOutlined style={{ marginRight: 4 }} />Ссылка на опрос заказчика
                          </div>
                          <Typography.Text style={{ fontSize: 12, color: '#555', wordBreak: 'break-all' }}
                            copyable={{ icon: [<CopyOutlined />, <CheckCircleOutlined />], tooltips: ['Скопировать', 'Скопировано!'] }}>
                            {`${window.location.origin}/survey/${surveyData.token}`}
                          </Typography.Text>
                        </div>
                        <Tag color={surveyData.submittedAt ? 'green' : 'orange'} style={{ flexShrink: 0 }}>
                          {surveyData.submittedAt ? 'Пройден ✓' : 'Не пройден'}
                        </Tag>
                      </div>
                      {surveyData.avgScore && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
                          Оценка: <Typography.Text strong style={{ color: '#faad14' }}>★ {Number(surveyData.avgScore).toFixed(1)}</Typography.Text>
                        </div>
                      )}
                      {!surveyData.submittedAt && canChangeStatus && (
                        <Button
                          size="small"
                          icon={<BellOutlined />}
                          style={{ marginTop: 8 }}
                          loading={remindRatingMutation.isPending}
                          onClick={() => remindRatingMutation.mutate()}
                        >
                          Напомнить про оценку
                        </Button>
                      )}
                    </Card>
                  )}

                  {/* Full per-question breakdown for admin/executor — previously only the score
                      number above was visible here, the actual answers were only shown on the
                      customer's own view of the request. */}
                  {surveyData?.submittedAt && (
                    <Card
                      size="small"
                      style={{ marginTop: 12, borderColor: '#ffe58f' }}
                      title={<span style={{ fontSize: 12, color: '#d48806', fontWeight: 500 }}><StarFilled style={{ marginRight: 6 }} />Оценка заказчика</span>}
                    >
                      <CsiAnswersDisplay answers={surveyData.answers} comment={surveyData.comment} />
                    </Card>
                  )}
                  </Reveal>
                </Col>

                {/* ── RIGHT: Info + Заявитель + Исполнитель + Activity ── */}
                <Col xs={24} md={8}>
                  <Reveal delay={0.08}>
                  {/* Info card */}
                  <Card size="small" style={{ marginBottom: 12 }}>
                    {adminInfoItems.map((item, idx) => adminInfoRow(item.label, item.value, idx === adminInfoItems.length - 1))}
                  </Card>

                  {/* Заявитель */}
                  <Card size="small"
                    title={<span style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>Заявитель</span>}
                    extra={canEdit && features.hrDirectory && !editingRequester && (
                      <Button
                        type="text" size="small" icon={<EditOutlined />}
                        onClick={() => { setRequesterPick(null); setEditingRequester(true); }}
                      />
                    )}
                    style={{ marginBottom: 12 }}
                  >
                    {editingRequester ? (
                      <div>
                        <EmployeePicker value={requesterPick} onChange={setRequesterPick} />
                        <Space style={{ marginTop: 8 }}>
                          <Button
                            type="primary" size="small"
                            disabled={!requesterPick}
                            loading={updateMutation.isPending}
                            onClick={() => {
                              if (!requesterPick) return;
                              updateMutation.mutate(
                                { onBehalfOfName: requesterPick.fullName, onBehalfOfEmail: requesterPick.email },
                                { onSuccess: () => setEditingRequester(false) },
                              );
                            }}
                          >
                            Сохранить
                          </Button>
                          {(req as any).onBehalfOfName && (
                            <Button
                              size="small"
                              loading={updateMutation.isPending}
                              onClick={() => updateMutation.mutate(
                                { onBehalfOfName: null, onBehalfOfEmail: null },
                                { onSuccess: () => setEditingRequester(false) },
                              )}
                            >
                              Сбросить на автора
                            </Button>
                          )}
                          <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingRequester(false)} />
                        </Space>
                      </div>
                    ) : requesterDisplay(req).name ? (
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{requesterDisplay(req).name}</div>
                        {!requesterDisplay(req).via && (req.createdBy as any)?.position && (
                          <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>{(req.createdBy as any).position}</div>
                        )}
                        {requesterDisplay(req).email && (
                          <div style={{ fontSize: 12, color: '#555' }}>✉ {requesterDisplay(req).email}</div>
                        )}
                        {requesterDisplay(req).via && (
                          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>оформил(а): {requesterDisplay(req).via}</div>
                        )}
                      </div>
                    ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>—</Typography.Text>}
                  </Card>

                  {/* Исполнитель */}
                  <Card size="small"
                    title={<span style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>Исполнитель</span>}
                    style={{ marginBottom: 12 }}
                  >
                    {canEdit ? (
                      <>
                        <Select
                          style={{ width: '100%', marginBottom: 8 }}
                          value={req.assigneeId}
                          allowClear
                          placeholder="Назначить исполнителя"
                          onChange={v => updateMutation.mutate({ assigneeId: v || null })}
                          size="small"
                          showSearch
                          optionFilterProp="label"
                        >
                          {(assignableUsers as any[]).map((u: any) => {
                            const load = (assigneeLoad as Record<number, number>)[u.id] || 0;
                            return (
                              <Select.Option key={u.id} value={u.id} label={u.fullName}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span>{u.fullName}</span>
                                  {load > 0 && (
                                    <span style={{ fontSize: 11, color: load >= 5 ? '#ff4d4f' : load >= 3 ? '#fa8c16' : '#52c41a', fontWeight: 700 }}>
                                      {load} заявок
                                    </span>
                                  )}
                                </div>
                              </Select.Option>
                            );
                          })}
                        </Select>
                        {req.assignee && (req.assignee as any).email && (
                          <div style={{ fontSize: 12, color: '#555' }}>✉ {(req.assignee as any).email}</div>
                        )}
                      </>
                    ) : (
                      <>
                        {req.assignee ? (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{(req.assignee as any).fullName}</div>
                            {(req.assignee as any).email && <div style={{ fontSize: 12, color: '#555' }}>✉ {(req.assignee as any).email}</div>}
                          </div>
                        ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>Не назначен</Typography.Text>}
                        {(() => {
                          const isUnassigned = req.assigneeId == null;
                          const inMyTeam = req.assigneeId === user?.id
                            || mySubordinates.some((u: any) => u.id === req.assigneeId);
                          // Unassigned: anyone can claim it for themselves (matches "Все заявки"
                          // already being company-wide, not just their own) — a lead additionally
                          // sees their subordinates as direct targets. Already assigned: only
                          // redistributable within the lead's own team, same as before.
                          if (!isUnassigned && !inMyTeam) return null;
                          if (!isUnassigned && mySubordinates.length === 0) return null;
                          // Whoever holds it right now doesn't need to appear as a target too.
                          const options = [
                            ...(user?.id !== req.assigneeId ? [{ id: user!.id, fullName: `${user!.fullName} (я)` }] : []),
                            ...mySubordinates.filter((u: any) => u.id !== req.assigneeId),
                          ];
                          if (options.length === 0) return null;
                          return (
                            <Select
                              style={{ width: '100%', marginTop: 8 }}
                              size="small"
                              placeholder={isUnassigned ? 'Взять в работу / передать' : 'Передать в команде'}
                              value={undefined}
                              onChange={v => delegateMutation.mutate(v)}
                              loading={delegateMutation.isPending}
                            >
                              {options.map((u: any) => (
                                <Select.Option key={u.id} value={u.id}>{u.fullName}</Select.Option>
                              ))}
                            </Select>
                          );
                        })()}
                      </>
                    )}
                  </Card>

                  {/* Known Error link (bug requests only) */}
                  {req.type === RequestType.BUGFIX && (
                    <Card size="small"
                      title={<span style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>🐛 Известная ошибка (KE)</span>}
                      style={{ marginBottom: 12 }}
                      extra={req.knownErrorId && (
                        <Button size="small" type="link" style={{ padding: 0, fontSize: 11 }}
                          onClick={() => window.open('/admin/known-errors', '_blank')}>
                          Открыть
                        </Button>
                      )}
                    >
                      <Select
                        style={{ width: '100%' }}
                        size="small"
                        placeholder="Связать с KE..."
                        allowClear
                        value={req.knownErrorId}
                        onChange={(v) => linkKeMutation.mutate(v ?? null)}
                        showSearch
                        optionFilterProp="label"
                        options={(knownErrors as any[]).map((ke: any) => ({
                          value: ke.id,
                          label: `#${ke.id} ${ke.title}`,
                        }))}
                      />
                    </Card>
                  )}

                  {/* Activity feed */}
                  <Card size="small" title="Лента активности"
                    extra={<Button size="small" onClick={() => setCommentModal(true)}>+ Комментарий</Button>}
                    style={{ maxHeight: 520, overflowY: 'auto' }}
                  >
                    {(req.activities || []).length === 0
                      ? <Typography.Text type="secondary" style={{ fontSize: 13 }}>Активностей пока нет</Typography.Text>
                      : (
                        <Timeline
                          style={{ marginTop: 4 }}
                          items={[...(req.activities || [])].reverse().map(a => ({
                            color: a.action.includes('Статус') ? 'blue' : a.action.includes('Комментарий') ? 'green' : 'gray',
                            children: (
                              <div>
                                <div><Typography.Text strong style={{ fontSize: 12 }}>{a.action}</Typography.Text></div>
                                {a.details && <div className="rich-content" style={{ color: '#555', fontSize: 12 }} dangerouslySetInnerHTML={{ __html: a.details }} />}
                                <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                                  {a.author?.fullName} · {dayjs(a.createdAt).format('DD.MM.YYYY HH:mm')}
                                </div>
                              </div>
                            ),
                          }))}
                        />
                      )}
                  </Card>
                  </Reveal>
                </Col>
              </Row>
            );
          })(),
        },
        ...(!isCustomer ? [{
          key: 'time', label: <span><ClockCircleOutlined /> Трудозатраты {factHours > 0 ? `(${factHours.toFixed(1)} ч${totalCost > 0 ? ' / ' + totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' ₽' : ''})` : ''}</span>,
          children: (
            <Reveal>
            <Card extra={<Button icon={<PlusOutlined />} onClick={() => setTimeModal(true)}>Добавить</Button>}>
              <Table
                dataSource={timeEntriesEnriched}
                columns={teColumns}
                rowKey="id"
                size="small"
                pagination={false}
                summary={() => (
                  <Table.Summary.Row style={{ background: '#fafafa' }}>
                    <Table.Summary.Cell index={0} colSpan={3}><b>Итого</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right"><b>{factHours.toFixed(1)}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} />
                    {!isExecutor && (
                      <Table.Summary.Cell index={5} align="right">
                        {totalCost > 0 && <b style={{ color: '#1677ff' }}>{totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₽</b>}
                      </Table.Summary.Cell>
                    )}
                    <Table.Summary.Cell index={6} />
                  </Table.Summary.Row>
                )}
              />
            </Card>
            </Reveal>
          ),
        }, {
          key: 'files',
          label: (
            <span>
              <FileOutlined /> Документы
              {!!req.artifacts?.length && (
                <Badge count={req.artifacts.length} size="small" style={{ marginLeft: 8 }} />
              )}
            </span>
          ),
          children: (
            <Reveal>
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              {/* 1. Mandatory docs */}
              <Card
                title="Обязательные документы"
              >
                <Row gutter={16}>
                  {isDevelopment && (
                    <Col xs={24} md={12}>{renderArtifactCard('Бриф', brief, 'grif')}</Col>
                  )}
                  <Col xs={24} md={isDevelopment ? 12 : 24}>{renderArtifactCard('Требования', requirements, 'requirements')}</Col>
                </Row>
              </Card>

              {/* 2. Graphics / design materials */}
              <Card
                title={`Графические материалы (${graphicsFiles.length})`}
                extra={
                  <Upload
                    action={`/api/requests/${id}/artifacts`}
                    headers={{ Authorization: `Bearer ${localStorage.getItem('bi_token')}` }}
                    data={{ artifactType: 'graphics' }}
                    onChange={handleUploadChange('graphics', 'Файл загружен')}
                    showUploadList={false}
                    multiple
                  >
                    <Button size="small" icon={<UploadOutlined />} loading={!!uploadingTypes['graphics']}>Прикрепить дизайн</Button>
                  </Upload>
                }
              >
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  Макеты, скриншоты, прототипы — не обязательно
                </Typography.Text>
                <List
                  dataSource={graphicsFiles}
                  locale={{ emptyText: 'Нет графических материалов' }}
                  renderItem={(a: any) => (
                    <List.Item
                      actions={[
                        <a href={`/api/files/${a.storedFilename}`} target="_blank" rel="noreferrer" key="dl">
                          <DownloadOutlined /> Скачать
                        </a>,
                        <Popconfirm title="Удалить файл?" onConfirm={() => deleteArtifactMutation.mutate(a.id)} key="del">
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<Avatar icon={<UploadOutlined />} />}
                        title={a.originalFilename}
                        description={`${(a.size / 1024).toFixed(1)} КБ · ${a.uploadedBy?.fullName || ''} · ${dayjs(a.createdAt).format('DD.MM.YYYY')}`}
                      />
                    </List.Item>
                  )}
                />
              </Card>

              {/* 3. Other / additional files */}
              <Card
                title={`Дополнительные файлы (${otherFiles.length})`}
                extra={
                  <Upload
                    action={`/api/requests/${id}/artifacts`}
                    headers={{ Authorization: `Bearer ${localStorage.getItem('bi_token')}` }}
                    data={{ artifactType: 'other' }}
                    onChange={handleUploadChange('other', 'Файл загружен')}
                    showUploadList={false}
                    multiple
                  >
                    <Button size="small" icon={<UploadOutlined />} loading={!!uploadingTypes['other']}>Прикрепить файл</Button>
                  </Upload>
                }
              >
                {(() => {
                  const imageFiles = otherFiles.filter((a: any) => a.mimeType?.startsWith('image/'));
                  const nonImageFiles = otherFiles.filter((a: any) => !a.mimeType?.startsWith('image/'));
                  return (
                    <>
                      {imageFiles.length > 0 && (
                        <Image.PreviewGroup>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: nonImageFiles.length > 0 ? 16 : 0 }}>
                            {imageFiles.map((a: any) => (
                              <div key={a.id} style={{ position: 'relative' }}>
                                <Image
                                  src={`/api/files/${a.storedFilename}`}
                                  width={80}
                                  height={80}
                                  style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0', cursor: 'pointer' }}
                                  preview={{ mask: false }}
                                />
                                <div style={{ fontSize: 11, color: '#999', textAlign: 'center', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {a.originalFilename}
                                </div>
                                <Popconfirm title="Удалить файл?" onConfirm={() => deleteArtifactMutation.mutate(a.id)}>
                                  <Button
                                    size="small" danger icon={<DeleteOutlined />}
                                    style={{ position: 'absolute', top: 2, right: 2, padding: '0 4px', height: 20, fontSize: 10 }}
                                  />
                                </Popconfirm>
                              </div>
                            ))}
                          </div>
                        </Image.PreviewGroup>
                      )}
                      <List
                        dataSource={nonImageFiles}
                        locale={{ emptyText: imageFiles.length === 0 ? 'Нет дополнительных файлов' : null }}
                        renderItem={(a: any) => (
                          <List.Item
                            actions={[
                              <a href={`/api/files/${a.storedFilename}`} target="_blank" rel="noreferrer" key="dl">
                                <DownloadOutlined /> Скачать
                              </a>,
                              <Popconfirm title="Удалить файл?" onConfirm={() => deleteArtifactMutation.mutate(a.id)} key="del">
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]}
                          >
                            <List.Item.Meta
                              avatar={<Avatar icon={<UploadOutlined />} />}
                              title={a.originalFilename}
                              description={`${(a.size / 1024).toFixed(1)} КБ · ${a.uploadedBy?.fullName || ''} · ${dayjs(a.createdAt).format('DD.MM.YYYY')}`}
                            />
                          </List.Item>
                        )}
                      />
                    </>
                  );
                })()}
              </Card>
            </Space>
            </Reveal>
          ),
        }] : []),
      ]} />

      {/* Time entry modal */}
      <Modal title="Добавить трудозатраты" open={timeModal} onCancel={() => { setTimeModal(false); timeForm.resetFields(); }}
        onOk={() => timeForm.submit()} confirmLoading={timeMutation.isPending}>
        {req.assignee && (
          <div style={{ background: '#e6f4ff', borderRadius: 6, padding: '6px 12px', marginBottom: 12, fontSize: 12, color: '#1677ff' }}>
            Исполнитель: <strong>{(req.assignee as any).fullName}</strong>
          </div>
        )}
        <Form form={timeForm} layout="vertical" onFinish={(v) => timeMutation.mutate({
          requestId: req.id,
          contractorId: req.contractorId || undefined,
          userId: req.assigneeId || undefined,
          ...v,
          date: v.date.format('YYYY-MM-DD'),
          quantity: v.quantity || 1,
        })}>
          <Form.Item name="workName" label="Наименование работ" rules={[{ required: true, message: 'Укажите наименование' }]}>
            <Input.TextArea placeholder="Например: Разработка ETL-процесса" autoSize={{ minRows: 1, maxRows: 8 }} />
          </Form.Item>
          <Row gutter={16}>
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
                <InputNumber style={{ width: '100%' }} min={1} step={1} placeholder="1" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Comment modal */}
      <Modal
        title="Добавить комментарий"
        open={commentModal}
        onCancel={() => { setCommentModal(false); setCommentHtml(''); }}
        onOk={() => {
          if (!commentHtml.trim()) { message.warning('Введите текст комментария'); return; }
          commentMutation.mutate({ text: commentHtml });
        }}
        confirmLoading={commentMutation.isPending}
        width={600}
      >
        <div style={{ marginTop: 8 }}>
          <RichEditor
            value={commentHtml}
            onChange={setCommentHtml}
            placeholder="Текст комментария..."
            minHeight={120}
            requestId={Number(id)}
          />
        </div>
      </Modal>

      {/* Close reason modal */}
      <Modal
        title={
          pendingStatus === RequestStatus.DONE ? 'Закрыть заявку'
            : pendingStatus === RequestStatus.CANCELLED ? 'Отменить заявку'
            : 'Отклонить заявку'
        }
        open={closeModal}
        onCancel={() => { setCloseModal(false); setPendingStatus(null); closeForm.resetFields(); }}
        onOk={() => closeForm.submit()}
        confirmLoading={statusMutation.isPending}
        okButtonProps={{ danger: pendingStatus === RequestStatus.REJECTED || pendingStatus === RequestStatus.CANCELLED }}
      >
        <Form
          form={closeForm}
          layout="vertical"
          onFinish={(v) => {
            statusMutation.mutate({ status: pendingStatus, closeReason: v.closeReason, comment: v.comment || undefined });
            setCloseModal(false);
            setPendingStatus(null);
            closeForm.resetFields();
          }}
        >
          <Form.Item name="closeReason" label="Причина закрытия" rules={[{ required: true, message: 'Выберите причину' }]}>
            <Select placeholder="Выберите...">
              {CLOSE_REASONS.map(r => <Select.Option key={r} value={r}>{r}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="comment" label="Комментарий (необязательно)">
            <RichEditor placeholder="Дополнительные пояснения..." minHeight={80} requestId={Number(id)} />
          </Form.Item>
        </Form>
      </Modal>

      {lightboxArea}
      {printArea}
    </div>
  );
}
