import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { TelegramService, InlineButton } from '../settings/telegram.service';
import { SettingsService } from '../settings/settings.service';
import { RequestsService, buildQuickActions } from '../requests/requests.service';
import { RequestStatus, RequestType } from '../requests/request.entity';
import { TimeEntriesService } from '../time-entries/time-entries.service';
import { User, UserRole } from '../users/user.entity';
import {
  tasksMessage, taskCardMessage, welcomeMessage,
  finishPromptMessage, timeEntryHoursPromptMessage, timeEntryCommentPromptMessage, statusTag,
  customerDetailMessage, adminDetailMessage, hoursStatsMessage,
  STATUS_EMOJI, PRIORITY_EMOJI,
} from '../settings/telegram-format';
import { getAppUrl } from '../common/app-config';

const MSK = { timeZone: 'Europe/Moscow' };
const APP_URL = () => getAppUrl();
const CLOSED_STATUSES = ['done', 'rejected', 'cancelled'];

type PendingAction =
  | { type: 'finish_comment'; requestId: number; requestNumber: string; requestName: string }
  | { type: 'time_hours'; requestId: number; requestNumber: string; requestName: string }
  | { type: 'time_comment'; requestId: number; requestNumber: string; requestName: string; hours: number };

// Orchestrates the bot's conversational side (commands, buttons, multi-step flows, the morning
// digest) — separate from TelegramService (SettingsModule), which is just the low-level Bot API
// client. This module depends on SettingsModule (to send), RequestsModule (act on button taps /
// list tasks) and TimeEntriesModule (the "внести часы" flow); none of those depend back on this
// module, so the graph stays acyclic even though RequestsService itself also injects
// TelegramService directly for its own simple "fire a DM" notifications.
//
// Every role gets a different menu/flow (see menuKeyboard/sendMyRequests below):
//  - customer: read-only "Мои заявки" — status tracking only, no action buttons (they don't
//    manage the request, they just track it — see chat: "добавлять заявку через телеграм не
//    нужно").
//  - executor: "Мои заявки" as one message per request, each with quick status-change buttons
//    (built by RequestsService.buildQuickActions, shared with the assignment/status-change DMs)
//    plus a "➕ Внести часы" button.
//  - admin: "В работе" / "Выполнено" overview (counts + short list) — analytics is explicitly
//    deferred, this is intentionally just a glance, not a dashboard.
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private commandsRegistered = false;

  // Multi-step flows (finish-with-comment, add time entry) keyed by chat id — in-memory only:
  // low-stakes if lost on a restart (worst case the user re-taps the button), and avoids a DB
  // table for what's genuinely ephemeral UI state.
  private readonly pending = new Map<number, PendingAction>();

  constructor(
    private readonly telegram: TelegramService,
    private readonly settings: SettingsService,
    private readonly requests: RequestsService,
    private readonly timeEntries: TimeEntriesService,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  // Every browsing tap (menu → list → detail → back) edits the SAME message in place instead of
  // sending a new one — the bot reads as a small app you navigate, not a stream of separate
  // notifications. `messageId` is undefined only when there's nothing to edit yet (a fresh
  // command like /menu, or an edit target that's since become invalid), in which case we fall
  // back to sending a new message. Real events (assignment, status change, new comment) still go
  // through TelegramService.sendToUser as their own separate pushes — those are notifications,
  // not navigation, and should stay visible in the chat history.
  private async render(chatId: number, messageId: number | undefined, text: string, buttons: InlineButton[][]): Promise<void> {
    if (messageId) {
      try {
        await this.telegram.callBotApi('editMessageText', {
          chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
          text, reply_markup: { inline_keyboard: buttons },
        });
        return;
      } catch (e) {
        if (e.message?.includes('not modified')) return;
        // Message too old to edit / was deleted — fall through to sending a fresh one below.
      }
    }
    await this.telegram.callBotApi('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML', text, reply_markup: { inline_keyboard: buttons },
    });
  }

  private async menuKeyboard(user: User): Promise<InlineButton[][]> {
    if (user.role === UserRole.ADMIN) {
      const overview = await this.requests.getAdminTelegramOverview();
      return [
        [{ text: `📊 В работе · ${overview.activeTotal}`, callback_data: 'list:active' }],
        [{ text: `🔥 Просрочено · ${overview.overdueTotal}`, callback_data: 'list:overdue' }],
        [{ text: `✅ Выполнено за 7 дней · ${overview.doneTotal}`, callback_data: 'list:done' }],
      ];
    }
    if (user.role === UserRole.CUSTOMER) {
      if (!user.customerId) return [];
      // Approximate — findForCustomerTelegram caps at 15, so the badge undercounts past that;
      // fine at this app's scale, and the list screen itself shows the real filtered count.
      const rows = await this.requests.findForCustomerTelegram(user.customerId);
      const activeCount = rows.filter(r => !CLOSED_STATUSES.includes(r.status)).length;
      return [
        [{ text: `📋 Активные · ${activeCount}`, callback_data: 'list:active' }],
        [{ text: '🗂 Все заявки', callback_data: 'list:all' }],
      ];
    }
    // executor
    const [active, overdue] = await Promise.all([
      this.requests.findActiveForTelegram(user.id, user.email),
      this.requests.findOverdueForTelegram({ userId: user.id, email: user.email }),
    ]);
    return [
      [{ text: `📋 Активные · ${active.length}`, callback_data: 'list:active' }],
      [{ text: `🔥 Просрочено · ${overdue.length}`, callback_data: 'list:overdue' }],
      [{ text: '⏱ Мои часы', callback_data: 'list:hours' }],
      [{ text: '✅ Завершено', callback_data: 'list:done' }],
    ];
  }

  private async sendMenu(chatId: number, user: User, messageId?: number): Promise<void> {
    const buttons = await this.menuKeyboard(user);
    await this.render(chatId, messageId, welcomeMessage(user.fullName), buttons);
  }

  // Cosmetic, best-effort, once per process: populates the "/" autocomplete list and the round
  // menu button next to the text input, so the bot reads as a real mini-app rather than a bare
  // notifier. Failure here never blocks message handling — just logged.
  private async ensureBotUiRegistered(): Promise<void> {
    if (this.commandsRegistered) return;
    this.commandsRegistered = true;
    try {
      await this.telegram.callBotApi('setMyCommands', {
        commands: [
          { command: 'menu', description: '🏠 Главное меню' },
          { command: 'tasks', description: '📋 Мои заявки' },
          { command: 'start', description: 'ℹ️ О боте' },
        ],
      });
      await this.telegram.callBotApi('setChatMenuButton', { menu_button: { type: 'commands' } });
    } catch (e) {
      this.logger.warn(`Не удалось настроить меню бота: ${e.message}`);
    }
  }

  // Compact one-line label for a list-row button: status + priority + overdue flag + number +
  // truncated name (Telegram inline button text has a practical length limit).
  private rowLabel(r: { number: string; name: string; status: string; priority?: string; plannedDate?: string | null }): string {
    const overdue = r.plannedDate && !CLOSED_STATUSES.includes(r.status) && new Date(r.plannedDate) < new Date();
    const flags = `${overdue ? '🔥' : ''}${STATUS_EMOJI[r.status] || '⚪'}${r.priority ? PRIORITY_EMOJI[r.priority] || '' : ''}`;
    const name = r.name.length > 32 ? `${r.name.slice(0, 32)}…` : r.name;
    return `${flags} ${r.number} · ${name}`;
  }

  private overdueRowLabel(r: { number: string; name: string; priority: string; overdueDays: number; assigneeName?: string | null }, showAssignee: boolean): string {
    const name = r.name.length > (showAssignee ? 22 : 30) ? `${r.name.slice(0, showAssignee ? 22 : 30)}…` : r.name;
    const who = showAssignee && r.assigneeName ? ` · ${r.assigneeName.split(' ')[0]}` : '';
    return `${PRIORITY_EMOJI[r.priority] || '🔴'} ${r.number} · ${name}${who} · −${r.overdueDays}д`;
  }

  // Generic "header text + one button per row + Назад" screen — every list view (active,
  // overdue, done, all) is this shape, just with different data and row-label rendering.
  private async renderRowList(
    chatId: number, messageId: number | undefined, header: string,
    rows: { id: number }[], listKey: string, labelFn: (r: any) => string,
  ): Promise<void> {
    if (!rows.length) {
      await this.render(chatId, messageId, `${header}\n\n<i>пусто</i>`, [[{ text: '‹ Назад', callback_data: 'menu' }]]);
      return;
    }
    const shown = rows.slice(0, 12);
    const buttons: InlineButton[][] = shown.map(r => [{ text: labelFn(r), callback_data: `req:${r.id}:${listKey}` }]);
    buttons.push([{ text: '‹ Назад', callback_data: 'menu' }]);
    const more = rows.length > shown.length ? `\n\n…и ещё ${rows.length - shown.length}` : '';
    await this.render(chatId, messageId, `${header}${more}`, buttons);
  }

  private async renderList(chatId: number, messageId: number | undefined, user: User, listKey: string): Promise<void> {
    if (user.role === UserRole.CUSTOMER) {
      if (!user.customerId) {
        await this.render(chatId, messageId, 'Ваш аккаунт не привязан к организации-заказчику.', [[{ text: '‹ Назад', callback_data: 'menu' }]]);
        return;
      }
      const all = await this.requests.findForCustomerTelegram(user.customerId);
      const rows = listKey === 'all' ? all : all.filter(r => !CLOSED_STATUSES.includes(r.status));
      const header = listKey === 'all' ? `🗂 <b>Все заявки (${rows.length})</b>` : `📋 <b>Активные заявки (${rows.length})</b>`;
      await this.renderRowList(chatId, messageId, header, rows, listKey, r => this.rowLabel(r));
      return;
    }

    if (user.role === UserRole.ADMIN) {
      if (listKey === 'overdue') {
        const rows = await this.requests.findOverdueForTelegram();
        await this.renderRowList(chatId, messageId, `🔥 <b>Просрочено (${rows.length})</b>`, rows, listKey, r => this.overdueRowLabel(r, true));
        return;
      }
      const overview = await this.requests.getAdminTelegramOverview();
      const rows = listKey === 'done' ? overview.doneRecent : overview.active;
      const header = listKey === 'done'
        ? `✅ <b>Выполнено за 7 дней (${overview.doneTotal})</b>`
        : `📊 <b>В работе (${overview.activeTotal})</b>`;
      await this.renderRowList(chatId, messageId, header, rows, listKey, r => this.rowLabel(r));
      return;
    }

    // executor
    if (listKey === 'hours') { await this.renderHoursStats(chatId, messageId, user); return; }
    if (listKey === 'overdue') {
      const rows = await this.requests.findOverdueForTelegram({ userId: user.id, email: user.email });
      await this.renderRowList(chatId, messageId, `🔥 <b>Просрочено (${rows.length})</b>`, rows, listKey, r => this.overdueRowLabel(r, false));
      return;
    }
    if (listKey === 'done') {
      const rows = await this.requests.findDoneForTelegram(user.id, user.email);
      await this.renderRowList(chatId, messageId, `✅ <b>Завершено (${rows.length})</b>`, rows, listKey, r => this.rowLabel(r));
      return;
    }
    const rows = await this.requests.findActiveForTelegram(user.id, user.email);
    const header = `📋 <b>Активные (${rows.length})</b>${rows.length ? ' — сначала срочные' : ''}`;
    await this.renderRowList(chatId, messageId, header, rows, listKey, r => this.rowLabel(r));
  }

  // Executor's own hours: this month's entries pulled once via the existing TimeEntriesService
  // query (already supports userId+userEmail — resolves contractor-linked hours too), then summed
  // client-side into week/month buckets. No new aggregate query needed.
  private async renderHoursStats(chatId: number, messageId: number | undefined, user: User): Promise<void> {
    const monthStart = new Date();
    monthStart.setDate(1);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    const weekFromStr = weekAgo.toISOString().slice(0, 10);

    const rows = await this.timeEntries.findAll({
      userId: user.id, userEmail: user.email,
      dateFrom: monthStart.toISOString().slice(0, 10),
    }) as any[];

    let weekHours = 0, monthHours = 0;
    for (const r of rows) {
      const h = Number(r.hours) * Number(r.quantity || 1);
      monthHours += h;
      if (r.date >= weekFromStr) weekHours += h;
    }
    const recent = rows.slice(0, 5).map(r => ({
      hours: Number(r.hours) * Number(r.quantity || 1),
      requestNumber: r.requestNumber, date: r.date,
    }));
    await this.render(
      chatId, messageId,
      hoursStatsMessage({ weekHours, monthHours, recent }),
      [[{ text: '‹ Назад', callback_data: 'menu' }]],
    );
  }

  // Defense against a fabricated callback_query (any Telegram client can send arbitrary
  // callback_data, not just the buttons we rendered) — an executor can't browse into another
  // executor's request just by guessing an id.
  private async ownsRequest(detail: { assigneeId: number | null; contractorId: number | null }, user: User): Promise<boolean> {
    if (detail.assigneeId === user.id) return true;
    if (!detail.contractorId) return false;
    const contractorRows = await this.timeEntries.findContractorByEmail(user.email);
    return contractorRows[0]?.id === detail.contractorId;
  }

  private async renderDetail(chatId: number, messageId: number | undefined, user: User, requestId: number, origin: string): Promise<void> {
    const back: InlineButton = { text: '‹ Назад', callback_data: `list:${origin}` };
    const detail = await this.requests.getRequestDetailForTelegram(requestId);
    if (!detail) {
      await this.render(chatId, messageId, 'Заявка не найдена.', [[back]]);
      return;
    }

    const visible = user.role === UserRole.ADMIN
      || (user.role === UserRole.CUSTOMER && detail.customerId === user.customerId)
      || (user.role === UserRole.EXECUTOR && await this.ownsRequest(detail, user));
    if (!visible) {
      await this.render(chatId, messageId, 'Эта заявка вам недоступна.', [[back]]);
      return;
    }

    if (user.role === UserRole.CUSTOMER) {
      const requestUrl = `${APP_URL()}/portal/requests/${detail.number}`;
      const nameParts = (detail.assigneeName || '').split(' ');
      const text = customerDetailMessage({
        number: detail.number, name: detail.name, status: detail.status, requestUrl,
        plannedDate: detail.plannedDate, assigneeFirstName: nameParts[1] || nameParts[0] || null,
        lastComment: detail.lastComment,
      });
      await this.render(chatId, messageId, text, [[back]]);
      return;
    }

    if (user.role === UserRole.ADMIN) {
      const requestUrl = `${APP_URL()}/requests/${detail.number}`;
      const text = adminDetailMessage({
        number: detail.number, name: detail.name, status: detail.status, requestUrl,
        priority: detail.priority, overdueDays: detail.overdueDays,
        assigneeName: detail.assigneeName, customerDept: detail.customerDept, plannedDate: detail.plannedDate,
      });
      await this.render(chatId, messageId, text, [[back]]);
      return;
    }

    // executor
    const requestUrl = `${APP_URL()}/requests/${detail.number}`;
    const text = taskCardMessage({
      number: detail.number, name: detail.name, status: detail.status, requestUrl,
      priority: detail.priority, overdueDays: detail.overdueDays, customerDept: detail.customerDept,
    });
    const buttons = buildQuickActions(requestId, detail.status as RequestStatus, detail.type as RequestType);
    buttons.push([{ text: '➕ Внести часы', callback_data: `time:${requestId}` }]);
    buttons.push([back]);
    await this.render(chatId, messageId, text, buttons);
  }

  private async handlePendingReply(chatId: number, pending: PendingAction, text: string): Promise<void> {
    // Consumed immediately — even a reply the bot can't parse ends the flow rather than getting
    // stuck; the user can just tap the button again.
    this.pending.delete(chatId);
    const user = await this.usersRepo.findOne({ where: { telegramChatId: String(chatId) } });
    if (!user) return;

    if (pending.type === 'finish_comment') {
      const comment = text === '-' ? undefined : text;
      try {
        await this.requests.changeStatus(pending.requestId, RequestStatus.DONE, user.id, comment, undefined, user.role);
        await this.telegram.callBotApi('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `✅ <b>${pending.requestNumber}</b> — отмечена как выполненная.`,
        });
      } catch (e) {
        await this.telegram.callBotApi('sendMessage', { chat_id: chatId, text: `Не удалось завершить заявку: ${e.message}` });
      }
      return;
    }

    if (pending.type === 'time_hours') {
      const hours = Number(text.replace(',', '.').replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(hours) || hours <= 0) {
        this.pending.set(chatId, pending); // keep the flow alive — bad input, not a cancellation
        await this.telegram.callBotApi('sendMessage', {
          chat_id: chatId, text: 'Не похоже на число часов. Пришлите, например: 2 или 1.5',
        });
        return;
      }
      this.pending.set(chatId, {
        type: 'time_comment', requestId: pending.requestId,
        requestNumber: pending.requestNumber, requestName: pending.requestName, hours,
      });
      await this.telegram.callBotApi('sendMessage', {
        chat_id: chatId, parse_mode: 'HTML', text: timeEntryCommentPromptMessage(hours),
      });
      return;
    }

    if (pending.type === 'time_comment') {
      const comment = text === '-' ? undefined : text;
      try {
        // Same rule as the regular time-entries form (TimeEntriesController.create): an
        // executor's hours always land under their linked Contractor record, not their user id.
        const isExecutor = user.role === UserRole.EXECUTOR;
        let contractorId: number | undefined;
        if (isExecutor) {
          const contractorRows = await this.timeEntries.findContractorByEmail(user.email);
          contractorId = contractorRows[0]?.id;
        }
        await this.timeEntries.create({
          requestId: pending.requestId,
          contractorId: isExecutor ? contractorId : undefined,
          userId: isExecutor ? undefined : user.id,
          date: new Date().toISOString().slice(0, 10),
          hours: pending.hours,
          comment,
        });
        await this.telegram.callBotApi('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `✅ Внесено: <b>${pending.hours} ч.</b> по заявке <b>${pending.requestNumber}</b>.`,
        });
      } catch (e) {
        await this.telegram.callBotApi('sendMessage', { chat_id: chatId, text: `Не удалось внести часы: ${e.message}` });
      }
    }
  }

  private async handleMessage(update: any): Promise<void> {
    const text: string | undefined = update?.message?.text;
    const chatId = update?.message?.chat?.id;
    if (!text || !chatId) return;

    // A pending multi-step flow (finish-comment / time-entry) takes priority over commands — a
    // bare number or "-" typed here is an answer to the last prompt, not a new instruction.
    const pending = this.pending.get(chatId);
    if (pending && !text.startsWith('/')) {
      await this.handlePendingReply(chatId, pending, text.trim());
      return;
    }

    if (text.startsWith('/start ')) {
      const linkToken = text.slice('/start '.length).trim();
      const user = await this.usersRepo.findOne({ where: { telegramLinkToken: linkToken } });
      if (user) {
        await this.usersRepo.update(user.id, { telegramChatId: String(chatId), telegramLinkToken: null });
        await this.sendMenu(chatId, { ...user, telegramChatId: String(chatId) } as User);
      } else {
        await this.telegram.callBotApi('sendMessage', {
          chat_id: chatId,
          text: 'Ссылка для привязки устарела или уже использована. Откройте BI Request System → Профиль и нажмите «Привязать Telegram» ещё раз.',
        });
      }
      return;
    }
    if (text === '/start' || text === '/menu') {
      const linked = await this.usersRepo.findOne({ where: { telegramChatId: String(chatId) } });
      if (linked) {
        await this.sendMenu(chatId, linked);
      } else {
        await this.telegram.callBotApi('sendMessage', {
          chat_id: chatId,
          text: '👋 Это бот BI Request System.\n\nЧтобы привязать аккаунт, откройте приложение → Профиль → «Привязать Telegram».',
        });
      }
      return;
    }
    if (text === '/tasks' || text.startsWith('/tasks')) {
      const user = await this.usersRepo.findOne({ where: { telegramChatId: String(chatId) } });
      if (!user) {
        await this.telegram.callBotApi('sendMessage', {
          chat_id: chatId,
          text: 'Аккаунт не привязан. Откройте BI Request System → Профиль → «Привязать Telegram».',
        });
      } else {
        await this.renderList(chatId, undefined, user, 'active');
      }
    }
  }

  private async handleCallbackQuery(update: any): Promise<void> {
    const cq = update.callback_query;
    const chatId = cq?.message?.chat?.id;
    const messageId = cq?.message?.message_id;
    const data: string | undefined = cq?.data;
    if (!cq?.id || !chatId || !data) return;

    const answer = (text?: string, showAlert = false) =>
      this.telegram.callBotApi('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: showAlert }).catch(() => {});

    const user = await this.usersRepo.findOne({ where: { telegramChatId: String(chatId) } });
    if (!user) { await answer('Аккаунт не привязан', true); return; }

    if (data === 'menu') { await answer(); await this.sendMenu(chatId, user, messageId); return; }
    if (data.startsWith('list:')) { await answer(); await this.renderList(chatId, messageId, user, data.slice('list:'.length)); return; }
    if (data.startsWith('req:')) {
      const [, idStr, origin] = data.split(':');
      await answer();
      await this.renderDetail(chatId, messageId, user, Number(idStr), origin || 'active');
      return;
    }
    // Aliases for buttons rendered before this deploy (still visible in old chat history until acted on).
    if (data === 'tasks') { await answer(); await this.renderList(chatId, messageId, user, 'active'); return; }
    if (data === 'admin:active') { await answer(); await this.renderList(chatId, messageId, user, 'active'); return; }
    if (data === 'admin:done') { await answer(); await this.renderList(chatId, messageId, user, 'done'); return; }

    if (data.startsWith('fin:')) {
      const requestId = Number(data.slice('fin:'.length));
      const info = await this.requests.findOne(requestId).catch(() => null);
      if (!info) { await answer('Заявка не найдена', true); return; }
      await answer();
      this.pending.set(chatId, {
        type: 'finish_comment', requestId,
        requestNumber: (info as any).number, requestName: (info as any).name,
      });
      await this.telegram.callBotApi('sendMessage', {
        chat_id: chatId, parse_mode: 'HTML',
        text: finishPromptMessage((info as any).number, (info as any).name),
      });
      return;
    }

    if (data.startsWith('time:')) {
      const requestId = Number(data.slice('time:'.length));
      const info = await this.requests.findOne(requestId).catch(() => null);
      if (!info) { await answer('Заявка не найдена', true); return; }
      await answer();
      this.pending.set(chatId, {
        type: 'time_hours', requestId,
        requestNumber: (info as any).number, requestName: (info as any).name,
      });
      await this.telegram.callBotApi('sendMessage', {
        chat_id: chatId, parse_mode: 'HTML',
        text: timeEntryHoursPromptMessage((info as any).number, (info as any).name),
      });
      return;
    }

    if (data.startsWith('st:')) {
      const [, idStr, status] = data.split(':');
      const requestId = Number(idStr);
      try {
        const updated = await this.requests.changeStatus(requestId, status as RequestStatus, user.id, undefined, undefined, user.role);
        await answer(`✅ Статус: ${(updated as any).status}`);
        // Edit the original message in place (text + fresh buttons for the NEW status) rather
        // than sending a new one — RequestsService.changeStatus() itself skips the follow-up DM
        // when the assignee is the one who made the change (avoids self-notifying), so this is
        // the only place quick actions for the new status get shown to them.
        const nextButtons = buildQuickActions(requestId, (updated as any).status, (updated as any).type);
        nextButtons.push([{ text: '➕ Внести часы', callback_data: `time:${requestId}` }]);
        nextButtons.push([{ text: '‹ Назад', callback_data: 'menu' }]);
        await this.telegram.callBotApi('editMessageText', {
          chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
          text: `${cq.message.text}\n\n✅ ${statusTag(status)}`,
          reply_markup: { inline_keyboard: nextButtons },
        }).catch(() => {});
      } catch (e) {
        await answer(e.message || 'Не удалось изменить статус', true);
      }
    }
  }

  // Tried a webhook here first (Telegram pushes updates instantly instead of us asking on a
  // timer) — reverted. `getWebhookInfo` showed a fresh, real "Connection timed out" with a
  // growing pending_update_count: Telegram's servers could not reliably reach this host inbound,
  // the mirror image of the already-documented problem this app has calling OUT to
  // api.telegram.org from this network (see TELEGRAM_PROXY_URL in architecture.md §8.4) — except
  // there's no equivalent proxy for the inbound direction. `deleteWebhook()` on every boot is
  // defensive: if a webhook is ever left registered, Telegram refuses getUpdates entirely.
  async onModuleInit(): Promise<void> {
    if (process.env.DISABLE_SCHEDULED_JOBS === '1') return;
    const { token } = await this.telegram.getCredentials();
    if (!token) return;
    try {
      await this.telegram.callBotApi('deleteWebhook', { drop_pending_updates: false });
    } catch (e) {
      this.logger.warn(`deleteWebhook не удался (не критично, если вебхука и так не было): ${e.message}`);
    }
  }

  // Guards against two ticks running concurrently (e.g. one tick still processing a burst of
  // updates when the next one fires) — without this, both could read the same offset from
  // settings and double-process the same batch (double status changes, double time entries).
  private polling = false;

  // Every 3 seconds, ask Telegram for anything sent to (or tapped on) the bot since the last
  // poll (offset persisted in settings so a restart doesn't reprocess the same batch). Short
  // (timeout: 0) polling, not long-polling — keeps each tick fast and bounded, avoiding any risk
  // of overlapping with the next one.
  @Cron('*/3 * * * * *')
  async pollUpdates(): Promise<void> {
    if (process.env.DISABLE_SCHEDULED_JOBS === '1') return;
    if (this.polling) return;
    this.polling = true;
    try {
      await this.doPoll();
    } finally {
      this.polling = false;
    }
  }

  private async doPoll(): Promise<void> {
    const { token } = await this.telegram.getCredentials();
    if (!token) return;
    await this.ensureBotUiRegistered();

    const offsetSetting = await this.settings.get('telegram_updates_offset');
    const offset = offsetSetting ? Number(offsetSetting) : undefined;

    let updates: any[];
    try {
      const res = await this.telegram.callBotApi('getUpdates', {
        timeout: 0,
        allowed_updates: ['message', 'callback_query'],
        ...(offset !== undefined ? { offset } : {}),
      });
      updates = res?.result ?? [];
    } catch (e) {
      this.logger.warn(`Опрос Telegram getUpdates не удался: ${e.message}`);
      return;
    }
    if (!updates.length) return;

    for (const update of updates) {
      try {
        if (update.callback_query) await this.handleCallbackQuery(update);
        else if (update.message) await this.handleMessage(update);
      } catch (e) {
        this.logger.error(`Ошибка обработки Telegram-апдейта ${update.update_id}: ${e.message}`);
      }
    }

    const lastUpdateId = updates[updates.length - 1].update_id;
    await this.settings.set('telegram_updates_offset', String(lastUpdateId + 1));
  }

  // Personal "good morning" digest — executors only (customers/admins have no "assigned work"
  // concept to remind them about); fixed schedule (not per-module configurable like the admin
  // escalation checks in EscalationService — this is a per-user preference-free MVP). Skips
  // anyone with zero active tasks so linked-but-idle users don't get an empty ping.
  @Cron('30 8 * * 1-5', MSK)
  async morningDigest(): Promise<void> {
    if (process.env.DISABLE_SCHEDULED_JOBS === '1') return;
    const { token } = await this.telegram.getCredentials();
    if (!token) return;

    const linkedUsers = await this.usersRepo.find({ where: { role: UserRole.EXECUTOR } });
    for (const user of linkedUsers) {
      if (!user.telegramChatId) continue;
      try {
        const rows = await this.requests.findActiveForTelegram(user.id, user.email);
        if (!rows.length) continue;
        const firstName = user.fullName.split(' ')[1] || user.fullName.split(' ')[0];
        await this.telegram.callBotApi('sendMessage', {
          chat_id: user.telegramChatId, parse_mode: 'HTML',
          text: tasksMessage(user.fullName, rows, APP_URL(), { greeting: `Доброе утро, ${firstName}!` }),
        });
      } catch (e) {
        this.logger.warn(`Дайджест не отправлен пользователю ${user.id}: ${e.message}`);
      }
    }
  }
}
