// Registry of independently-toggleable Telegram notification modules.
// Adding a new notification type = add an entry here + a check method in
// EscalationService that calls isModuleEnabled() before sending.

// days: 0=Вс, 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт, 6=Сб — matches JS Date#getDay().
export interface ModuleSchedule {
  days: number[];
  time: string; // "HH:mm", Europe/Moscow
}

export interface TelegramModuleDef {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  defaultSchedule: ModuleSchedule;
}

const DAILY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

export const TELEGRAM_MODULES: TelegramModuleDef[] = [
  {
    id: 'sla_breach',
    label: 'Просроченные заявки',
    description: 'Пн–Пт в 09:00 — заявки с истёкшим плановым сроком',
    defaultEnabled: true,
    defaultSchedule: { days: WEEKDAYS, time: '09:00' },
  },
  {
    id: 'sla_near',
    label: 'Скорый дедлайн по задачам',
    description: 'Пн/Ср/Пт в 10:00 — заявки, срок которых истекает через 1–2 дня',
    defaultEnabled: true,
    defaultSchedule: { days: [1, 3, 5], time: '10:00' },
  },
  {
    id: 'dashboard_refresh',
    label: 'Необновившиеся дашборды',
    description: 'Ежедневно в 10:30 (МСК) — отчёты с ошибкой планового обновления за сегодня',
    defaultEnabled: true,
    defaultSchedule: { days: DAILY, time: '10:30' },
  },
  {
    id: 'stale_new',
    label: 'Заявки без исполнителя',
    description: 'Ежедневно в 09:15 — новые заявки старше 2 дней без назначенного исполнителя',
    defaultEnabled: false,
    defaultSchedule: { days: DAILY, time: '09:15' },
  },
  {
    id: 'daily_digest',
    label: 'Ежедневная сводка',
    description: 'Ежедневно в 18:00 — создано / выполнено / просрочено за день',
    defaultEnabled: false,
    defaultSchedule: { days: DAILY, time: '18:00' },
  },
];

export const telegramSettingKey = (moduleId: string) => `telegram_notify_${moduleId}`;
export const telegramScheduleKey = (moduleId: string) => `telegram_schedule_${moduleId}`;

export function isModuleEnabled(values: Record<string, string | null>, moduleId: string): boolean {
  const def = TELEGRAM_MODULES.find(m => m.id === moduleId);
  const raw = values[telegramSettingKey(moduleId)];
  if (raw === null || raw === undefined) return def?.defaultEnabled ?? false;
  return raw === '1';
}

export function getModuleSchedule(values: Record<string, string | null>, moduleId: string): ModuleSchedule {
  const def = TELEGRAM_MODULES.find(m => m.id === moduleId);
  const fallback = def?.defaultSchedule ?? { days: DAILY, time: '09:00' };
  const raw = values[telegramScheduleKey(moduleId)];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.days) && typeof parsed.time === 'string') {
      return { days: parsed.days, time: parsed.time };
    }
  } catch {
    // fall through to default below
  }
  return fallback;
}
