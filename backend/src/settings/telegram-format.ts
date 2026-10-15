// Shared, dependency-free Telegram message building blocks — deliberately plain functions (no
// NestJS DI) so both RequestsService (which triggers notifications) and TelegramBotService
// (which handles incoming commands/buttons) can import this without creating a module cycle
// between requests/ and settings/telegram-bot/.
//
// Telegram's HTML parse_mode supports only a small subset: <b> <i> <u> <s> <a> <code> <pre>
// <blockquote>. The "modern" look here leans on that subset deliberately: a blockquote sets the
// request title apart from metadata, a consistent emoji vocabulary carries status/action at a
// glance, and every message ends the same way (a link, never a bare URL).

export const STATUS_LABELS_RU: Record<string, string> = {
  new: 'Новая', queued: 'В очереди', in_progress: 'В работе',
  waiting_customer: 'Ожидание заказчика', review: 'На проверке',
  rework: 'На доработке', done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена',
};

export const STATUS_EMOJI: Record<string, string> = {
  new: '⚪', queued: '⚪', in_progress: '🔵', waiting_customer: '⏸️',
  review: '🟡', rework: '🟠', done: '🟢', rejected: '🔴', cancelled: '⚫',
};

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The one recurring visual anchor across every message — number + name, visually set apart. */
export function requestBlock(number: string, name: string): string {
  return `<blockquote><b>${escapeHtml(number)}</b> — ${escapeHtml(name)}</blockquote>`;
}

/** Key: value meta lines under the request block — skips any pair whose value is empty. */
export function metaLines(pairs: [label: string, value: string | undefined | null][]): string {
  return pairs.filter(([, v]) => !!v).map(([label, v]) => `${label}: ${v}`).join('\n');
}

export function footerLink(url: string, label = 'Открыть заявку'): string {
  return `<a href="${url}">${label} →</a>`;
}

export function statusTag(status: string): string {
  return `${STATUS_EMOJI[status] || '⚪'} ${STATUS_LABELS_RU[status] || status}`;
}

export const PRIORITY_LABELS_RU: Record<string, string> = {
  critical: 'Критичный', high: 'Высокий', medium: 'Средний', low: 'Низкий',
};
export const PRIORITY_EMOJI: Record<string, string> = {
  critical: '🔴', high: '🟠', medium: '🟡', low: '⚪️',
};

export function priorityTag(priority?: string | null): string {
  if (!priority) return '';
  return `${PRIORITY_EMOJI[priority] || ''} ${PRIORITY_LABELS_RU[priority] || priority}`.trim();
}

function pluralDays(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  const mod10 = n % 10;
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

export function overdueLine(overdueDays: number): string {
  const d = Math.round(overdueDays);
  return `🔥 Просрочена на ${d} ${pluralDays(d)}`;
}

// Simplified 4-stage view for the customer, who shouldn't need to know what "rework" or
// "review" mean internally — every real status folds into one of these. Rendered as plain
// emoji + text (Telegram's HTML subset has no layout primitives for a real progress bar).
const CUSTOMER_STAGES = ['Принята', 'В работе', 'Проверка', 'Готово'];

function customerStageIndex(status: string): number {
  if (['new', 'queued'].includes(status)) return 0;
  if (['in_progress', 'waiting_customer', 'rework'].includes(status)) return 1;
  if (status === 'review') return 2;
  if (status === 'done') return 3;
  return -1; // rejected/cancelled — no bar, status line alone says enough
}

export function progressBar(status: string): string {
  const idx = customerStageIndex(status);
  if (idx < 0) return '';
  const lastIdx = CUSTOMER_STAGES.length - 1;
  return CUSTOMER_STAGES.map((label, i) => {
    const icon = i < idx || (idx === lastIdx && i === lastIdx) ? '✅' : i === idx ? '🔵' : '⚪️';
    return `${icon} ${label}`;
  }).join('  →  ');
}

export function assignedMessage(params: {
  number: string; name: string; customerDepartment?: string; plannedDate?: string; requestUrl: string;
}): string {
  const planned = params.plannedDate
    ? new Date(params.plannedDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : undefined;
  const meta = metaLines([['📌 Заказчик', params.customerDepartment], ['📅 Срок', planned]]);
  return [
    '🆕 <b>Новая задача</b>',
    '',
    requestBlock(params.number, params.name),
    meta,
    '',
    footerLink(params.requestUrl),
  ].filter(l => l !== '').join('\n');
}

export function statusChangedMessage(params: {
  number: string; name: string; newStatus: string; requestUrl: string;
}): string {
  return [
    '🔄 <b>Статус изменён</b>',
    '',
    requestBlock(params.number, params.name),
    `Статус: ${statusTag(params.newStatus)}`,
    '',
    footerLink(params.requestUrl),
  ].join('\n');
}

export function commentMessage(params: {
  number: string; name: string; authorName: string; text: string; requestUrl: string;
}): string {
  const preview = params.text.length > 300 ? `${params.text.slice(0, 300)}…` : params.text;
  return [
    '💬 <b>Новый комментарий</b>',
    '',
    requestBlock(params.number, params.name),
    `<i>${escapeHtml(params.authorName)}:</i> ${escapeHtml(preview)}`,
    '',
    footerLink(params.requestUrl),
  ].join('\n');
}

export function tasksMessage(
  fullName: string | undefined,
  rows: { number: string; name: string; status: string; priority?: string; plannedDate?: string | null }[],
  appUrl: string,
  opts: { greeting?: string; linkPath?: string } = {},
): string {
  const linkPath = opts.linkPath ?? '/requests';
  if (!rows.length) {
    return opts.greeting
      ? `☀️ <b>${opts.greeting}</b>\n\nАктивных заявок нет — всё разобрано 🎉`
      : '📋 Активных заявок нет — всё разобрано 🎉';
  }
  const shown = rows.slice(0, 15);
  const lines = shown.map(r => {
    const overdue = r.plannedDate && new Date(r.plannedDate) < new Date();
    const flags = `${overdue ? '🔥 ' : ''}${statusTag(r.status)}${r.priority ? `  ${priorityTag(r.priority)}` : ''}`;
    return `${flags}\n<b>${escapeHtml(r.number)}</b> — ${escapeHtml(r.name)}`;
  });
  const more = rows.length > shown.length ? `\n\n…и ещё ${rows.length - shown.length}` : '';
  const title = opts.greeting ? `☀️ <b>${opts.greeting}</b>` : `📋 <b>Ваши заявки (${rows.length})</b>`;
  const count = opts.greeting ? `\nАктивных заявок: ${rows.length}\n` : '';
  return `${title}${count}\n${lines.join('\n\n')}${more}\n\n${footerLink(`${appUrl}${linkPath}`, 'Открыть все заявки')}`;
}

/** Executor's request card (bot's detail screen) — quick-action + "внести часы" buttons attach to it. */
export function taskCardMessage(params: {
  number: string; name: string; status: string; requestUrl: string;
  priority?: string | null; overdueDays?: number; customerDept?: string | null;
}): string {
  const statusLine = `Статус: ${statusTag(params.status)}${params.priority ? `  ·  ${priorityTag(params.priority)}` : ''}`;
  return [
    requestBlock(params.number, params.name),
    params.overdueDays && params.overdueDays > 0 ? overdueLine(params.overdueDays) : '',
    statusLine,
    metaLines([['📌 Заказчик', params.customerDept]]),
    '',
    footerLink(params.requestUrl),
  ].filter(l => l !== '').join('\n');
}

/** Read-only status ping for the customer who submitted the request — no action buttons. */
export function customerStatusMessage(params: { number: string; name: string; newStatus: string; requestUrl: string }): string {
  return [
    '📣 <b>Обновление по вашей заявке</b>',
    '',
    requestBlock(params.number, params.name),
    `Статус: ${statusTag(params.newStatus)}`,
    '',
    footerLink(params.requestUrl, 'Открыть в портале'),
  ].join('\n');
}

/** Customer's bot detail screen — progress bar instead of raw status, no internal fields (priority etc). */
export function customerDetailMessage(params: {
  number: string; name: string; status: string; requestUrl: string;
  plannedDate?: string | null; assigneeFirstName?: string | null;
  lastComment?: { authorName: string; text: string } | null;
}): string {
  const planned = params.plannedDate
    ? new Date(params.plannedDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : undefined;
  const commentPreview = params.lastComment
    ? (params.lastComment.text.length > 200 ? `${params.lastComment.text.slice(0, 200)}…` : params.lastComment.text)
    : undefined;
  return [
    requestBlock(params.number, params.name),
    `Статус: ${statusTag(params.status)}`,
    progressBar(params.status),
    metaLines([['📅 Срок', planned], ['👤 Исполнитель', params.assigneeFirstName || undefined]]),
    commentPreview ? `💬 <i>${escapeHtml(params.lastComment!.authorName)}:</i> ${escapeHtml(commentPreview)}` : '',
    '',
    footerLink(params.requestUrl, 'Открыть в портале'),
  ].filter(l => l !== '').join('\n');
}

/** Admin's bot detail screen — read-only (no action buttons; reassignment etc. stays in the web app). */
export function adminDetailMessage(params: {
  number: string; name: string; status: string; requestUrl: string;
  priority?: string | null; overdueDays?: number;
  assigneeName?: string | null; customerDept?: string | null; plannedDate?: string | null;
}): string {
  const planned = params.plannedDate
    ? new Date(params.plannedDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : undefined;
  return [
    requestBlock(params.number, params.name),
    params.overdueDays && params.overdueDays > 0 ? overdueLine(params.overdueDays) : '',
    `Статус: ${statusTag(params.status)}${params.priority ? `  ·  ${priorityTag(params.priority)}` : ''}`,
    metaLines([['👤 Исполнитель', params.assigneeName], ['📌 Заказчик', params.customerDept], ['📅 Срок', planned]]),
    '',
    footerLink(params.requestUrl, 'Открыть в приложении'),
  ].filter(l => l !== '').join('\n');
}

/** Executor's "⏱ Мои часы" screen — week/month totals + last few entries. */
export function hoursStatsMessage(params: {
  weekHours: number; monthHours: number;
  recent: { hours: number; requestNumber: string; date: string }[];
}): string {
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
  const table = [
    `${pad('За неделю', 13)}${params.weekHours.toFixed(1)} ч`,
    `${pad('За месяц', 13)}${params.monthHours.toFixed(1)} ч`,
  ].join('\n');
  const recentLines = params.recent.length
    ? params.recent.map(r => {
        const d = new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        return `${r.hours} ч — ${escapeHtml(r.requestNumber)}, ${d}`;
      }).join('\n')
    : '<i>пока нет записей</i>';
  return [
    '⏱ <b>Мои трудозатраты</b>',
    `<pre>${table}</pre>`,
    'Последние записи:',
    recentLines,
  ].join('\n');
}

export function adminOverviewMessage(params: {
  active: { number: string; name: string; status: string }[]; activeTotal: number;
  doneRecent: { number: string; name: string }[]; doneTotal: number;
  appUrl: string;
}): string {
  const activeShown = params.active.slice(0, 10)
    .map(r => `${statusTag(r.status)} <b>${escapeHtml(r.number)}</b> — ${escapeHtml(r.name)}`)
    .join('\n');
  const doneShown = params.doneRecent.slice(0, 10)
    .map(r => `🟢 <b>${escapeHtml(r.number)}</b> — ${escapeHtml(r.name)}`)
    .join('\n');
  return [
    `📊 <b>Сейчас в работе: ${params.activeTotal}</b>`,
    activeShown || '<i>нет активных заявок</i>',
    params.activeTotal > 10 ? `…и ещё ${params.activeTotal - 10}` : '',
    '',
    `✅ <b>Выполнено за 7 дней: ${params.doneTotal}</b>`,
    doneShown || '<i>пока ничего</i>',
    params.doneTotal > 10 ? `…и ещё ${params.doneTotal - 10}` : '',
    '',
    footerLink(`${params.appUrl}/requests`, 'Открыть заявки'),
  ].filter(l => l !== '').join('\n');
}

export function finishPromptMessage(number: string, name: string): string {
  return [
    requestBlock(number, name),
    '✅ Заявка будет отмечена как выполненная.',
    '',
    'Пришлите комментарий к выполнению — или "-" чтобы закрыть без комментария.',
  ].join('\n');
}

export function timeEntryHoursPromptMessage(number: string, name: string): string {
  return [
    requestBlock(number, name),
    '➕ Внесение трудозатрат.',
    '',
    'Сколько часов? Пришлите число, например: 2 или 1.5',
  ].join('\n');
}

export function timeEntryCommentPromptMessage(hours: number): string {
  return `Часы: <b>${hours}</b>\n\nКомментарий к работе — или "-" чтобы пропустить.`;
}

export function welcomeMessage(fullName: string): string {
  return [
    `✅ <b>Telegram привязан</b>`,
    '',
    `${escapeHtml(fullName)}, теперь уведомления о ваших заявках — назначение, смена статуса, новые комментарии — приходят сюда.`,
  ].join('\n');
}
