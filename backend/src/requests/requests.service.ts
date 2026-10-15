import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { BiRequest, RequestStatus, RequestType, Priority } from './request.entity';
import { Artifact, ArtifactType } from './artifact.entity';
import { Activity } from './activity.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
import { RatingsService } from '../ratings/ratings.service';
import { UsersService } from '../users/users.service';
import { TelegramService, InlineButton } from '../settings/telegram.service';
import { assignedMessage, statusChangedMessage, commentMessage, customerStatusMessage } from '../settings/telegram-format';
import { getAppUrl } from '../common/app-config';

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая', queued: 'В очереди',
  in_progress: 'В работе', waiting_customer: 'Ожидание заказчика',
  review: 'На проверке', rework: 'На доработке',
  done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена',
};
const TYPE_LABELS: Record<string, string> = {
  development: 'Разработка', improvement: 'Доработка', bugfix: 'Баг-фикс',
  consultation: 'Консультация', other: 'Прочее',
};
const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий',
};

const CLOSED_STATUSES = ['done', 'rejected', 'cancelled'];

// Active requests first (most recently created on top within that group — matches the "newest
// on top" expectation everyone has for a list, rather than burying a just-filed request under
// whatever else happens to have a closer deadline), closed ones pushed to the bottom, most
// recently closed first. Urgency (overdue/critical/soon-due) is now surfaced visually instead
// via the row indicator dot (see RequestsPage.tsx urgencyDotColor) — the "by nearest deadline"
// ordering is still one click away on the "Плановый срок" column header for anyone triaging.
// Done in JS (see findAll) rather than SQL because a raw CASE-expression orderBy breaks
// TypeORM's getManyAndCount() once leftJoinAndSelect + skip/take are both in play.
function sortActiveFirst(a: any, b: any): number {
  const aClosed = CLOSED_STATUSES.includes(a.status) ? 1 : 0;
  const bClosed = CLOSED_STATUSES.includes(b.status) ? 1 : 0;
  if (aClosed !== bClosed) return aClosed - bClosed;
  if (!aClosed) {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }
  const aDate = a.closedAt ? new Date(a.closedAt).getTime() : -Infinity;
  const bDate = b.closedAt ? new Date(b.closedAt).getTime() : -Infinity;
  return bDate - aDate;
}

// Whitelisted click-to-sort columns for the Requests table — keys match the frontend
// column `key`s exactly, so requests.controller.ts can pass sortField straight through
// without a translation layer. Falls back to sortActiveFirst for anything else/unset.
const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const SORT_COMPARATORS: Record<string, (a: any, b: any) => number> = {
  number: (a, b) => {
    const an = Number(a.number), bn = Number(b.number);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(a.number).localeCompare(String(b.number));
  },
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'),
  type: (a, b) => String(a.type || '').localeCompare(String(b.type || '')),
  status: (a, b) => String(a.status || '').localeCompare(String(b.status || '')),
  priority: (a, b) => (PRIORITY_RANK[a.priority] || 0) - (PRIORITY_RANK[b.priority] || 0),
  assignee: (a, b) => String(a.assignee?.fullName || '').localeCompare(String(b.assignee?.fullName || ''), 'ru'),
  createdAt: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  plannedDate: (a, b) => {
    const at = a.plannedDate ? new Date(a.plannedDate).getTime() : Infinity;
    const bt = b.plannedDate ? new Date(b.plannedDate).getTime() : Infinity;
    return at - bt;
  },
};

function applySort(rows: any[], sortField?: string, sortOrder?: string) {
  const cmp = sortField ? SORT_COMPARATORS[sortField] : undefined;
  if (!cmp) return rows.sort(sortActiveFirst);
  const dir = sortOrder === 'descend' ? -1 : 1;
  return rows.sort((a, b) => dir * cmp(a, b));
}

// "На уточнении" (clarification) and "Согласование" (approval) were folded into "Ожидание
// заказчика" and "На проверке" respectively — both were near-duplicates of the status they
// merged into (same SLA/escalation treatment, same analytics bucket, no distinct notification or
// permission), so keeping them as separate statuses only added clicks without adding signal. The
// RequestStatus enum values themselves stay defined (this column is a native Postgres enum and
// synchronize is on in prod — dropping enum values isn't a safe online operation), migrated away
// from in AppService.onModuleInit(), just no longer reachable from here on.
// "В работе → Готово" is now a direct edge for every type, not just bugs — "На проверке" stays
// available as an optional stop for whoever actually wants a second pair of eyes before closing,
// it's just no longer mandatory.
const STATUS_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  [RequestStatus.NEW]: [RequestStatus.QUEUED, RequestStatus.IN_PROGRESS, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.QUEUED]: [RequestStatus.IN_PROGRESS, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.IN_PROGRESS]: [RequestStatus.QUEUED, RequestStatus.WAITING_CUSTOMER, RequestStatus.REVIEW, RequestStatus.DONE, RequestStatus.CANCELLED],
  // DONE is reachable directly from here too — sometimes the "уточнение" itself was the whole
  // ask (e.g. explaining a calculation) and the customer's answer already closes it out, with
  // nothing left for the executor to build.
  [RequestStatus.WAITING_CUSTOMER]: [RequestStatus.IN_PROGRESS, RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.REVIEW]: [RequestStatus.IN_PROGRESS, RequestStatus.WAITING_CUSTOMER, RequestStatus.DONE, RequestStatus.REWORK],
  [RequestStatus.REWORK]: [RequestStatus.IN_PROGRESS],
  [RequestStatus.DONE]: [RequestStatus.REVIEW, RequestStatus.IN_PROGRESS, RequestStatus.REWORK],
  [RequestStatus.REJECTED]: [RequestStatus.NEW],
  [RequestStatus.CANCELLED]: [RequestStatus.NEW],
};

// Expression indexed by the GIN index created in AppService.onModuleInit — keep both in sync.
const SEARCH_VECTOR_SQL = (alias: string) =>
  `to_tsvector('russian', coalesce(${alias}.name,'') || ' ' || coalesce(${alias}.description,'') || ' ' || coalesce(${alias}.number,''))`;

const BUG_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  [RequestStatus.NEW]: [RequestStatus.IN_PROGRESS, RequestStatus.WAITING_CUSTOMER, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.QUEUED]: [RequestStatus.IN_PROGRESS, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.IN_PROGRESS]: [RequestStatus.WAITING_CUSTOMER, RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  // DONE is reachable directly from here too — sometimes the "уточнение" itself was the whole
  // ask (e.g. explaining a calculation) and the customer's answer already closes it out, with
  // nothing left for the executor to build.
  [RequestStatus.WAITING_CUSTOMER]: [RequestStatus.IN_PROGRESS, RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.REVIEW]: [RequestStatus.IN_PROGRESS, RequestStatus.DONE, RequestStatus.REWORK],
  [RequestStatus.REWORK]: [RequestStatus.IN_PROGRESS],
  [RequestStatus.DONE]: [RequestStatus.IN_PROGRESS, RequestStatus.REWORK],
  [RequestStatus.REJECTED]: [RequestStatus.NEW],
  [RequestStatus.CANCELLED]: [RequestStatus.NEW],
};

// Curated one-tap actions for Telegram notification buttons — NOT the full transition graph
// (that has 4-6 options per status, too noisy for a chat button row, and includes destructive
// ones like "Отклонить"/"Отменить" that shouldn't be a single accidental tap away). Whatever is
// offered here is still re-validated against the real STATUS_TRANSITIONS/BUG_TRANSITIONS by
// changeStatus() when the button is actually pressed (see TelegramBotService), so a stale entry
// here can only be over-cautious, never unsafe.
const PRIMARY_NEXT: Partial<Record<RequestStatus, { status: RequestStatus; label: string }[]>> = {
  [RequestStatus.NEW]: [
    { status: RequestStatus.IN_PROGRESS, label: '▶️ Взять в работу' },
    { status: RequestStatus.QUEUED, label: '📋 В очередь' },
  ],
  [RequestStatus.QUEUED]: [{ status: RequestStatus.IN_PROGRESS, label: '▶️ Взять в работу' }],
  [RequestStatus.IN_PROGRESS]: [
    { status: RequestStatus.REVIEW, label: '👀 На проверку' },
    { status: RequestStatus.DONE, label: '✅ Готово' },
    { status: RequestStatus.WAITING_CUSTOMER, label: '⏸️ Ждём заказчика' },
  ],
  [RequestStatus.WAITING_CUSTOMER]: [{ status: RequestStatus.IN_PROGRESS, label: '▶️ Возобновить' }],
  [RequestStatus.REVIEW]: [
    { status: RequestStatus.DONE, label: '✅ Завершить' },
    { status: RequestStatus.REWORK, label: '↩️ На доработку' },
  ],
  [RequestStatus.REWORK]: [{ status: RequestStatus.IN_PROGRESS, label: '▶️ Взять в работу' }],
};

export function buildQuickActions(id: number, status: RequestStatus, type: RequestType): InlineButton[][] {
  const transitions = type === RequestType.BUGFIX ? BUG_TRANSITIONS : STATUS_TRANSITIONS;
  const allowed = new Set(transitions[status] || []);
  const candidates = (PRIMARY_NEXT[status] || []).filter(c => allowed.has(c.status)).slice(0, 4);
  const buttons: InlineButton[] = candidates.map(c => ({
    text: c.label,
    // "Завершить"/"Готово" (→ done) asks for a completion comment first (see TelegramBotService
    // pending-action flow) instead of changing status on the spot like every other transition —
    // callback_data "fin:<id>" instead of "st:<id>:done" signals that to the bot.
    callback_data: c.status === RequestStatus.DONE ? `fin:${id}` : `st:${id}:${c.status}`,
  }));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(BiRequest) private requestsRepo: Repository<BiRequest>,
    @InjectRepository(Artifact) private artifactsRepo: Repository<Artifact>,
    @InjectRepository(Activity) private activitiesRepo: Repository<Activity>,
    private dataSource: DataSource,
    private notifications: NotificationsService,
    private inAppNotifications: InAppNotificationsService,
    private ratingsService: RatingsService,
    private usersService: UsersService,
    private telegram: TelegramService,
  ) {}

  // Lets a team lead (a User other executors report to via managerId) hand a request they're
  // currently assigned off to one of their own direct reports — without opening up general
  // reassignment to non-admins. Admins bypass the "current assignee" / "is my subordinate"
  // checks entirely, same as the regular update() path.
  async delegate(id: number, newAssigneeId: number, actingUser: { id: number; role: string }) {
    const rows = await this.dataSource.query(`SELECT "assigneeId" FROM requests WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('Заявка не найдена');

    if (actingUser.role !== 'admin') {
      const subordinates = await this.usersService.getSubordinates(actingUser.id);
      // A lead can redistribute at any point, not just once right after the request lands on
      // them — the request just has to currently be somewhere in their own team (on the lead
      // themself, or already on one of their subordinates from an earlier delegation) — or not
      // assigned to anyone yet. Without that last part, a brand-new unassigned request was stuck
      // waiting on an admin for the very first assignment even when a lead (or any executor —
      // they already see the full company-wide list, same as "Все заявки") was ready to claim it.
      const teamIds = [actingUser.id, ...subordinates.map((u) => u.id)];
      const currentAssignee = rows[0].assigneeId;
      if (currentAssignee != null && !teamIds.includes(currentAssignee)) {
        throw new ForbiddenException('Передать можно только заявку, которая сейчас на вас, на вашем подчинённом, или ещё не назначена никому');
      }
      // Same team boundary for the target — including the lead themself, so a request handed
      // out earlier can be pulled back, not just moved sideways between subordinates.
      if (!teamIds.includes(newAssigneeId)) {
        throw new ForbiddenException('Можно передать заявку только себе или своему подчинённому');
      }
    }
    return this.update(id, { assigneeId: newAssigneeId }, actingUser.id);
  }

  private async generateNumber(): Promise<string> {
    // Atomic — uses a Postgres sequence (initialized in AppService.onModuleInit) instead of
    // MAX(number)+1, which raced under concurrent creates and could produce duplicate numbers.
    const rows = await this.dataSource.query(`SELECT nextval('request_number_seq') AS next`);
    return String(rows[0].next);
  }

  async findAll(filters: {
    status?: string; assigneeId?: number; contractorId?: number; customerId?: number;
    reportId?: number; priority?: string; search?: string; page?: number; pageSize?: number;
    userId?: number; userRole?: string; userEmail?: string; userCustomerId?: number; mine?: boolean;
    overdue?: boolean; sortField?: string; sortOrder?: string;
  }) {
    const qb = this.requestsRepo.createQueryBuilder('r')
      .leftJoinAndSelect('r.customer', 'customer')
      .leftJoinAndSelect('r.report', 'report')
      .leftJoinAndSelect('r.assignee', 'assignee')
      .leftJoinAndSelect('r.contractor', 'contractor')
      .leftJoinAndSelect('r.createdBy', 'createdBy')
      .leftJoinAndSelect('r.billingCompany', 'billingCompany')
      // Just a stable base order — the real "active first" ordering happens in JS below
      // (sortActiveFirst), because a raw CASE-expression orderBy here breaks TypeORM's
      // getManyAndCount() once leftJoinAndSelect + skip/take are both in play ("alias was
      // not found"). Fine at this app's scale: sort the full filtered set in memory, then
      // paginate.
      .orderBy('r.createdAt', 'DESC');

    if (filters.status) {
      const statuses = filters.status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length > 1) qb.andWhere('r.status IN (:...statuses)', { statuses });
      else qb.andWhere('r.status = :status', { status: statuses[0] });
    }
    if (filters.assigneeId) qb.andWhere('r.assigneeId = :assigneeId', { assigneeId: filters.assigneeId });
    if (filters.contractorId) qb.andWhere('r.contractorId = :contractorId', { contractorId: filters.contractorId });
    if (filters.customerId) qb.andWhere('r.customerId = :customerId', { customerId: filters.customerId });
    if (filters.reportId) qb.andWhere('r.reportId = :reportId', { reportId: filters.reportId });
    if (filters.priority) qb.andWhere('r.priority = :priority', { priority: filters.priority });
    if (filters.overdue) {
      qb.andWhere('r.plannedDate < NOW()')
        .andWhere('r.status NOT IN (:...openClosed)', { openClosed: ['done', 'rejected', 'cancelled'] });
    }
    if (filters.search) {
      // Indexed full-text match (name/description, via the expression GIN index created in
      // AppService.onModuleInit) OR'd with substring match on name/number, so short/partial
      // queries (e.g. request numbers) keep working as before.
      qb.andWhere(
        `(${SEARCH_VECTOR_SQL('r')} @@ websearch_to_tsquery('russian', :ts) OR r.name ILIKE :s OR r.number ILIKE :s)`,
        { ts: filters.search, s: `%${filters.search}%` },
      );
    }
    // Portal customers see only their organization's requests. A customer-role account with no
    // customerId (e.g. a brand-new SSO login — the provider never supplies one) used to fall through
    // this check entirely and see every organization's requests unfiltered — a real data
    // exposure, not a hypothetical one. Never leave this branch without SOME restriction: fall
    // back to just their own submissions (which is also exactly what an "on-behalf" request
    // links to once EmailAuth's linkOnBehalfRequests() sets their createdById on SSO login).
    if (filters.userRole === 'customer') {
      if (filters.userCustomerId) {
        qb.andWhere('r.customerId = :userCustomerId', { userCustomerId: filters.userCustomerId });
      } else {
        qb.andWhere('r.createdById = :selfId', { selfId: filters.userId ?? -1 });
      }
    }
    // A team lead's own view of "mine" includes what they've delegated to a direct report —
    // otherwise handing a request off via RequestsService.delegate() makes it vanish from every
    // list (Заявки, Kanban) the moment it moves off their own name, with no way to follow up.
    const subordinateIds = filters.userRole === 'executor' && filters.userId
      ? (await this.usersService.getSubordinates(filters.userId)).map((u) => u.id)
      : [];
    // "Мои заявки" toggle — narrows to the user's own (+ their team's) assignments. Opt-in via
    // `mine`, never implied purely by role: an executor's "Все заявки" tab must show the same
    // full list an admin's does, or the tab lies. (This used to be hard-applied for every
    // executor request regardless of the toggle, so "Все заявки" was silently identical to
    // "Мои заявки" — RequestsPage.tsx defaults executors to mine=true on load, so this alone
    // doesn't change the default view, only what "Все заявки" actually shows.)
    if (filters.mine && filters.userId) {
      qb.andWhere(
        '(r.assigneeId IN (:...mineIds) OR r.contractorId IN (SELECT c.id FROM contractors c WHERE c.email = :mineEmail))',
        { mineIds: [filters.userId, ...subordinateIds], mineEmail: filters.userEmail || '' },
      );
    }

    // Pagination is opt-in: pass page+pageSize to get { data, total }; omit for the plain
    // array (used by Kanban/Portal/dropdowns, which need the whole filtered set at once).
    if (filters.page && filters.pageSize) {
      const all = await qb.getMany();
      applySort(all, filters.sortField, filters.sortOrder);
      const start = (filters.page - 1) * filters.pageSize;
      const data = all.slice(start, start + filters.pageSize);
      return { data, total: all.length, page: filters.page, pageSize: filters.pageSize };
    }

    const all = await qb.getMany();
    applySort(all, filters.sortField, filters.sortOrder);
    return all;
  }

  // GET /requests/:id had no ownership check at all — any authenticated user could open any
  // request by id (description, attachments, internal comments) regardless of organization.
  // Admin and executor both already see every request via the list endpoint (see findAll —
  // "Все заявки" is unrestricted by design), so only the customer role actually needs scoping
  // here: same rule the list uses (own organization, or — no customerId yet, e.g. a brand-new
  // SSO login — fall back to only what they themselves submitted).
  assertCanView(req: { customerId?: number | null; createdById?: number | null }, user: { id: number; role?: string; customerId?: number | null }) {
    if (user.role !== 'customer') return;
    if (user.customerId && req.customerId === user.customerId) return;
    if (req.createdById === user.id) return;
    throw new ForbiddenException('Нет доступа к этой заявке');
  }

  async findOne(id: number) {
    const req = await this.requestsRepo.findOne({
      where: { id },
      relations: ['customer', 'report', 'assignee', 'contractor', 'createdBy', 'billingCompany',
        'timeEntries', 'timeEntries.user', 'timeEntries.contractor',
        'artifacts', 'artifacts.uploadedBy',
        'activities', 'activities.author'],
    });
    if (!req) throw new NotFoundException('Заявка не найдена');

    const totalHours = req.timeEntries.reduce(
      (s, te) => s + Number(te.hours) * Number((te as any).quantity || 1), 0,
    );
    const costRows = await this.dataSource.query(`
      SELECT COALESCE(SUM(
        te.hours::numeric * COALESCE(te.quantity::numeric,1) * COALESCE(rh.rate::numeric,0)
      ), 0) AS "totalCost"
      FROM time_entries te
      LEFT JOIN LATERAL (
        SELECT rate FROM rate_history rh2
        WHERE (rh2."userId" = te."userId" OR rh2."contractorId" = te."contractorId")
          AND rh2."dateFrom" <= te.date
          AND (rh2."dateTo" IS NULL OR rh2."dateTo" >= te.date)
        ORDER BY rh2."dateFrom" DESC LIMIT 1
      ) rh ON true
      WHERE te."requestId" = $1
    `, [id]);
    const totalCost = Number(costRows[0]?.totalCost || 0);
    return { ...req, totalHours, totalCost };
  }

  async create(dto: {
    type: RequestType; name: string; customerId?: number; reportId?: number;
    priority?: Priority; description?: string; plannedHours?: number; plannedDate?: string;
    assigneeId?: number; contractorId?: number;
    impact?: string; urgency?: string; affectedUsers?: number;
    stepsToReproduce?: string; expectedBehavior?: string; actualBehavior?: string;
    environment?: string; workaround?: string;
    dataSources?: string; targetAudience?: string; refreshFrequency?: string;
    // "Заявитель другой" — заявку оформляет один сотрудник (userId, для аудита/прав), но по
    // просьбе другого, взятого из HR-справочника (см. EmployeesService). Этот человек — не
    // обязательно User системы, поэтому храним просто имя/email, а не userId.
    onBehalfOfName?: string; onBehalfOfEmail?: string;
    // Кто платит за эту работу (см. billing-companies) — обычно не указывается явно: если есть
    // reportId, наследуем у дашборда; иначе (например, заявка на новый дашборд) падаем на
    // компанию по умолчанию, пока исполнитель не выберет нужную сам через update().
    billingCompanyId?: number;
  }, userId: number, userRole?: string) {
    const priority = dto.priority ?? Priority.MEDIUM;
    let plannedDate = dto.plannedDate;
    if (!plannedDate) {
      const slaRows = await this.dataSource.query(
        `SELECT value FROM dictionaries WHERE type = 'sla_days' AND code = $1 AND "isActive" = true LIMIT 1`,
        [priority],
      );
      if (slaRows.length > 0) {
        const days = parseInt(slaRows[0].value, 10);
        const d = new Date();
        d.setDate(d.getDate() + days);
        plannedDate = d.toISOString().split('T')[0];
      }
    }
    // Как и в update(), явно указать юрлицо-плательщика может только тот, кто ведёт работу
    // (админ/исполнитель) — иначе (например, портальный заказчик руками собравший запрос)
    // тихо игнорируем поле и падаем на наследование/дефолт ниже.
    let billingCompanyId = (userRole === 'admin' || userRole === 'executor') ? dto.billingCompanyId : undefined;
    if (!billingCompanyId && dto.reportId) {
      const reportRows = await this.dataSource.query(
        `SELECT "billingCompanyId" FROM reports_ref WHERE id = $1`, [dto.reportId],
      );
      billingCompanyId = reportRows[0]?.billingCompanyId ?? undefined;
    }
    if (!billingCompanyId) {
      const defaultRows = await this.dataSource.query(
        `SELECT id FROM billing_companies WHERE "isDefault" = true LIMIT 1`,
      );
      billingCompanyId = defaultRows[0]?.id;
    }
    const number = await this.generateNumber();
    const req = this.requestsRepo.create({ ...dto, priority, plannedDate, billingCompanyId, number, createdById: userId });
    const saved = await this.requestsRepo.save(req);
    await this.activitiesRepo.save(
      this.activitiesRepo.create({ requestId: saved.id, authorId: userId, action: 'Заявка создана' }),
    );

    // Email notification on creation — goes to the on-behalf-of requester when set, otherwise
    // to whoever actually filled the form.
    const authorRows = await this.dataSource.query(
      'SELECT "fullName", email FROM users WHERE id = $1 LIMIT 1', [userId],
    );
    const author = authorRows[0];
    const appUrl = getAppUrl();
    const notifyTo = dto.onBehalfOfEmail || author?.email;
    const notifyToName = dto.onBehalfOfEmail ? dto.onBehalfOfName : author?.fullName;
    if (notifyTo) {
      this.notifications.notifyRequestCreated({
        to: notifyTo,
        toName: notifyToName,
        requestNumber: number,
        requestName: dto.name,
        requestUrl: `${appUrl}/portal/requests/${number}`,
      }).catch(() => {});
    }

    return saved;
  }

  async update(id: number, dto: Partial<{
    name: string; type: RequestType; priority: Priority; customerId: number;
    reportId: number; assigneeId: number; contractorId: number;
    description: string; plannedHours: number; plannedDate: string;
    impact: string; urgency: string; affectedUsers: number;
    stepsToReproduce: string; expectedBehavior: string; actualBehavior: string;
    environment: string; workaround: string;
    dataSources: string; targetAudience: string; refreshFrequency: string;
    knownErrorId: number;
    // Исполнитель меняет это, когда берёт в работу заявку на новый дашборд без reportId —
    // "относит" её к нужному юрлицу (см. billing-companies).
    billingCompanyId: number;
    // Re-attributes "Заявитель" to someone else after the fact (e.g. the request was logged on
    // the wrong person, or on behalf of someone found later) — see requesterDisplay() on the
    // frontend for how this pair overrides createdBy for display. Passing both as null clears
    // the override back to whoever actually submitted the request.
    onBehalfOfName: string | null; onBehalfOfEmail: string | null;
  }>, userId: number, userRole?: string, userEmail?: string) {
    const req = await this.findOne(id);

    // Snapshot of the human-readable "before" state, captured before anything below mutates
    // `req` — a flat "Заявка обновлена" told nobody what actually changed (e.g. who reassigned
    // the executor), just that *something* did. The diff built from this is logged as the
    // activity's `details` further down, once we know the "after" names too.
    const before = {
      name: req.name, type: req.type, priority: req.priority,
      plannedDate: req.plannedDate, plannedHours: req.plannedHours,
      description: req.description,
      customerId: (req as any).customerId, customerName: (req as any).customer?.department,
      reportId: (req as any).reportId, reportName: (req as any).report?.name,
      assigneeId: (req as any).assigneeId, assigneeName: (req as any).assignee?.fullName,
      contractorId: (req as any).contractorId, contractorName: (req as any).contractor?.name,
      billingCompanyId: (req as any).billingCompanyId, billingCompanyName: (req as any).billingCompany?.name,
      knownErrorId: (req as any).knownErrorId,
      impact: (req as any).impact, urgency: (req as any).urgency, affectedUsers: (req as any).affectedUsers,
      stepsToReproduce: (req as any).stepsToReproduce, expectedBehavior: (req as any).expectedBehavior,
      actualBehavior: (req as any).actualBehavior, environment: (req as any).environment,
      workaround: (req as any).workaround, dataSources: (req as any).dataSources,
      targetAudience: (req as any).targetAudience, refreshFrequency: (req as any).refreshFrequency,
      onBehalfOfName: (req as any).onBehalfOfName, onBehalfOfEmail: (req as any).onBehalfOfEmail,
    } as Record<string, any>;

    // Юрлицо влияет на то, кому в итоге выставляется акт — это финансовая привязка заявки,
    // а не рабочее поле. Разрешаем менять админу всегда, а иначе только тому, кто ведёт именно
    // эту заявку (назначенный исполнитель или привязанный по email подрядчик), а не любому
    // авторизованному пользователю (было можно поставить чужой заявке любое юрлицо через PUT).
    if ('billingCompanyId' in dto && userRole && userRole !== 'admin') {
      const isAssignee = userId != null && (req as any).assigneeId === userId;
      let isLinkedContractor = false;
      if (!isAssignee && userEmail && (req as any).contractorId) {
        const rows = await this.dataSource.query(
          'SELECT id FROM contractors WHERE email = $1', [userEmail],
        );
        isLinkedContractor = rows.some((r: any) => r.id === (req as any).contractorId);
      }
      if (!isAssignee && !isLinkedContractor) {
        throw new ForbiddenException('Юрлицо-плательщика может менять только администратор или исполнитель этой заявки');
      }
    }

    const appUrl = getAppUrl();
    const prevContractorId = (req as any).contractorId;
    const prevAssigneeId = (req as any).assigneeId;
    // findOne() eager-loads the assignee/contractor/customer/report relation objects. If we
    // only reassign the scalar *Id column, TypeORM still finds the stale relation object on
    // the entity and derives the join column FROM IT on save — silently reverting the change
    // (PUT returns 200, but the FK never actually moves). Clear the loaded relation whenever
    // its *Id is being changed so the new scalar value is what actually gets persisted.
    if ('assigneeId' in dto) (req as any).assignee = null;
    if ('contractorId' in dto) (req as any).contractor = null;
    if ('customerId' in dto) (req as any).customer = null;
    if ('reportId' in dto) (req as any).report = null;
    if ('billingCompanyId' in dto) (req as any).billingCompany = null;
    Object.assign(req, dto);
    const saved = await this.requestsRepo.save(req);

    const fmtDate = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('.') : '—';
    const changes: string[] = [];
    if ('name' in dto && dto.name !== before.name) changes.push(`Название: «${before.name}» → «${dto.name}»`);
    if ('type' in dto && dto.type !== before.type) changes.push(`Тип услуги: ${TYPE_LABELS[before.type] || before.type} → ${TYPE_LABELS[dto.type as string] || dto.type}`);
    if ('priority' in dto && dto.priority !== before.priority) changes.push(`Приоритет: ${PRIORITY_LABELS[before.priority] || before.priority} → ${PRIORITY_LABELS[dto.priority as string] || dto.priority}`);
    if ('plannedDate' in dto && dto.plannedDate !== before.plannedDate) changes.push(`Плановый срок: ${fmtDate(before.plannedDate)} → ${fmtDate(dto.plannedDate)}`);
    if ('plannedHours' in dto && dto.plannedHours !== before.plannedHours) changes.push(`Плановые часы: ${before.plannedHours ?? '—'} → ${dto.plannedHours ?? '—'}`);
    if ('description' in dto && dto.description !== before.description) changes.push('Описание изменено');
    if ('knownErrorId' in dto && dto.knownErrorId !== before.knownErrorId) changes.push('Связь с известной ошибкой изменена');
    if ('onBehalfOfName' in dto && dto.onBehalfOfName !== before.onBehalfOfName) {
      changes.push(`Заявитель: ${before.onBehalfOfName || '—'} → ${dto.onBehalfOfName || '—'}`);
    }

    // Lookup fields need the "after" side re-fetched with relations to show a name, not just an
    // id — assignee/contractor/customer/report/billingCompany may have been nulled above and
    // `saved` won't have the new relation object hydrated.
    const lookupChanges: { key: string; label: string }[] = [
      { key: 'assigneeId', label: 'Исполнитель' },
      { key: 'contractorId', label: 'Подрядчик' },
      { key: 'customerId', label: 'Заказчик' },
      { key: 'reportId', label: 'Дашборд' },
      { key: 'billingCompanyId', label: 'Юрлицо' },
    ].filter(({ key }) => key in dto && (dto as any)[key] !== before[key]);
    if (lookupChanges.length) {
      const after = await this.findOne(id);
      const afterNames: Record<string, string | undefined> = {
        assigneeId: (after as any).assignee?.fullName,
        contractorId: (after as any).contractor?.name,
        customerId: (after as any).customer?.department,
        reportId: (after as any).report?.name,
        billingCompanyId: (after as any).billingCompany?.name,
      };
      const beforeNames: Record<string, string | undefined> = {
        assigneeId: before.assigneeName, contractorId: before.contractorName,
        customerId: before.customerName, reportId: before.reportName,
        billingCompanyId: before.billingCompanyName,
      };
      for (const { key, label } of lookupChanges) {
        changes.push(`${label}: ${beforeNames[key] || '—'} → ${afterNames[key] || '—'}`);
      }
    }

    const longTextFields: Record<string, string> = {
      impact: 'Влияние', urgency: 'Срочность', affectedUsers: 'Кол-во затронутых пользователей',
      stepsToReproduce: 'Шаги воспроизведения', expectedBehavior: 'Ожидаемое поведение',
      actualBehavior: 'Фактическое поведение', environment: 'Окружение', workaround: 'Обходной путь',
      dataSources: 'Источники данных', targetAudience: 'Целевая аудитория', refreshFrequency: 'Частота обновления',
    };
    for (const [key, label] of Object.entries(longTextFields)) {
      if (key in dto && (dto as any)[key] !== before[key]) changes.push(`${label} изменено`);
    }

    await this.activitiesRepo.save(
      this.activitiesRepo.create({
        requestId: id, authorId: userId, action: 'Заявка обновлена',
        details: changes.length ? changes.join('<br>') : undefined,
      }),
    );
    // Уведомить нового исполнителя (внешнего подрядчика)
    if (dto.contractorId && dto.contractorId !== prevContractorId) {
      const rows = await this.dataSource.query(
        'SELECT name, email FROM contractors WHERE id = $1',
        [dto.contractorId],
      );
      const contractor = rows[0];
      if (contractor?.email) {
        this.notifications.notifyContractorAssigned({
          to: contractor.email,
          toName: contractor.name,
          requestNumber: (req as any).number,
          requestName: (req as any).name,
          customerDepartment: (req as any).customer?.department || '',
          plannedDate: (req as any).plannedDate,
          description: (req as any).description,
          requestUrl: `${appUrl}/requests/${(req as any).number}`,
        }).catch(() => {});
        // Contractor logins are regular executor accounts linked by email (see
        // ContractorsService.upsertLinkedUser) — resolve to that account for the Telegram DM,
        // since the "contractors" row itself has no telegramChatId of its own.
        this.dataSource.query('SELECT id FROM users WHERE email = $1 AND "isActive" = true', [contractor.email])
          .then((userRows) => {
            if (userRows[0]?.id) {
              this.telegram.sendToUser(
                userRows[0].id,
                assignedMessage({
                  number: (req as any).number, name: (req as any).name,
                  customerDepartment: (req as any).customer?.department,
                  plannedDate: (req as any).plannedDate,
                  requestUrl: `${appUrl}/requests/${(req as any).number}`,
                }),
                buildQuickActions(id, (req as any).status, (req as any).type),
              );
            }
          }).catch(() => {});
      }
    }
    // Уведомить нового исполнителя (внутреннего сотрудника) — этой ветки раньше не было
    // вообще, поэтому назначение через assigneeId никогда не слало письмо.
    if (dto.assigneeId && dto.assigneeId !== prevAssigneeId) {
      const rows = await this.dataSource.query(
        'SELECT "fullName", email FROM users WHERE id = $1',
        [dto.assigneeId],
      );
      const user = rows[0];
      if (user?.email) {
        this.notifications.notifyContractorAssigned({
          to: user.email,
          toName: user.fullName,
          requestNumber: (req as any).number,
          requestName: (req as any).name,
          customerDepartment: (req as any).customer?.department || '',
          plannedDate: (req as any).plannedDate,
          description: (req as any).description,
          requestUrl: `${appUrl}/requests/${(req as any).number}`,
        }).catch(() => {});
      }
      this.telegram.sendToUser(
        dto.assigneeId,
        assignedMessage({
          number: (req as any).number, name: (req as any).name,
          customerDepartment: (req as any).customer?.department,
          plannedDate: (req as any).plannedDate,
          requestUrl: `${appUrl}/requests/${(req as any).number}`,
        }),
        buildQuickActions(id, (req as any).status, (req as any).type),
      ).catch(() => {});
      this.inAppNotifications.create({
        userId: dto.assigneeId,
        title: `Вам назначена заявка ${(req as any).number}`,
        body: (req as any).name,
        requestId: id,
      }).catch(() => {});
    }
    // Not `return saved` — after nulling assignee/contractor/customer/report above so the FK
    // scalar wins on save (see comment above), TypeORM's save() re-syncs those *relation*
    // properties (and, with them, the scalar id getters) back to the nulled state on the
    // in-memory object it hands back — the DB row is correct, but `saved` itself would report
    // e.g. assigneeId: null right after a successful reassignment. Fetch fresh instead.
    return this.findOne(id);
  }

  // Powers the Telegram bot's "Активные" list (and the personal morning digest) — own assigned
  // requests plus, for a contractor login (see ContractorsService.upsertLinkedUser), requests
  // assigned to the matching contractor record. Ordered overdue-first, then by priority, so the
  // bot's list leads with what actually needs attention rather than plain creation order.
  async findActiveForTelegram(userId: number, email: string): Promise<{ id: number; number: string; name: string; status: string; type: string; priority: string; plannedDate: string | null }[]> {
    return this.dataSource.query(`
      SELECT id, number, name, status, type, priority, "plannedDate" FROM (
        SELECT r.id, r.number, r.name, r.status, r.type, r.priority, r."plannedDate", r."createdAt"
        FROM requests r
        WHERE r."assigneeId" = $1 AND r.status NOT IN ('done', 'rejected', 'cancelled')
        UNION
        SELECT r.id, r.number, r.name, r.status, r.type, r.priority, r."plannedDate", r."createdAt"
        FROM requests r JOIN contractors c ON c.id = r."contractorId"
        WHERE c.email = $2 AND r.status NOT IN ('done', 'rejected', 'cancelled')
      ) t
      ORDER BY
        (t."plannedDate" IS NOT NULL AND t."plannedDate" < CURRENT_DATE) DESC,
        CASE t.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
        t."plannedDate" ASC NULLS LAST,
        t."createdAt" DESC
    `, [userId, email]);
  }

  // Executor's own "recently completed" — mirrors findActiveForTelegram's assignee/contractor
  // union, just filtered to status='done' and ordered by closedAt instead.
  async findDoneForTelegram(userId: number, email: string): Promise<{ id: number; number: string; name: string; status: string }[]> {
    return this.dataSource.query(`
      SELECT id, number, name, status FROM (
        SELECT r.id, r.number, r.name, r.status, r."closedAt"
        FROM requests r WHERE r."assigneeId" = $1 AND r.status = 'done'
        UNION
        SELECT r.id, r.number, r.name, r.status, r."closedAt"
        FROM requests r JOIN contractors c ON c.id = r."contractorId"
        WHERE c.email = $2 AND r.status = 'done'
      ) t ORDER BY "closedAt" DESC LIMIT 10
    `, [userId, email]);
  }

  // Same predicate EscalationService.checkSlaBreaches() uses for SLA-breach emails, kept here as
  // its own copy rather than a shared extraction — the two call sites want different SELECTs
  // (email escalation joins to the admin/manager recipient; this one needs assignee display name
  // for the bot's "🔥 Просрочено" screen) and touching the already-working escalation query isn't
  // worth the risk for this feature. `filter` narrows to one person's own overdue requests
  // (executor); omitted, it returns everyone's (admin).
  async findOverdueForTelegram(filter?: { userId: number; email: string }): Promise<{
    id: number; number: string; name: string; status: string; priority: string; plannedDate: string;
    assigneeName: string | null; overdueDays: number;
  }[]> {
    const params: any[] = [];
    let scopeClause = '';
    if (filter) {
      scopeClause = `AND (r."assigneeId" = $1 OR r."contractorId" IN (SELECT id FROM contractors WHERE email = $2))`;
      params.push(filter.userId, filter.email);
    }
    return this.dataSource.query(`
      SELECT r.id, r.number, r.name, r.status, r.priority, r."plannedDate",
        COALESCE(con.name, u2."fullName") AS "assigneeName",
        DATE_PART('day', NOW() - r."plannedDate"::timestamp)::int AS "overdueDays"
      FROM requests r
      LEFT JOIN contractors con ON con.id = r."contractorId"
      LEFT JOIN users u2 ON u2.id = r."assigneeId"
      WHERE r."plannedDate" < CURRENT_DATE
        AND r.status NOT IN ('done', 'rejected', 'cancelled', 'waiting_customer')
        ${scopeClause}
      ORDER BY r."plannedDate" ASC
      LIMIT 100
    `, params);
  }

  // Single request's full detail for the Telegram bot's card screen — same shape serves all
  // three roles (executor/customer/admin each render a different subset of these fields), so
  // there's one query to keep in sync instead of three near-duplicates.
  async getRequestDetailForTelegram(id: number): Promise<{
    id: number; number: string; name: string; status: string; type: string; priority: string;
    plannedDate: string | null; overdueDays: number;
    assigneeId: number | null; contractorId: number | null; customerId: number | null;
    assigneeName: string | null; customerDept: string | null;
    lastComment: { authorName: string; text: string } | null;
  } | null> {
    const rows = await this.dataSource.query(`
      SELECT r.id, r.number, r.name, r.status, r.type, r.priority, r."plannedDate",
        r."assigneeId", r."contractorId", r."customerId",
        COALESCE(con.name, u2."fullName") AS "assigneeName",
        c.department AS "customerDept",
        GREATEST(COALESCE(DATE_PART('day', NOW() - r."plannedDate"::timestamp), 0), 0)::int AS "overdueDays"
      FROM requests r
      LEFT JOIN contractors con ON con.id = r."contractorId"
      LEFT JOIN users u2 ON u2.id = r."assigneeId"
      LEFT JOIN customers c ON c.id = r."customerId"
      WHERE r.id = $1
    `, [id]);
    if (!rows.length) return null;
    const commentRows = await this.dataSource.query(`
      SELECT a.details AS text, u."fullName" AS "authorName"
      FROM activities a LEFT JOIN users u ON u.id = a."authorId"
      WHERE a."requestId" = $1 AND a.action = 'Комментарий'
      ORDER BY a."createdAt" DESC LIMIT 1
    `, [id]);
    return { ...rows[0], lastComment: commentRows[0] ? { authorName: commentRows[0].authorName, text: commentRows[0].text } : null };
  }

  // Customer/portal-side counterpart — read-only status tracking, no action buttons, so no
  // "type" needed. Includes the same request whichever status (not just active) capped at 15
  // most recent, active-first, so a customer can also see their most recently closed ones.
  async findForCustomerTelegram(customerId: number): Promise<{ id: number; number: string; name: string; status: string }[]> {
    return this.dataSource.query(`
      SELECT id, number, name, status FROM requests
      WHERE "customerId" = $1
      ORDER BY (status IN ('done', 'rejected', 'cancelled')) ASC, "createdAt" DESC
      LIMIT 15
    `, [customerId]);
  }

  // Admin overview — "что сейчас в работе / что выполнено", intentionally just counts + a short
  // capped list (not the full analytics module — that's a separate, later request).
  async getAdminTelegramOverview(): Promise<{
    active: { id: number; number: string; name: string; status: string; priority: string; plannedDate: string | null }[]; activeTotal: number;
    doneRecent: { id: number; number: string; name: string }[]; doneTotal: number;
    overdueTotal: number;
  }> {
    const [active, [{ activeTotal }], doneRecent, [{ doneTotal }], overdue] = await Promise.all([
      this.dataSource.query(`
        SELECT id, number, name, status, priority, "plannedDate" FROM requests
        WHERE status NOT IN ('done', 'rejected', 'cancelled')
        ORDER BY "plannedDate" ASC NULLS LAST, "createdAt" DESC LIMIT 15
      `),
      this.dataSource.query(`SELECT COUNT(*)::int AS "activeTotal" FROM requests WHERE status NOT IN ('done', 'rejected', 'cancelled')`),
      this.dataSource.query(`
        SELECT id, number, name FROM requests
        WHERE status = 'done' AND "closedAt" >= NOW() - INTERVAL '7 days'
        ORDER BY "closedAt" DESC LIMIT 15
      `),
      this.dataSource.query(`SELECT COUNT(*)::int AS "doneTotal" FROM requests WHERE status = 'done' AND "closedAt" >= NOW() - INTERVAL '7 days'`),
      this.findOverdueForTelegram(),
    ]);
    return { active, activeTotal, doneRecent, doneTotal, overdueTotal: overdue.length };
  }

  // One-off backfill: sends the assignee-notification email for every currently-open
  // request that already has an assigneeId, to cover assignments made before the
  // notifyContractorAssigned-on-assigneeId fix existed. Safe to call more than once —
  // recipients just get the email again, nothing is tracked/deduped server-side.
  async backfillAssigneeNotifications(): Promise<{ sent: number; skippedNoEmail: number; details: any[] }> {
    const appUrl = getAppUrl();
    const rows = await this.dataSource.query(`
      SELECT r.id, r.number, r.name, r."plannedDate", r.description,
        u."fullName" AS "assigneeName", u.email AS "assigneeEmail",
        c.department AS "customerDept"
      FROM requests r
      JOIN users u ON u.id = r."assigneeId"
      LEFT JOIN customers c ON c.id = r."customerId"
      WHERE r."assigneeId" IS NOT NULL
        AND r.status NOT IN ('done', 'rejected', 'cancelled')
      ORDER BY r."createdAt" ASC
    `);

    let sent = 0;
    let skippedNoEmail = 0;
    const details: any[] = [];
    for (const row of rows) {
      if (!row.assigneeEmail) {
        skippedNoEmail++;
        details.push({ number: row.number, assignee: row.assigneeName, status: 'skipped — нет email' });
        continue;
      }
      await this.notifications.notifyContractorAssigned({
        to: row.assigneeEmail,
        toName: row.assigneeName,
        requestNumber: row.number,
        requestName: row.name,
        customerDepartment: row.customerDept || '',
        plannedDate: row.plannedDate,
        description: row.description,
        requestUrl: `${appUrl}/requests/${row.number}`,
      }).catch(() => {});
      sent++;
      details.push({ number: row.number, assignee: row.assigneeName, to: row.assigneeEmail, status: 'отправлено' });
    }
    return { sent, skippedNoEmail, details };
  }

  async changeStatus(
    id: number, newStatus: RequestStatus, userId: number,
    comment?: string, closeReason?: string, userRole?: string,
  ) {
    const req = await this.requestsRepo.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Заявка не найдена');

    // Заказчик работает по статусам только через выделенные сценарии на портале — не через
    // общий переход по статусам, который остаётся за исполнителем/админом: принять/вернуть на
    // доработку выполненную заявку, возобновить работу после ответа на вопрос команды, или сразу
    // закрыть заявку как выполненную из "Ожидание заказчика" (иногда сам ответ/уточнение и есть
    // весь результат — например, разъяснение методологии расчёта, исполнителю дальше нечего
    // делать) или из "На проверке" (заявитель подтверждает, что результат его устраивает — по
    // сути то же самое действие, что и "Принять" на уже переведённой в done заявке, просто на
    // шаг раньше, чтобы не заставлять исполнителя формально закрывать то, что заказчик уже видел
    // и одобрил).
    if (userRole === 'customer') {
      const isReturnToRework = newStatus === RequestStatus.REWORK && req.status === RequestStatus.DONE;
      const isResumeAfterAnswer = newStatus === RequestStatus.IN_PROGRESS && req.status === RequestStatus.WAITING_CUSTOMER;
      const isCloseAsDone = newStatus === RequestStatus.DONE
        && [RequestStatus.WAITING_CUSTOMER, RequestStatus.REVIEW].includes(req.status);
      if (!isReturnToRework && !isResumeAfterAnswer && !isCloseAsDone) {
        throw new ForbiddenException('Заказчик может только вернуть выполненную заявку на доработку, возобновить работу после ответа на вопрос или закрыть её как выполненную');
      }
      if (isReturnToRework && !comment?.trim()) {
        throw new ForbiddenException('Укажите причину возврата на доработку');
      }
      if (isResumeAfterAnswer && !comment?.trim()) {
        throw new ForbiddenException('Укажите ваш ответ команде');
      }
    }

    const transitions = req.type === RequestType.BUGFIX ? BUG_TRANSITIONS : STATUS_TRANSITIONS;
    const allowed = transitions[req.status];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(`Переход из ${req.status} в ${newStatus} недопустим`);
    }


    // Для "Разработка" и "Доработка" при переходе в "done" (Сопровождение) — публикуем/версионируем отчёт
    if (newStatus === RequestStatus.DONE && [RequestType.DEVELOPMENT, RequestType.IMPROVEMENT].includes(req.type)) {
      const fullReq = await this.requestsRepo.findOne({
        where: { id },
        relations: ['customer', 'assignee', 'contractor'],
      });
      if (fullReq) {
        const executor = (fullReq as any).contractor?.name || fullReq.assignee?.fullName || '';
        if (!fullReq.reportId) {
          const inserted = await this.dataSource.query(`
            INSERT INTO reports_ref (name, owner, "techOwner", description, status, environment, version, "requestId", "publishedAt", "billingCompanyId")
            VALUES ($1, $2, $3, $4, 'active', 'prod', '1.0', $5, NOW(), $6)
            RETURNING id
          `, [
            fullReq.name,
            fullReq.customer?.department || '',
            executor,
            fullReq.description || '',
            fullReq.id,
            (fullReq as any).billingCompanyId ?? null,
          ]);
          if (inserted.length > 0) {
            const reportId = inserted[0].id;
            await this.requestsRepo.update(id, { reportId });
            // `req` was loaded before this update — keep it in sync, otherwise the
            // `this.requestsRepo.save(req)` further down overwrites reportId back to NULL.
            req.reportId = reportId;
            await this.dataSource.query(`
              INSERT INTO report_versions ("reportId", "requestId", version, "changeSummary")
              VALUES ($1, $2, '1.0', $3)
            `, [reportId, fullReq.id, `Дашборд создан по заявке ${fullReq.number}`]);
          }
        } else {
          const verRows = await this.dataSource.query(
            `SELECT version FROM reports_ref WHERE id = $1`, [fullReq.reportId],
          );
          const nextVersion = (((parseFloat(verRows[0]?.version) || 1.0)) + 0.1).toFixed(1);
          // Only fills in the dashboard's billing company if it doesn't already have one — an
          // established dashboard's classification is authoritative, a later improvement request
          // shouldn't silently reclassify it.
          await this.dataSource.query(`
            UPDATE reports_ref
            SET status = 'active', "publishedAt" = NOW(), "requestId" = $1, version = $2,
              "billingCompanyId" = COALESCE("billingCompanyId", $4)
            WHERE id = $3
          `, [id, nextVersion, fullReq.reportId, (fullReq as any).billingCompanyId ?? null]);
          await this.dataSource.query(`
            INSERT INTO report_versions ("reportId", "requestId", version, "changeSummary")
            VALUES ($1, $2, $3, $4)
          `, [fullReq.reportId, fullReq.id, nextVersion, fullReq.description || `Доработка по заявке ${fullReq.number}`]);
        }
      }
    }

    // Auto-set plannedDate from SLA dictionary when request enters active work phase
    if (!req.plannedDate && [RequestStatus.QUEUED, RequestStatus.IN_PROGRESS].includes(newStatus)) {
      const slaRows = await this.dataSource.query(
        `SELECT value FROM dictionaries WHERE type = 'sla_days' AND code = $1 AND "isActive" = true LIMIT 1`,
        [req.priority],
      );
      if (slaRows.length > 0) {
        const days = parseInt(slaRows[0].value, 10);
        const d = new Date();
        d.setDate(d.getDate() + days);
        req.plannedDate = d.toISOString().split('T')[0];
      }
    }

    const prevStatus = req.status;
    req.status = newStatus;

    // WAITING_CUSTOMER: start/stop timer — SLA paused while waiting
    if (newStatus === RequestStatus.WAITING_CUSTOMER) {
      req.waitingForCustomerSince = new Date();
    } else if (prevStatus === RequestStatus.WAITING_CUSTOMER && req.waitingForCustomerSince) {
      const secondsWaited = Math.round((Date.now() - new Date(req.waitingForCustomerSince).getTime()) / 1000);
      req.waitingForCustomerSeconds = (req.waitingForCustomerSeconds || 0) + secondsWaited;
      req.waitingForCustomerSince = null as any;
      // Extend plannedDate by the time we were waiting
      if (req.plannedDate) {
        const planned = new Date(req.plannedDate);
        planned.setSeconds(planned.getSeconds() + secondsWaited);
        req.plannedDate = planned.toISOString().split('T')[0];
      }
    }

    const CLOSED_STATUSES = [RequestStatus.DONE, RequestStatus.REJECTED, RequestStatus.CANCELLED];
    if (CLOSED_STATUSES.includes(newStatus)) {
      req.closedAt = new Date();
      if (closeReason) req.closeReason = closeReason;
    } else if (CLOSED_STATUSES.includes(prevStatus as RequestStatus)) {
      req.closedAt = null as any;
      req.closeReason = null as any;
    }
    await this.requestsRepo.save(req);

    await this.activitiesRepo.save(
      this.activitiesRepo.create({
        requestId: id,
        authorId: userId,
        action: `Статус изменён: ${STATUS_LABELS[prevStatus] || prevStatus} → ${STATUS_LABELS[newStatus] || newStatus}`,
        details: comment,
      }),
    );
    const result = await this.findOne(id);
    const appUrl = getAppUrl();
    const notifyParams = {
      requestNumber: (result as any).number,
      requestName: (result as any).name,
      prevStatus,
      newStatus,
      comment,
      closeReason,
      requestUrl: `${appUrl}/portal/requests/${(result as any).number}`,
    };

    const initiator = (result as any).createdBy;
    const customer = (result as any).customer;
    // "Заявитель другой" (см. RequestsService.create) — заявка оформлена сотрудником за
    // коллегу, который позвонил/попросил. Все адресованные "заявителю" уведомления идут этому
    // человеку, а не тому, кто физически заполнил форму. У него, как правило, нет учётки в
    // системе (это произвольный сотрудник из HR-справочника), поэтому только email — ни
    // in-app-уведомления, ни Telegram-DM ему отправить нечем (нет userId/chatId).
    const onBehalfEmail = (result as any).onBehalfOfEmail as string | undefined;
    const onBehalfName = (result as any).onBehalfOfName as string | undefined;
    const notifyInitiatorEmail = onBehalfEmail || initiator?.email;
    const notifyInitiatorName = onBehalfEmail ? onBehalfName : initiator?.fullName;

    // При переходе в DONE сначала создаём токен опроса, чтобы вложить ссылку в письмо
    let surveyUrl: string | undefined;
    if (newStatus === RequestStatus.DONE) {
      try {
        const ratingRecord = await this.ratingsService.createForRequest(id);
        if (!ratingRecord.submittedAt) {
          surveyUrl = `${appUrl}/survey/${ratingRecord.token}`;
          // Отдельное письмо с опросом на email Customer entity (если отличается от инициатора)
          if (customer?.email && customer.email !== notifyInitiatorEmail) {
            this.notifications.notifyRatingRequest({
              to: customer.email,
              toName: customer.responsible || customer.department || 'Заказчик',
              requestNumber: notifyParams.requestNumber,
              requestName: notifyParams.requestName,
              requestUrl: surveyUrl,
            }).catch(() => {});
          }
        }
      } catch (_) {}
    }

    // Уведомить инициатора / указанного "другого" заявителя (при DONE добавляем кнопку "Оценить")
    if (notifyInitiatorEmail) {
      this.notifications.notifyStatusChanged({
        to: notifyInitiatorEmail, toName: notifyInitiatorName, ...notifyParams, surveyUrl,
      }).catch(() => {});
    }

    // Уведомить заказчика об изменении статуса (если не DONE и есть email)
    if (newStatus !== RequestStatus.DONE && customer?.email && customer.email !== notifyInitiatorEmail) {
      this.notifications.notifyStatusChanged({
        to: customer.email,
        toName: customer.responsible || customer.department || 'Заказчик',
        ...notifyParams,
      }).catch(() => {});
    }

    // In-app и Telegram — только для реального инициатора-пользователя системы; когда заявитель
    // "другой" (onBehalfEmail задан), у него нет ни userId, ни telegramChatId, только email выше.
    if (!onBehalfEmail && initiator?.id && initiator.id !== userId) {
      const newLabel = STATUS_LABELS[newStatus] || newStatus;
      this.inAppNotifications.create({
        userId: initiator.id,
        title: `Статус заявки ${notifyParams.requestNumber} изменён на «${newLabel}»`,
        body: notifyParams.requestName,
        requestId: id,
      }).catch(() => {});
    }

    // Telegram-уведомление заявителю (обычно это и есть заказчик — он же оформил заявку через
    // портал) — параллельно email выше, read-only (без кнопок смены статуса: заказчик не
    // управляет статусом, только следит).
    if (!onBehalfEmail && initiator?.id && initiator.id !== userId) {
      this.telegram.sendToUser(
        initiator.id,
        customerStatusMessage({
          number: notifyParams.requestNumber, name: notifyParams.requestName,
          newStatus, requestUrl: notifyParams.requestUrl,
        }),
      ).catch(() => {});
    }

    // Telegram-уведомление исполнителю о смене статуса — раньше он не уведомлялся вообще
    // (только инициатор/заказчик по email); не шлём, если статус меняет он же сам.
    const assignee = (result as any).assignee;
    if (assignee?.id && assignee.id !== userId) {
      this.telegram.sendToUser(
        assignee.id,
        statusChangedMessage({
          number: notifyParams.requestNumber, name: notifyParams.requestName,
          newStatus, requestUrl: `${appUrl}/requests/${(req as any).number}`,
        }),
        buildQuickActions(id, newStatus, (result as any).type),
      ).catch(() => {});
    }

    return result;
  }

  // Manual re-send of the CSI survey link for a DONE request that hasn't been rated yet — the
  // original link goes out automatically on the DONE transition (see changeStatus above), but
  // customers routinely miss/archive it, and there was no way to nudge them again short of a
  // DB-level resend. Reuses the exact same recipient resolution and email templates as the
  // original send so a reminder looks like a natural repeat, not a different flow.
  async remindRating(id: number, userId: number) {
    const req = await this.requestsRepo.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Заявка не найдена');
    if (req.status !== RequestStatus.DONE) {
      throw new BadRequestException('Напомнить об оценке можно только для выполненной заявки');
    }

    const rating = await this.ratingsService.createForRequest(id);
    if (rating.submittedAt) {
      throw new BadRequestException('Заказчик уже оставил оценку по этой заявке');
    }

    const result = await this.findOne(id);
    const appUrl = getAppUrl();
    const surveyUrl = `${appUrl}/survey/${rating.token}`;

    const initiator = (result as any).createdBy;
    const customer = (result as any).customer;
    const onBehalfEmail = (result as any).onBehalfOfEmail as string | undefined;
    const onBehalfName = (result as any).onBehalfOfName as string | undefined;
    const notifyInitiatorEmail = onBehalfEmail || initiator?.email;
    const notifyInitiatorName = onBehalfEmail ? onBehalfName : initiator?.fullName;

    const sentTo: string[] = [];
    if (notifyInitiatorEmail) {
      this.notifications.notifyRatingRequest({
        to: notifyInitiatorEmail,
        toName: notifyInitiatorName || 'Заказчик',
        requestNumber: (result as any).number,
        requestName: (result as any).name,
        requestUrl: surveyUrl,
        reminder: true,
      }).catch(() => {});
      sentTo.push(notifyInitiatorEmail);
    }
    if (customer?.email && customer.email !== notifyInitiatorEmail) {
      this.notifications.notifyRatingRequest({
        to: customer.email,
        toName: customer.responsible || customer.department || 'Заказчик',
        requestNumber: (result as any).number,
        requestName: (result as any).name,
        requestUrl: surveyUrl,
        reminder: true,
      }).catch(() => {});
      sentTo.push(customer.email);
    }

    if (!sentTo.length) {
      throw new BadRequestException('Не указан email заявителя — укажите email, чтобы отправить напоминание');
    }

    await this.activitiesRepo.save(
      this.activitiesRepo.create({
        requestId: id,
        authorId: userId,
        action: `Напоминание об оценке отправлено на ${sentTo.join(', ')}`,
      }),
    );

    return { sentTo };
  }

  async batchUpdate(ids: number[], action: string, payload: any, userId: number) {
    const results = await Promise.allSettled(
      ids.map(id => {
        if (action === 'assign_contractor') {
          return this.update(id, { contractorId: payload.contractorId ?? null }, userId);
        }
        if (action === 'assign_assignee') {
          return this.update(id, { assigneeId: payload.assigneeId ?? null }, userId);
        }
        if (action === 'change_status') {
          return this.changeStatus(id, payload.status, userId, payload.comment, payload.closeReason);
        }
        return Promise.reject(new Error('Unknown action'));
      }),
    );
    const success = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    return { success, failed, total: ids.length };
  }

  async addComment(id: number, text: string, userId: number) {
    const activity = this.activitiesRepo.create({
      requestId: id, authorId: userId, action: 'Комментарий', details: text,
    });
    const saved = await this.activitiesRepo.save(activity);

    // Notify assignee/contractor when someone else adds a comment
    const req = await this.requestsRepo.findOne({
      where: { id },
      relations: ['assignee', 'contractor', 'createdBy'],
    });
    if (req) {
      const reqNum = (req as any).number;
      const reqName = (req as any).name;
      const appUrl = getAppUrl();
      const requestUrl = `${appUrl}/requests/${reqNum}`;
      // Look up commenter's name for the notification
      const authorRows = await this.dataSource.query(
        'SELECT "fullName" FROM users WHERE id = $1 LIMIT 1', [userId],
      );
      const authorName = authorRows[0]?.fullName || 'Пользователь';

      // In-app + email for internal assignee
      const assignee = (req as any).assignee;
      if (assignee?.id && assignee.id !== userId) {
        this.inAppNotifications.create({
          userId: assignee.id,
          title: `Новый комментарий к заявке ${reqNum}`,
          body: text.slice(0, 120),
          requestId: id,
        }).catch(() => {});
        if (assignee.email) {
          this.notifications.notifyNewComment({
            to: assignee.email, toName: assignee.fullName,
            requestNumber: reqNum, requestName: reqName,
            commentText: text, authorName, requestUrl,
          }).catch(() => {});
        }
        this.telegram.sendToUser(
          assignee.id,
          commentMessage({ number: reqNum, name: reqName, authorName, text, requestUrl }),
        ).catch(() => {});
      }
      // Email + Telegram for external contractor
      const contractor = (req as any).contractor;
      if (contractor?.email) {
        this.notifications.notifyNewComment({
          to: contractor.email, toName: contractor.name,
          requestNumber: reqNum, requestName: reqName,
          commentText: text, authorName, requestUrl,
        }).catch(() => {});
        // Contractor logins are regular executor accounts linked by email — resolve for the DM.
        this.dataSource.query('SELECT id FROM users WHERE email = $1 AND "isActive" = true', [contractor.email])
          .then((userRows) => {
            if (userRows[0]?.id) {
              this.telegram.sendToUser(
                userRows[0].id,
                commentMessage({ number: reqNum, name: reqName, authorName, text, requestUrl }),
              );
            }
          }).catch(() => {});
      }
    }

    return saved;
  }

  async saveArtifact(requestId: number, file: Express.Multer.File, userId: number, artifactType?: string) {
    // "grif" and "requirements" are single-slot: the UI shows one card with a
    // "Заменить" button, so a new upload must replace (not accumulate alongside)
    // any existing artifact of that type for this request — otherwise the old
    // (possibly broken) file keeps winning the `.find()` lookup on the frontend.
    const singleSlotTypes: string[] = [ArtifactType.GRIF, ArtifactType.REQUIREMENTS];
    if (artifactType && singleSlotTypes.includes(artifactType)) {
      const existing = await this.artifactsRepo.find({ where: { requestId, artifactType: artifactType as ArtifactType } });
      for (const old of existing) {
        await this.deleteArtifact(old.id);
      }
    }

    const artifact = this.artifactsRepo.create({
      requestId,
      // multer/busboy decode multipart filename headers as latin1 even when the browser sent
      // UTF-8 (no charset is declared in Content-Disposition) — re-decode to fix Cyrillic/etc.
      // filenames coming through as mojibake (e.g. "ÐÑÐµÐ´..." instead of "Предложения...").
      originalFilename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      storedFilename: file.filename,
      mimeType: file.mimetype,
      size: file.size,
      uploadedById: userId,
      artifactType: (artifactType as ArtifactType) || ArtifactType.OTHER,
    });
    return this.artifactsRepo.save(artifact);
  }

  async exportToExcel(filters: {
    status?: string; priority?: string; search?: string;
    assigneeId?: number; contractorId?: number; customerId?: number;
    userId?: number; userRole?: string; userEmail?: string;
  }): Promise<Buffer> {
    // exportToExcel never paginates, so findAll always returns the plain-array branch here.
    const requests = await this.findAll(filters) as BiRequest[];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Заявки');

    ws.columns = [
      { header: '№ Заявки', key: 'number', width: 15 },
      { header: 'Наименование', key: 'name', width: 45 },
      { header: 'Тип работ', key: 'type', width: 18 },
      { header: 'Статус', key: 'status', width: 18 },
      { header: 'Приоритет', key: 'priority', width: 14 },
      { header: 'Заказчик', key: 'customer', width: 28 },
      { header: 'Исполнитель', key: 'assignee', width: 25 },
      { header: 'Дата создания', key: 'createdAt', width: 14 },
      { header: 'Плановый срок', key: 'plannedDate', width: 14 },
      { header: 'Плановые часы', key: 'plannedHours', width: 14 },
      { header: 'Описание', key: 'description', width: 50 },
    ];

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };

    for (const r of requests) {
      ws.addRow({
        number: r.number,
        name: r.name,
        type: TYPE_LABELS[r.type] || r.type,
        status: STATUS_LABELS[r.status] || r.status,
        priority: PRIORITY_LABELS[r.priority] || r.priority,
        customer: (r as any).customer?.department || '',
        assignee: (r as any).contractor?.name || (r as any).assignee?.fullName || '',
        createdAt: r.createdAt ? new Date(r.createdAt).toLocaleDateString('ru-RU') : '',
        plannedDate: r.plannedDate || '',
        plannedHours: r.plannedHours || '',
        description: r.description || '',
      });
    }

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  async remove(id: number) {
    const req = await this.requestsRepo.findOne({ where: { id }, relations: ['artifacts'] });
    if (!req) throw new NotFoundException('Заявка не найдена');
    const fs = await import('fs/promises');
    const path = await import('path');
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    for (const a of req.artifacts || []) {
      try { await fs.unlink(path.join(uploadDir, a.storedFilename)); } catch {}
    }
    // request_ratings.requestId is a plain column, not a real FK relation (see the entity) — no
    // cascade cleans it up on its own. Found via a real bug: a deleted request's leftover rating
    // row kept counting toward "Оценено X/Y" while vanishing from every table that joins
    // requests, making the KPI silently disagree with the tables under it.
    await this.dataSource.query(`DELETE FROM request_ratings WHERE "requestId" = $1`, [id]);
    await this.requestsRepo.delete(id);
    return { success: true };
  }

  async deleteArtifact(id: number) {
    const artifact = await this.artifactsRepo.findOne({ where: { id } });
    if (!artifact) throw new NotFoundException();
    const fs = await import('fs/promises');
    const path = await import('path');
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    try {
      await fs.unlink(path.join(uploadDir, artifact.storedFilename));
    } catch { /* file might already be gone */ }
    await this.artifactsRepo.delete(id);
  }

  async acceptByCustomer(id: number, userId: number) {
    const req = await this.requestsRepo.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Заявка не найдена');
    req.acceptedByCustomerAt = new Date();
    await this.requestsRepo.save(req);
    await this.activitiesRepo.save(
      this.activitiesRepo.create({
        requestId: id, authorId: userId,
        action: 'Заявка принята заказчиком',
        details: 'Заказчик подтвердил приёмку результата',
      }),
    );
    return { success: true, acceptedAt: req.acceptedByCustomerAt };
  }

  async findSimilar(query: string, type?: string) {
    if (!query || query.trim().length < 3) return [];
    const words = query.trim().split(/\s+/).filter(w => w.length >= 3);
    if (!words.length) return [];
    // Indexed full-text search (websearch_to_tsquery tolerates arbitrary user input — no
    // manual escaping needed) with an ILIKE fallback for short/partial tokens (e.g. numbers).
    const params: any[] = [query.trim(), `%${query.trim()}%`];
    const typeCondition = type ? `AND type = $${params.push(type)}` : '';
    const searchVector = SEARCH_VECTOR_SQL('requests');
    const rows = await this.dataSource.query(`
      SELECT id, number, name, status, type, priority, "createdAt",
        ts_rank(${searchVector}, websearch_to_tsquery('russian', $1)) AS rank
      FROM requests
      WHERE (
        ${searchVector} @@ websearch_to_tsquery('russian', $1)
        OR name ILIKE $2
        OR number ILIKE $2
      )
      ${typeCondition}
      AND status NOT IN ('done', 'rejected', 'cancelled')
      ORDER BY rank DESC, "createdAt" DESC
      LIMIT 5
    `, params);
    return rows;
  }
}
