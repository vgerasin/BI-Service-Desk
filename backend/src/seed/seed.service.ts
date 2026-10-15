import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { CustomersService } from '../customers/customers.service';
import { ContractorsService } from '../contractors/contractors.service';
import { DictionariesService } from '../dictionaries/dictionaries.service';
import { DataSourcesService } from '../data-sources/data-sources.service';
import { DataSourceType, DbEngine } from '../data-sources/data-source.entity';
import { ReportsRefService } from '../reports-ref/reports-ref.service';
import { RequestsService } from '../requests/requests.service';
import { RequestType, Priority, RequestStatus } from '../requests/request.entity';
import { TimeEntriesService } from '../time-entries/time-entries.service';
import { RatingsService } from '../ratings/ratings.service';
import { KnownErrorsService } from '../known-errors/known-errors.service';
import { KnownErrorStatus } from '../known-errors/known-error.entity';

const MARKER = 'Ромашка';

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

/**
 * Realistic fixture data for manual QA / demo purposes. Idempotent — bails out early if it
 * detects it already ran (looks for the "Ромашка" customer), so it's safe to call more than once.
 * Shared by the standalone `src/seed.ts` script and the (secret-gated) `/admin/seed` HTTP endpoint.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly users: UsersService,
    private readonly customersSvc: CustomersService,
    private readonly contractorsSvc: ContractorsService,
    private readonly dictionaries: DictionariesService,
    private readonly dataSourcesSvc: DataSourcesService,
    private readonly reportsRefSvc: ReportsRefService,
    private readonly requestsSvc: RequestsService,
    private readonly timeEntriesSvc: TimeEntriesService,
    private readonly ratingsSvc: RatingsService,
    private readonly knownErrorsSvc: KnownErrorsService,
  ) {}

  async run() {
    const credentials: Array<{ role: string; email: string; password: string }> = [];

    await this.dictionaries.seedDefaults();
    await this.users.seedAdmin();

    const existingCustomers = await this.customersSvc.findAll();
    if (existingCustomers.some((c: any) => c.department.includes(MARKER))) {
      const msg = `Похоже, сиды уже применялись (найден заказчик с «${MARKER}»). Пропускаю, чтобы не задублировать данные.`;
      this.logger.warn(msg);
      return { skipped: true, message: msg };
    }

    // ── 1. Люди: исполнители и второй админ ──────────────────────────────
    const exec1 = await this.users.create({
      fullName: 'Иванова Анна Сергеевна', email: 'ivanova@bi.local',
      password: 'Executor123!', role: UserRole.EXECUTOR, position: 'BI-разработчик',
    });
    const exec2 = await this.users.create({
      fullName: 'Смирнов Дмитрий Олегович', email: 'smirnov@bi.local',
      password: 'Executor123!', role: UserRole.EXECUTOR, position: 'BI-разработчик',
    });
    const exec3 = await this.users.create({
      fullName: 'Петрова Ольга Викторовна', email: 'petrova@bi.local',
      password: 'Executor123!', role: UserRole.EXECUTOR, position: 'Аналитик данных',
    });
    const admin2 = await this.users.create({
      fullName: 'Кузнецов Игорь Павлович', email: 'kuznetsov@bi.local',
      password: 'Admin123!', role: UserRole.ADMIN, position: 'Руководитель группы BI',
    });
    credentials.push(
      { role: 'executor', email: 'ivanova@bi.local', password: 'Executor123!' },
      { role: 'executor', email: 'smirnov@bi.local', password: 'Executor123!' },
      { role: 'executor', email: 'petrova@bi.local', password: 'Executor123!' },
      { role: 'admin', email: 'kuznetsov@bi.local', password: 'Admin123!' },
    );

    await this.users.addRate({ userId: exec1.id, rate: 1800, currency: 'RUB', dateFrom: '2025-01-01' });
    await this.users.addRate({ userId: exec2.id, rate: 2000, currency: 'RUB', dateFrom: '2025-01-01' });
    await this.users.addRate({ userId: exec3.id, rate: 1700, currency: 'RUB', dateFrom: '2025-01-01' });

    // ── 2. Подрядчики ─────────────────────────────────────────────────────
    const contractor1 = await this.contractorsSvc.create({
      name: 'Фролов Максим Андреевич (ИП)', type: 'individual',
      email: 'frolov.contractor@example.com', currency: 'RUB', rate: 2200,
      contact: '+7 916 555-11-22',
    });
    await this.contractorsSvc.create({
      name: 'ООО «Дата Солюшнс»', type: 'organization',
      email: 'info@datasolutions.example', currency: 'RUB', rate: 2500,
      contact: '+7 495 777-88-99',
    });

    // ── 3. Заказчики + портальный доступ ────────────────────────────────
    const cust1 = await this.customersSvc.create({
      department: `ООО «${MARKER}» — Управление продаж`,
      responsible: 'Соколова Елена Игоревна', email: 'sokolova@romashka.example', phone: '+7 900 111-22-33',
    });
    const cust2 = await this.customersSvc.create({
      department: 'АО «СтройИнвест» — Финансовый департамент',
      responsible: 'Волков Артём Николаевич', email: 'volkov@stroyinvest.example', phone: '+7 900 222-33-44',
    });
    const cust3 = await this.customersSvc.create({
      department: 'ООО «ЛогистикПро» — Отдел логистики',
      responsible: 'Никитина Мария Андреевна', email: 'nikitina@logisticpro.example', phone: '+7 900 333-44-55',
    });
    const cust4 = await this.customersSvc.create({
      department: `ООО «${MARKER}» — HR-департамент`,
      responsible: 'Егоров Павел Викторович', email: 'egorov@romashka.example', phone: '+7 900 444-55-66',
    });

    const portal1 = await this.customersSvc.createPortalAccess(cust1.id);
    const portal3 = await this.customersSvc.createPortalAccess(cust3.id);
    credentials.push(
      { role: 'customer (portal)', email: portal1.email, password: portal1.password },
      { role: 'customer (portal)', email: portal3.email, password: portal3.password },
    );
    const portal1Info = await this.customersSvc.getPortalInfo(cust1.id);
    const portal3Info = await this.customersSvc.getPortalInfo(cust3.id);

    // ── 4. Источники данных ──────────────────────────────────────────────
    await this.dataSourcesSvc.create({
      code: 'DS-SALES', name: 'Хранилище продаж (DWH)', type: DataSourceType.DB, dbEngine: DbEngine.POSTGRESQL,
      dbServer: 'dwh.internal', dbName: 'sales_dwh', description: 'Основное хранилище данных по продажам',
    });
    const ds2 = await this.dataSourcesSvc.create({
      code: 'DS-1C', name: '1С:Бухгалтерия', type: DataSourceType.DB, dbEngine: DbEngine.MSSQL,
      dbServer: '1c-sql.internal', dbName: 'accounting', description: 'Финансовые данные из 1С',
    });
    await this.dataSourcesSvc.create({
      code: 'DS-CRM', name: 'CRM API', type: DataSourceType.API,
      url: 'https://crm.internal/api/v2', description: 'Данные по клиентам и сделкам',
    });
    await this.dataSourcesSvc.create({
      code: 'DS-WH', name: 'WMS склад (экспорт Excel)', type: DataSourceType.EXCEL,
      description: 'Еженедельная выгрузка остатков со склада',
    });

    // ── 5. Реестр отчётов (готовые дашборды, не связанные с текущими заявками) ─
    const report2 = await this.reportsRefSvc.create({
      name: 'Финансовый отчёт P&L', owner: cust2.department, techOwner: exec2.fullName, dataOwner: 'Финансовый департамент',
      pbiLink: 'https://app.powerbi.com/groups/me/reports/pnl-demo', workspace: 'Finance', environment: 'prod', version: '1.4',
      updateFrequency: 'Еженедельно, по понедельникам', slaRefreshHours: 8, hasRLS: true,
      targetAudience: 'Финансовый директор, CFO', userCount: 8, useCase: 'Управленческая отчётность P&L',
      description: 'Отчёт о прибылях и убытках по подразделениям', status: 'active',
      checklistDone: true, protocolSigned: true, publishedAt: new Date('2025-02-10'),
      dataSourceIds: [ds2.id],
    } as any);
    await this.reportsRefSvc.create({
      name: 'Складские остатки', owner: cust3.department, techOwner: exec3.fullName,
      environment: 'prod', version: '1.0', updateFrequency: 'Еженедельно', hasRLS: false,
      targetAudience: 'Логисты', userCount: 15, description: 'Остатки товаров по складам',
      status: 'active', checklistDone: true, protocolSigned: false, publishedAt: new Date('2025-05-15'),
      dataSourceIds: [],
    } as any);

    // ── 6. Known Errors ──────────────────────────────────────────────────
    await this.knownErrorsSvc.create({
      title: 'Неверный курс валют в отчётах Finance',
      symptoms: 'Суммы в USD/EUR отображаются с задержкой в 1 день',
      rootCause: 'Источник курсов ЦБ обновляется в 23:00, отчёт строится по расписанию в 22:00',
      workaround: 'Вручную обновить визуал через "Обновить сейчас" после 23:00',
      status: KnownErrorStatus.OPEN, priority: 'medium',
    }, admin2.id);
    await this.knownErrorsSvc.create({
      title: 'Дубли клиентов в CRM-выгрузке',
      symptoms: 'Один и тот же клиент считается дважды при разном регистре email',
      rootCause: 'CRM API не нормализует email при экспорте',
      workaround: 'Фильтр LOWER(email) в Power Query',
      status: KnownErrorStatus.RESOLVED, priority: 'low', resolvedAt: new Date('2025-04-01'),
    } as any, exec2.id);

    // ── 7. Заявки — весь спектр типов/статусов/приоритетов ──────────────
    const r1 = await this.requestsSvc.create({
      type: RequestType.DEVELOPMENT, name: 'Дашборд продаж по регионам',
      customerId: cust1.id, priority: Priority.HIGH, assigneeId: exec1.id,
      description: 'Новый дашборд для мониторинга динамики продаж, воронки и плана/факта по регионам',
      plannedHours: 40, targetAudience: 'Региональные менеджеры продаж',
      dataSources: 'Хранилище продаж (DWH), CRM API', refreshFrequency: 'Ежедневно, 06:00',
    }, exec1.id);
    await this.requestsSvc.changeStatus(r1.id, RequestStatus.QUEUED, admin2.id, 'Взято в работу, поставлено в очередь спринта');
    await this.requestsSvc.changeStatus(r1.id, RequestStatus.IN_PROGRESS, exec1.id, 'Начата разработка модели данных');
    await this.timeEntriesSvc.create({ requestId: r1.id, userId: exec1.id, date: daysFromNow(-14), hours: 8, workKind: 'modeling', workName: 'Моделирование данных' });
    await this.timeEntriesSvc.create({ requestId: r1.id, userId: exec1.id, date: daysFromNow(-12), hours: 12, workKind: 'etl', workName: 'ETL / подготовка данных' });
    await this.timeEntriesSvc.create({ requestId: r1.id, userId: exec1.id, date: daysFromNow(-9), hours: 10, workKind: 'visualization', workName: 'Визуализация' });
    await this.requestsSvc.changeStatus(r1.id, RequestStatus.REVIEW, exec1.id, 'Готово к проверке');
    await this.requestsSvc.changeStatus(r1.id, RequestStatus.REWORK, admin2.id, 'Не хватает разбивки по менеджерам, поправьте фильтры RLS');
    await this.requestsSvc.changeStatus(r1.id, RequestStatus.IN_PROGRESS, exec1.id, 'Принято в доработку');
    await this.timeEntriesSvc.create({ requestId: r1.id, userId: exec1.id, date: daysFromNow(-6), hours: 6, workKind: 'visualization', workName: 'Доработка RLS и фильтров' });
    await this.requestsSvc.changeStatus(r1.id, RequestStatus.REVIEW, exec1.id, 'Доработка выполнена, готово к повторной проверке');
    await this.requestsSvc.changeStatus(r1.id, RequestStatus.DONE, admin2.id, 'Замечаний нет, протокол приёмки подписан', undefined);
    const r1Done = await this.requestsSvc.findOne(r1.id);
    const salesReportId = (r1Done as any).reportId;

    const r2 = await this.requestsSvc.create({
      type: RequestType.BUGFIX, name: 'В дашборде продаж не работает фильтр по кварталу',
      customerId: cust1.id, priority: Priority.CRITICAL, assigneeId: exec2.id, reportId: salesReportId,
      description: 'При выборе Q3 2025 визуалы остаются пустыми',
      stepsToReproduce: 'Открыть дашборд → выбрать срез "Квартал" → Q3 2025',
      expectedBehavior: 'Показываются данные за Q3', actualBehavior: 'Все визуалы пустые',
      environment: 'Power BI Service, Chrome', impact: 'high', urgency: 'high', affectedUsers: 42,
    }, portal1Info.portalUserId!);
    await this.requestsSvc.changeStatus(r2.id, RequestStatus.IN_PROGRESS, exec2.id, 'Воспроизвёл, чиню связь дат в модели');
    await this.timeEntriesSvc.create({ requestId: r2.id, userId: exec2.id, date: daysFromNow(-2), hours: 2.5, workKind: 'etl', workName: 'Исправление связи по датам' });
    await this.requestsSvc.changeStatus(r2.id, RequestStatus.DONE, exec2.id, 'Починено, срез по кварталу работает корректно', undefined);

    const r4 = await this.requestsSvc.create({
      type: RequestType.IMPROVEMENT, name: 'Добавить сравнение с планом продаж', customerId: cust1.id,
      priority: Priority.MEDIUM, assigneeId: exec1.id, reportId: salesReportId,
      description: 'Нужен визуал план/факт с отклонением в % по каждому региону',
      targetAudience: 'Региональные менеджеры продаж',
    }, exec1.id);
    await this.requestsSvc.changeStatus(r4.id, RequestStatus.QUEUED, admin2.id);
    await this.requestsSvc.changeStatus(r4.id, RequestStatus.IN_PROGRESS, exec1.id, 'Добавляю таблицу плановых показателей');
    await this.timeEntriesSvc.create({ requestId: r4.id, userId: exec1.id, date: daysFromNow(-3), hours: 5, workKind: 'visualization', workName: 'Визуал план/факт' });
    await this.requestsSvc.changeStatus(r4.id, RequestStatus.REVIEW, exec1.id);
    await this.requestsSvc.changeStatus(r4.id, RequestStatus.DONE, admin2.id, 'Принято заказчиком', undefined);

    const r3 = await this.requestsSvc.create({
      type: RequestType.BUGFIX, name: 'Остатки на складе не обновляются вторые сутки', customerId: cust3.id,
      priority: Priority.CRITICAL, contractorId: contractor1.id, plannedDate: daysFromNow(-3),
      description: 'Плановое обновление данных не отработало, отчёт показывает старые остатки',
      stepsToReproduce: 'Открыть "Складские остатки" → сравнить с датой последнего обновления',
      expectedBehavior: 'Обновление каждый день в 05:00', actualBehavior: 'Последнее обновление — 3 дня назад',
      environment: 'Power BI Service', impact: 'high', urgency: 'high', affectedUsers: 15,
    }, portal3Info.portalUserId!);
    await this.requestsSvc.changeStatus(r3.id, RequestStatus.IN_PROGRESS, admin2.id, 'Передано подрядчику на диагностику шлюза данных');
    await this.timeEntriesSvc.create({ requestId: r3.id, contractorId: contractor1.id, date: daysFromNow(-1), hours: 3, workKind: 'etl', workName: 'Диагностика шлюза обновления данных' });

    const r5 = await this.requestsSvc.create({
      type: RequestType.DEVELOPMENT, name: 'Дашборд текучести персонала', customerId: cust4.id,
      priority: Priority.LOW, description: 'Отчёт по текучести и подбору персонала',
    }, admin2.id);
    await this.requestsSvc.changeStatus(r5.id, RequestStatus.CANCELLED, admin2.id, 'Заказчик отменил — решили закрыть потребность силами Excel', 'Отменено инициатором');

    const r6 = await this.requestsSvc.create({
      type: RequestType.BUGFIX, name: 'Не совпадают суммы в отчёте P&L и в 1С', customerId: cust2.id,
      priority: Priority.MEDIUM, reportId: report2.id,
      description: 'Расхождение в пределах 0.01% на нескольких статьях',
      stepsToReproduce: 'Сравнить итоговую строку отчёта с выгрузкой из 1С за март',
      expectedBehavior: 'Суммы совпадают', actualBehavior: 'Расхождение 0.01%',
      environment: 'Power BI Service', impact: 'low', urgency: 'low',
    }, admin2.id);
    await this.requestsSvc.changeStatus(r6.id, RequestStatus.REJECTED, admin2.id, 'Расхождение — эффект округления при конвертации валют, в пределах нормы', 'Не воспроизводится');

    const r7 = await this.requestsSvc.create({
      type: RequestType.CONSULTATION, name: 'Как настроить RLS для нового отдела', customerId: cust2.id,
      priority: Priority.LOW, assigneeId: exec3.id,
      description: 'Нужна консультация по настройке Row-Level Security под новый филиал',
    }, exec3.id);
    await this.requestsSvc.changeStatus(r7.id, RequestStatus.IN_PROGRESS, exec3.id);
    await this.timeEntriesSvc.create({ requestId: r7.id, userId: exec3.id, date: daysFromNow(-1), hours: 1, workKind: 'meetings', workName: 'Созвон-консультация по RLS' });
    await this.requestsSvc.changeStatus(r7.id, RequestStatus.REVIEW, exec3.id, 'Инструкция подготовлена');
    await this.requestsSvc.changeStatus(r7.id, RequestStatus.DONE, exec3.id, 'Проведена консультация, приложена инструкция', undefined);

    const r8 = await this.requestsSvc.create({
      type: RequestType.DEVELOPMENT, name: 'Дашборд оборачиваемости склада', customerId: cust3.id,
      priority: Priority.MEDIUM, assigneeId: exec3.id,
      description: 'Отчёт по скорости оборачиваемости товаров по складам',
      plannedHours: 24,
    }, exec3.id);
    await this.requestsSvc.changeStatus(r8.id, RequestStatus.QUEUED, admin2.id);
    await this.requestsSvc.changeStatus(r8.id, RequestStatus.IN_PROGRESS, exec3.id, 'Начат анализ требований');
    await this.requestsSvc.changeStatus(r8.id, RequestStatus.WAITING_CUSTOMER, exec3.id, 'Нужен список складов, которые нужно включить в отчёт');

    const r9 = await this.requestsSvc.create({
      type: RequestType.IMPROVEMENT, name: 'Добавить фильтр по грейду в HR-дашборд', customerId: cust4.id,
      priority: Priority.MEDIUM, description: 'Не указано, какой именно грейд — линейка должностей или зарплатная вилка',
    }, admin2.id);
    await this.requestsSvc.changeStatus(r9.id, RequestStatus.WAITING_CUSTOMER, admin2.id, 'Запросили уточнение у заказчика: какая именно классификация грейдов имеется в виду');

    await this.requestsSvc.create({
      type: RequestType.OTHER, name: 'Выгрузить архив дашбордов за 2024 год', customerId: cust2.id,
      priority: Priority.LOW, description: 'Нужен PDF-архив всех отчётов Finance за прошлый год',
    }, admin2.id).then(r => this.requestsSvc.changeStatus(r.id, RequestStatus.QUEUED, admin2.id));

    const r11 = await this.requestsSvc.create({
      type: RequestType.DEVELOPMENT, name: 'Дашборд подбора персонала (Recruiting)', customerId: cust4.id,
      priority: Priority.HIGH, assigneeId: exec2.id, plannedHours: 30,
      description: 'Воронка подбора, время закрытия вакансий, источники кандидатов',
    }, exec2.id);
    await this.requestsSvc.changeStatus(r11.id, RequestStatus.QUEUED, admin2.id);
    await this.requestsSvc.changeStatus(r11.id, RequestStatus.IN_PROGRESS, exec2.id);
    await this.timeEntriesSvc.create({ requestId: r11.id, userId: exec2.id, date: daysFromNow(-4), hours: 14, workKind: 'visualization', workName: 'Разработка визуалов воронки подбора' });
    await this.requestsSvc.changeStatus(r11.id, RequestStatus.REVIEW, exec2.id, 'Направлено HR-департаменту на согласование');

    const r12 = await this.requestsSvc.create({
      type: RequestType.BUGFIX, name: 'Пропали данные за прошлую неделю в отчёте по логистике', customerId: cust3.id,
      priority: Priority.LOW, description: 'Похоже, что данные за последнюю неделю не отображаются',
    }, portal3Info.portalUserId!);
    await this.requestsSvc.addComment(r12.id, 'Уточняем у заказчика, какой именно фильтр периода был выбран', admin2.id);
    await this.requestsSvc.changeStatus(r12.id, RequestStatus.CANCELLED, admin2.id, 'Заказчик подтвердил — был выставлен фильтр "Прошлый месяц", ошибка на стороне пользователя', 'Отменено инициатором');

    const r13 = await this.requestsSvc.create({
      type: RequestType.IMPROVEMENT, name: 'Добавить разбивку P&L по проектам', customerId: cust2.id,
      priority: Priority.MEDIUM, assigneeId: exec2.id, reportId: report2.id,
      description: 'Финансовому департаменту нужна детализация по проектам внутри каждой статьи',
    }, exec2.id);
    await this.requestsSvc.changeStatus(r13.id, RequestStatus.QUEUED, admin2.id);
    await this.requestsSvc.changeStatus(r13.id, RequestStatus.IN_PROGRESS, exec2.id);
    await this.timeEntriesSvc.create({ requestId: r13.id, userId: exec2.id, date: daysFromNow(-5), hours: 9, workKind: 'modeling', workName: 'Добавление измерения "Проект"' });
    await this.requestsSvc.changeStatus(r13.id, RequestStatus.REVIEW, exec2.id);
    await this.requestsSvc.changeStatus(r13.id, RequestStatus.DONE, admin2.id, undefined, undefined);

    await this.requestsSvc.create({
      type: RequestType.DEVELOPMENT, name: 'Дашборд по возвратам и претензиям', customerId: cust1.id,
      priority: Priority.MEDIUM,
      description: 'Нужен отчёт по количеству и причинам возвратов товара за последний квартал',
    }, portal1Info.portalUserId!);

    // ── 8. Опросы удовлетворённости — заполняем часть из них ────────────
    for (const [reqId, scores] of [
      [r1.id, { quality: 4, speed: 3, communication: 5, compliance: 5, overall: 4, comment: 'Хорошо получилось, но пришлось повозиться с доработкой' }],
      [r2.id, { quality: 5, speed: 5, communication: 5, compliance: 5, overall: 5, comment: 'Починили очень быстро, спасибо!' }],
      [r7.id, { quality: 4, speed: 4, communication: 4, compliance: 4, overall: 4 }],
    ] as const) {
      const rating = await this.ratingsSvc.getForRequest(reqId as number);
      if (rating) await this.ratingsSvc.submitSurvey(rating.token, scores as any);
    }
    // r4 и r13 намеренно остаются с неотправленным опросом — реалистичная картина (не все отвечают)

    const summary = '4 доп. пользователя, 2 подрядчика, 4 заказчика (2 с портальным доступом), '
      + '4 источника данных, 2 предустановленных отчёта + 1 создан автоматически по заявке R1, '
      + '2 known errors, 14 заявок во всех статусах жизненного цикла, трудозатраты, 3 заполненных опроса.';
    this.logger.log(`Готово: ${summary}`);
    return { skipped: false, summary, credentials };
  }
}
