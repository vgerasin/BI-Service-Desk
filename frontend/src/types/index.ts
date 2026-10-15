export enum UserRole {
  EXECUTOR = 'executor',
  ADMIN = 'admin',
  CUSTOMER = 'customer',
}

export enum RequestStatus {
  NEW = 'new',
  CLARIFICATION = 'clarification',
  QUEUED = 'queued',
  IN_PROGRESS = 'in_progress',
  WAITING_CUSTOMER = 'waiting_customer',
  REVIEW = 'review',
  APPROVAL = 'approval',
  REWORK = 'rework',
  DONE = 'done',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum RequestType {
  DEVELOPMENT = 'development',
  IMPROVEMENT = 'improvement',
  BUGFIX = 'bugfix',
  CONSULTATION = 'consultation',
  OTHER = 'other',
}

export enum Priority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

// "На уточнении" and "На согласовании" were folded into "Ожидание заказчика" / "На проверке" —
// RequestStatus.CLARIFICATION/APPROVAL stay defined (matches the Postgres enum, which can't drop
// values cleanly) but no live request is ever in either state anymore, so they're intentionally
// absent here.
export const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  queued: 'В очереди',
  in_progress: 'В работе',
  waiting_customer: 'Ожидание заказчика',
  review: 'На проверке',
  rework: 'На доработке',
  done: 'Выполнена',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

export const STATUS_COLORS: Record<string, string> = {
  new: 'default',
  queued: 'processing',
  in_progress: 'blue',
  waiting_customer: 'cyan',
  review: 'purple',
  rework: 'volcano',
  done: 'success',
  rejected: 'error',
  cancelled: 'default',
};

export const TYPE_LABELS: Record<string, string> = {
  development: 'Новый дашборд',
  improvement: 'Доработка',
  bugfix: 'Ошибка / Баг',
  consultation: 'Консультация',
  other: 'Прочее',
};

export const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

export const PRIORITY_COLORS: Record<string, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'blue',
  low: 'default',
};

export const ROLE_LABELS: Record<string, string> = {
  executor: 'Исполнитель',
  admin: 'Администратор',
  customer: 'Заказчик (портал)',
};

export const ROLE_COLORS: Record<string, string> = {
  executor: 'blue',
  admin: 'purple',
  customer: 'green',
};

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: UserRole;
  position?: string;
  isActive: boolean;
  createdAt: string;
  customerId?: number;
  managerId?: number;
  telegramLinked?: boolean;
}

export interface Customer {
  id: number;
  department: string;
  responsible?: string;
  contact?: string;
  isActive: boolean;
}

export interface Contractor {
  id: number;
  name: string;
  type?: string;
  contact?: string;
  currency: string;
  isActive: boolean;
}

export interface ReportRef {
  id: number;
  name: string;
  owner?: string;
  pbiLink?: string;
  workspace?: string;
  dataSource?: string;
  description?: string;
  status: string;
}

export interface TimeEntry {
  id: number;
  requestId: number;
  request?: BiRequest;
  userId?: number;
  user?: User;
  contractorId?: number;
  contractor?: Contractor;
  date: string;
  hours: number;
  workKind?: string;
  comment?: string;
  createdAt: string;
}

export interface Artifact {
  id: number;
  requestId: number;
  originalFilename: string;
  storedFilename: string;
  mimeType?: string;
  size: number;
  uploadedBy?: User;
  createdAt: string;
}

export interface Activity {
  id: number;
  requestId: number;
  author?: User;
  action: string;
  details?: string;
  createdAt: string;
}

export interface BiRequest {
  id: number;
  number: string;
  type: RequestType;
  name: string;
  status: RequestStatus;
  priority: Priority;
  customerId?: number;
  customer?: Customer;
  reportId?: number;
  report?: ReportRef;
  assigneeId?: number;
  assignee?: User;
  contractorId?: number;
  contractor?: Contractor;
  description?: string;
  plannedHours?: number;
  plannedDate?: string;
  createdById?: number;
  createdBy?: User;
  onBehalfOfName?: string | null;
  onBehalfOfEmail?: string | null;
  billingCompanyId?: number | null;
  billingCompany?: { id: number; name: string; shortName?: string | null } | null;
  createdAt: string;
  closedAt?: string;
  closeReason?: string;
  timeEntries?: TimeEntry[];
  artifacts?: Artifact[];
  activities?: Activity[];
  totalHours?: number;
  impact?: string;
  urgency?: string;
  affectedUsers?: string;
  stepsToReproduce?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  environment?: string;
  workaround?: string;
  dataSources?: string;
  targetAudience?: string;
  refreshFrequency?: string;
  waitingForCustomerSince?: string;
  waitingForCustomerSeconds?: number;
  knownErrorId?: number;
  acceptedByCustomerAt?: string;
}

export interface RateHistory {
  id: number;
  userId?: number;
  contractorId?: number;
  rate: number;
  currency: string;
  dateFrom: string;
  dateTo?: string;
}
