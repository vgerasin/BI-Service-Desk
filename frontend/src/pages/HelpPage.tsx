import { useState } from 'react';
import {
  Tabs, Typography, Card, Row, Col, Tag, Divider, Steps, Alert, Table,
  Space, Badge,
} from 'antd';
import {
  FileTextOutlined, ClockCircleOutlined, BarChartOutlined,
  DashboardOutlined, UserOutlined, TeamOutlined,
  BankOutlined, ProjectOutlined, DatabaseOutlined, ApartmentOutlined,
  UnorderedListOutlined, CloudDownloadOutlined, SettingOutlined,
  SafetyOutlined, ThunderboltOutlined, CheckCircleOutlined, InfoCircleOutlined,
  SendOutlined, PlusOutlined, EditOutlined, FundOutlined,
} from '@ant-design/icons';
import Reveal from '../components/Reveal';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import { TECH_COLOR, SectionTitle, Screenshot, Step } from '../components/help/HelpPrimitives';
import CustomerGuide from '../components/help/CustomerGuide';

const { Title, Paragraph, Text } = Typography;

// ─── О системе ───────────────────────────────────────────────────────────────

function AboutTab() {
  const roleRows = [
    { role: 'Заказчик (портал)', label: 'customer', color: '#875bff', desc: 'Внешние пользователи — подают заявки через упрощённый портал, отслеживают статус.' },
    { role: 'Исполнитель', label: 'executor', color: '#d46b08', desc: 'Работает с назначенными заявками: меняет статусы, ведёт трудозатраты, видит стоимости.' },
    { role: 'Администратор', label: 'admin', color: '#531dab', desc: 'Полный доступ: заявки, аналитика, управление командой, справочники, настройки системы.' },
  ];

  const moduleRows = [
    { icon: <FileTextOutlined />, name: 'Реестр заявок', path: '/requests', desc: 'Полный список заявок с фильтрами, статусами, пакетными операциями и экспортом в Excel.' },
    { icon: <DashboardOutlined />, name: 'Дашборд', path: '/dashboard', desc: 'Ключевые KPI, нагрузка исполнителей, открытые заявки по заказчикам.' },
    { icon: <BarChartOutlined />, name: 'Аналитика', path: '/analytics', desc: 'Воронка, отчёт за месяц (дельты, чарты), стоимость работ, расходы по дашбордам.' },
    { icon: <ClockCircleOutlined />, name: 'Журнал трудозатрат', path: '/time-entries', desc: 'CRUD-журнал часов. Привязка к заявке и ставке (rate_history) для расчёта стоимости.' },
    { icon: <ProjectOutlined />, name: 'Реестр отчётов', path: '/admin/reports-ref', desc: 'Карточки Power BI отчётов: ссылка, воркспейс, статус, связанные источники данных.' },
    { icon: <ApartmentOutlined />, name: 'Линейдж', path: '/admin/lineage', desc: 'Граф «Источники данных → Отчёты» для аудита зависимостей.' },
    { icon: <DatabaseOutlined />, name: 'Источники данных', path: '/admin/data-sources', desc: 'Справочник баз данных и API, подключённых к отчётам.' },
    { icon: <BankOutlined />, name: 'Заказчики', path: '/admin/customers', desc: 'Подразделения-заказчики: отдел, ответственный, контакт.' },
    { icon: <TeamOutlined />, name: 'Подрядчики', path: '/admin/contractors', desc: 'Внешние подрядчики: тип, контакт, валюта, история ставок (rate_history).' },
    { icon: <UnorderedListOutlined />, name: 'Словари', path: '/admin/dictionaries', desc: 'Виды работ и другие перечни, используемые в трудозатратах.' },
    { icon: <CloudDownloadOutlined />, name: 'Резервное копирование', path: '/admin/backup', desc: 'Экспорт всех данных системы в JSON и восстановление из копии.' },
    { icon: <SettingOutlined />, name: 'Настройки системы', path: '/admin/settings', desc: 'SSO, база сотрудников, почта, Telegram-бот, мониторинг обновлений, юрлица-плательщики.' },
  ];

  return (
    <div>
      <Row gutter={24}>
        <Col span={24}>
          <Alert
            type="info"
            showIcon
            message="Система учёта работ BI"
            description="Единая точка управления заявками на разработку и доработку аналитической отчётности Power BI. Охватывает весь жизненный цикл — от подачи заказчиком до закрытия с автоматическим расчётом стоимости работ."
            style={{ marginBottom: 24 }}
          />
        </Col>
      </Row>

      <Screenshot label="Дашборд руководителя: KPI, распределение по видам работ, нагрузка исполнителей" src="/docs/dashboard-overview.png" height={220} />

      <Row gutter={24}>
        <Col xs={24} lg={12}>
          <SectionTitle>Технический стек</SectionTitle>
          <Card size="small" style={{ marginBottom: 16 }}>
            {[
              { layer: 'Frontend', value: 'React 18 + Vite + Ant Design 5 + TanStack Query v5 + @ant-design/charts', color: '#1677ff' },
              { layer: 'Backend', value: 'NestJS 10 + TypeORM + PostgreSQL', color: '#52c41a' },
              { layer: 'Auth', value: 'JWT (access token) + Local пароль + SSO (OAuth2)', color: '#fa8c16' },
              { layer: 'Деплой', value: 'Docker Compose (приложение + PostgreSQL)', color: '#722ed1' },
              { layer: 'Хранилище', value: 'PostgreSQL (данные) + файловая система (артефакты заявок)', color: '#13c2c2' },
            ].map(r => (
              <div key={r.layer} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <Tag color={r.color} style={{ minWidth: 90, textAlign: 'center', flexShrink: 0 }}>{r.layer}</Tag>
                <Text style={{ fontSize: 12, color: '#555' }}>{r.value}</Text>
              </div>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <SectionTitle>Статусы заявки</SectionTitle>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Steps
              direction="vertical"
              size="small"
              style={{ marginLeft: 4 }}
              items={[
                { title: 'Новая', description: 'Заявка создана, ожидает рассмотрения', status: 'process' },
                { title: 'В очереди', description: 'Принята в работу, ожидает свободного исполнителя', status: 'process' },
                { title: 'В работе', description: 'Исполнитель ведёт разработку', status: 'process' },
                { title: 'На проверке', description: 'Результат готов, идёт внутренняя проверка', status: 'process' },
                { title: 'Ожидание заказчика', description: 'Работа приостановлена, ждём ответа заказчика (SLA не считается)', status: 'process' },
                { title: 'Выполнена / Отклонена / Отменена', description: 'Финальные статусы', status: 'finish' },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <SectionTitle>Роли пользователей</SectionTitle>
      <Table
        size="small"
        pagination={false}
        dataSource={roleRows}
        rowKey="label"
        columns={[
          { title: 'Роль', dataIndex: 'role', width: 200, render: (v, r) => <Tag color={r.color}>{v}</Tag> },
          { title: 'Код', dataIndex: 'label', width: 140, render: v => <Text code style={{ fontSize: 11 }}>{v}</Text> },
          { title: 'Описание', dataIndex: 'desc' },
        ]}
        style={{ marginBottom: 24 }}
      />

      <SectionTitle>Модули системы</SectionTitle>
      <Row gutter={[12, 12]}>
        {moduleRows.map(m => (
          <Col xs={24} sm={12} lg={8} key={m.path}>
            <Card size="small" hoverable>
              <Space>
                <span style={{ color: TECH_COLOR, fontSize: 16 }}>{m.icon}</span>
                <Text strong style={{ fontSize: 13 }}>{m.name}</Text>
                <Text code style={{ fontSize: 10, color: '#aaa' }}>{m.path}</Text>
              </Space>
              <Paragraph style={{ margin: '6px 0 0', fontSize: 12, color: '#666' }}>{m.desc}</Paragraph>
            </Card>
          </Col>
        ))}
      </Row>

      <SectionTitle>Схема расчёта стоимости</SectionTitle>
      <Card size="small" style={{ marginBottom: 8 }}>
        <Paragraph style={{ fontSize: 13, margin: 0 }}>
          Каждая запись трудозатрат содержит <Text code>hours</Text> и ссылку на исполнителя (<Text code>userId</Text> или <Text code>contractorId</Text>).
          Стоимость рассчитывается через <Text code>rate_history</Text>:
          выбирается ставка, действовавшая на дату записи (<Text strong>LEFT JOIN LATERAL … ORDER BY dateFrom DESC LIMIT 1</Text>),
          и умножается на количество часов. Тип работы (<Text code>type</Text> заявки) определяет, в какую категорию попадает стоимость
          — Разработка (<Text code>development</Text>) или Доработка/исправление (<Text code>improvement</Text> + <Text code>bugfix</Text>).
        </Paragraph>
      </Card>
    </div>
  );
}

// ─── Для исполнителя ──────────────────────────────────────────────────────────

function ExecutorTab() {
  return (
    <div style={{ maxWidth: 820 }}>
      <Alert
        type="warning" showIcon icon={<ThunderboltOutlined />}
        message="Роли: Разработчик BI, Подрядчик"
        description="Исполнители работают в полном интерфейсе системы. Основные инструменты: Заявки и Журнал трудозатрат."
        style={{ marginBottom: 24 }}
      />

      <SectionTitle>Вход и навигация</SectionTitle>
      <Step num={1} title="Войдите в систему">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Войдите через корпоративный SSO (если настроен) или по email и паролю.
          После входа вы попадаете на страницу <Text strong>Заявки</Text>.
          В верхней панели навигации доступны: <Tag>Заявки</Tag> <Tag>Трудозатраты</Tag>.
        </Paragraph>
        <Screenshot label="Шапка навигации: логотип, кнопки Заявки и Трудозатраты, аватар пользователя" src="/docs/nav-header.png" height={120} />
      </Step>

      <SectionTitle>Работа с заявками</SectionTitle>
      <Step num={2} title="Перейдите в раздел «Заявки»">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Откроется таблица всех заявок системы. Используйте фильтры для поиска
          назначенных на вас задач:
        </Paragraph>
        <Card size="small" style={{ fontSize: 13, marginBottom: 8 }}>
          {[
            { filter: 'Исполнитель', desc: 'Выберите своё имя — покажет только ваши заявки' },
            { filter: 'Статус', desc: 'Например «В работе» — заявки, требующие активных действий' },
            { filter: 'Тип', desc: 'Разработка, Доработка, Исправление и т.д.' },
            { filter: 'Поиск', desc: 'По номеру или ключевому слову в теме заявки' },
          ].map(r => (
            <div key={r.filter} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Tag style={{ minWidth: 100, textAlign: 'center', flexShrink: 0 }}>{r.filter}</Tag>
              <Text style={{ color: '#555', fontSize: 12 }}>{r.desc}</Text>
            </div>
          ))}
        </Card>
        <Screenshot label="Реестр заявок: строка фильтров, таблица с колонками Номер / Тема / Заказчик / Исполнитель / Статус / Приоритет / Дата" src="/docs/requests-list.png" />
      </Step>
      <Step num={3} title="Откройте заявку">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Кликните по номеру или теме заявки. На странице заявки вы увидите:
        </Paragraph>
        <Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
          {[
            { icon: <InfoCircleOutlined />, label: 'Описание и детали задачи' },
            { icon: <FileTextOutlined />, label: 'Прикреплённые файлы (ТЗ, грифы)' },
            { icon: <CheckCircleOutlined />, label: 'История изменений (активность)' },
            { icon: <ClockCircleOutlined />, label: 'Записи трудозатрат по заявке' },
          ].map(item => (
            <Col span={12} key={item.label}>
              <Space>
                <span style={{ color: TECH_COLOR }}>{item.icon}</span>
                <Text style={{ fontSize: 13 }}>{item.label}</Text>
              </Space>
            </Col>
          ))}
        </Row>
        <Screenshot label="Страница заявки: шапка с номером/статусом, кнопки смены статуса, вкладки Детали / Трудозатраты / Документы" src="/docs/request-detail-executor.png" />
      </Step>
      <Step num={4} title="Обновите статус заявки">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Строка <Text strong>«Перевести в:»</Text> над вкладками показывает доступные из текущего
          статуса переходы — нажмите нужную кнопку. Переход в закрывающий статус (Выполнена,
          Отклонена, Отменена) откроет окно, где нужно выбрать причину и можно оставить комментарий:
        </Paragraph>
        <Screenshot label="Смена статуса заявки: закрывающий статус запрашивает причину и комментарий" src="/docs/status-change-modal.png" />
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Чтобы поставить заявку на паузу до ответа заказчика, переведите её в статус
          <Tag color="cyan" style={{ margin: '0 4px' }}>Ожидание заказчика</Tag>
          — SLA перестанет считаться, пока заказчик не ответит в обсуждении. Кроме кнопок статуса,
          в блоке «Обсуждение» всегда можно оставить комментарий — это не меняет статус, но держит
          и заказчика, и команду в курсе хода работы.
        </Paragraph>
      </Step>
      <Step num={5} title="Возьмите заявку в работу или передайте коллеге">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Если заявка ещё <Text strong>не назначена</Text>, в блоке «Исполнитель» появляется
          выпадающий список <Text strong>«Взять в работу / передать»</Text> — выберите себя или,
          если вы руководитель группы, одного из своих подчинённых. Если заявка уже назначена на
          кого-то из вашей команды, тот же список называется <Text strong>«Передать в команде»</Text>{' '}
          и позволяет перераспределить её на другого подчинённого. Заявки, назначенные не на вашу
          команду, этим списком не трогаются.
        </Paragraph>
      </Step>

      <SectionTitle>Журнал трудозатрат</SectionTitle>
      <Step num={6} title="Перейдите в раздел «Трудозатраты»">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Раздел доступен всем сотрудникам. Здесь фиксируются часы, потраченные на каждую заявку.
          Записи используются для расчёта стоимости работ.
        </Paragraph>
        <Screenshot label="Журнал трудозатрат: фильтры по дате и исполнителю, таблица записей с колонками Дата / Заявка / Исполнитель / Часы / Вид работы / Комментарий" src="/docs/time-entries-list.png" />
      </Step>
      <Step num={7} title="Добавьте запись трудозатрат">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Нажмите <Text strong>+ Добавить</Text> и заполните форму:
        </Paragraph>
        <Card size="small" style={{ fontSize: 13, marginBottom: 8 }}>
          {[
            { field: 'Дата', req: true, desc: 'Дата выполнения работ' },
            { field: 'Заявка', req: true, desc: 'Выберите заявку из выпадающего списка' },
            { field: 'Исполнитель', req: true, desc: 'Выберите себя из справочника исполнителей' },
            { field: 'Часы', req: true, desc: 'Количество часов (допускается дробное значение, например 1.5)' },
            { field: 'Вид работы', req: false, desc: 'Категория из словаря (разработка, тестирование, аналитика и т.д.)' },
            { field: 'Комментарий', req: false, desc: 'Краткое описание выполненной работы' },
          ].map(r => (
            <div key={r.field} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 120, flexShrink: 0 }}>
                <Text strong style={{ fontSize: 12 }}>{r.field}</Text>
                {r.req && <Text type="danger"> *</Text>}
              </div>
              <Text style={{ color: '#555', fontSize: 12 }}>{r.desc}</Text>
            </div>
          ))}
        </Card>
        <Screenshot label="Форма добавления записи трудозатрат: модальное окно с полями" src="/docs/time-entry-add-form.png" />
      </Step>
    </div>
  );
}

// ─── Для администратора ───────────────────────────────────────────────────────

function AdminTab() {
  return (
    <div style={{ maxWidth: 820 }}>
      <Alert
        type="success" showIcon icon={<SafetyOutlined />}
        message="Роль: Администратор"
        description="Полный доступ ко всем разделам системы. Дополнительно доступны: управление пользователями, настройки SSO/интеграций, резервное копирование."
        style={{ marginBottom: 24 }}
      />

      <SectionTitle>Управление пользователями</SectionTitle>
      <Step num={1} title="Справочники → Пользователи">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Откройте меню <Text strong>Справочники</Text> в шапке → <Text strong>Пользователи</Text>.
          Здесь отображаются все учётные записи системы с ролями и статусом активности.
        </Paragraph>
        <Screenshot label="Страница Пользователи: таблица ФИО / Email / Роль / Должность / Активен, кнопка «Добавить пользователя»" src="/docs/admin-users.png" />
      </Step>
      <Step num={2} title="Создание нового пользователя">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Нажмите <Text strong>+ Добавить</Text>. В форме укажите:
        </Paragraph>
        <Card size="small" style={{ fontSize: 13, marginBottom: 8 }}>
          {[
            { field: 'ФИО', req: true, desc: 'Полное имя пользователя' },
            { field: 'Email / Логин', req: true, desc: 'Email-адрес — используется для входа и как ключ привязки к SSO-аккаунту' },
            { field: 'Пароль', req: false, desc: 'Для локального входа по паролю. При входе через SSO не требуется' },
            { field: 'Роль', req: true, desc: 'Заказчик (портал) / Исполнитель / Администратор' },
            { field: 'Должность', req: false, desc: 'Отображается в профиле и списке пользователей' },
            { field: 'Заказчик', req: false, desc: 'Привязка к подразделению-заказчику (для роли «Заказчик»)' },
          ].map(r => (
            <div key={r.field} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 130, flexShrink: 0 }}>
                <Text strong style={{ fontSize: 12 }}>{r.field}</Text>
                {r.req && <Text type="danger"> *</Text>}
              </div>
              <Text style={{ color: '#555', fontSize: 12 }}>{r.desc}</Text>
            </div>
          ))}
        </Card>
        <Alert type="info" showIcon message="Для сотрудника, который входит через SSO, пароль можно не задавать — при первом входе учётная запись свяжется с этим email автоматически." style={{ fontSize: 12 }} />
      </Step>

      <SectionTitle>Справочники</SectionTitle>
      <Step num={3} title="Управление заказчиками (подразделениями)">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          <Text strong>Справочники → Заказчики</Text>.
          Создайте запись для каждого подразделения, которое будет подавать заявки.
          Укажите название отдела, ответственного сотрудника и контактные данные.
          Заказчик привязывается к заявке и используется в аналитике.
        </Paragraph>
        <Screenshot label="Страница Заказчики: таблица подразделений с отделом, ответственным и контактом" src="/docs/admin-customers.png" />
      </Step>
      <Step num={4} title="Управление подрядчиками">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          <Text strong>Команда → Подрядчики</Text>.
          Здесь ведётся реестр внешних подрядчиков с историей ставок.
          Для каждого подрядчика можно задать ставку (руб./ч или другую валюту)
          с датой начала действия — система автоматически выберет актуальную ставку
          при расчёте стоимости трудозатрат. Несколько человек одного контрагента
          можно сгруппировать полем «Головной подрядчик».
        </Paragraph>
        <Screenshot label="Страница Подрядчики: таблица с ФИО / Тип / Контакт / Валюта, кнопка управления ставками «История ставок»" src="/docs/admin-contractors.png" />
      </Step>
      <Step num={5} title="Реестр отчётов Power BI">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          <Text strong>Справочники → Реестр отчётов</Text>. Таблица показывает все дашборды
          компании: владельца со стороны бизнеса, BI-разработчика, среду (разработка / продуктив /
          архив), версию, статус, отметки RLS (разграничение доступа к строкам) и прохождения
          чеклиста, дату публикации и ссылку на сам отчёт в Power BI. Кнопка{' '}
          <Text strong>+ Добавить</Text> открывает ту же форму, что и редактирование существующей
          карточки. Заявки привязываются к отчёту через поле «Дашборд» — это то, что позволяет
          считать расходы и заявки в разрезе каждого отчёта в остальной системе.
        </Paragraph>
      </Step>
      <Step num={6} title="Словари видов работ">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          <Text strong>Справочники → Словари</Text> объединяет несколько независимых справочников
          на вкладках: <Text strong>Типы работ</Text> (те же значения, что и «Тип запроса» в заявке —
          Доработка / Баг-фикс / Консультация / Прочее / Разработка), <Text strong>Виды работ</Text>{' '}
          (детальная классификация для журнала трудозатрат — ETL, анализ требований, визуализация
          и т.д.) и <Text strong>Источники данных</Text> — в этих трёх переключатель{' '}
          <Text strong>Активен</Text> у каждой записи скрывает значение из выпадающих списков,
          не удаляя его из уже существующих заявок и записей. Четвёртая вкладка,{' '}
          <Text strong>SLA по приоритетам</Text>, устроена иначе — это фиксированный список из
          4 приоритетов, где редактируется только плановый срок в днях: он подставляется
          автоматически при создании заявки, если срок не указан вручную.
        </Paragraph>
        <Screenshot label="Страница Словари: список видов работ, кнопка «Добавить»" src="/docs/admin-dictionaries.png" />
      </Step>

      <SectionTitle>Реестр отчётов и линейдж</SectionTitle>
      <Step num={7} title="Карточка отчёта и источники данных">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Зайдите в любой отчёт из реестра. На странице можно указать, какие источники данных
          (таблицы / базы / API) используются этим отчётом — это формирует граф зависимостей.
        </Paragraph>
        <Screenshot label="Карточка отчёта: общие сведения, владение и аудитория, технические параметры, связанные заявки" src="/docs/report-detail-card.png" />
      </Step>
      <Step num={8} title="Линейдж (граф зависимостей)">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          <Text strong>Справочники → Линейдж</Text>.
          По умолчанию открывается таблица источников данных с количеством связанных отчётов;
          переключатель в правом верхнем углу разворачивает то же самое в виде интерактивного
          графа «Источник данных → Отчёт». Полезно при аудите: позволяет быстро понять, какие
          отчёты затронет изменение в источнике.
        </Paragraph>
        <Screenshot label="Страница Линейдж: таблица источников с кол-вом связанных отчётов, переключатель Таблица / Граф" src="/docs/lineage-graph.png" />
      </Step>

      <SectionTitle>Аналитика</SectionTitle>
      <Step num={9} title="Дашборд и аналитика">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Раздел <Text strong>Дашборд</Text> — быстрый обзор: открытые заявки, нагрузка исполнителей,
          заявки по заказчикам. Раздел <Text strong>Аналитика</Text> содержит детальные отчёты:
        </Paragraph>
        <Card size="small" style={{ fontSize: 13, marginBottom: 8 }}>
          {[
            { tab: 'Дашборд', desc: 'Общая воронка по всем типам заявок и сравнение с прошлым периодом' },
            { tab: 'Разработка', desc: 'KPI и воронка этапов отдельно по новым дашбордам и доработкам' },
            { tab: 'Баги', desc: 'Та же картина для заявок типа «Ошибка / Баг»' },
            { tab: 'Оценки', desc: 'CSI-опрос заказчиков по завершённым заявкам, разбивка по подразделениям' },
            { tab: 'Затраты', desc: 'Расчёт стоимости работ: часы × ставка, по исполнителям и дашбордам' },
            { tab: 'Обновление дашбордов', desc: 'Сбои автообновления Power BI-отчётов за сегодня и за период' },
            { tab: 'Активность', desc: 'Журнал действий пользователей в системе' },
          ].map(r => (
            <div key={r.tab} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Tag color="blue" style={{ minWidth: 120, textAlign: 'center', flexShrink: 0 }}>{r.tab}</Tag>
              <Text style={{ color: '#555', fontSize: 12 }}>{r.desc}</Text>
            </div>
          ))}
        </Card>
        <Screenshot label="Аналитика → Разработка: KPI-карточки за месяц и воронка этапов с конверсией" src="/docs/analytics-monthly.png" />
      </Step>

      <SectionTitle>Интеграции (Настройки системы)</SectionTitle>
      <Step num={10} title="Управление → Система → Настройки">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Все внешние подключения задаются из интерфейса, переменные окружения для этого не нужны.
          Секреты (Client Secret, пароли) хранятся на сервере в зашифрованном виде и обратно в
          интерфейс не возвращаются: пустое поле при сохранении означает «оставить как есть».
        </Paragraph>
        <Card size="small" style={{ fontSize: 13, marginBottom: 8 }}>
          {[
            { field: 'Вход через SSO', desc: 'Любой OAuth2-провайдер (authorization code): адреса авторизации, токена и userinfo, Client ID/Secret, сопоставление полей профиля, роль по умолчанию. Включает кнопку входа на странице логина.' },
            { field: 'База сотрудников', desc: 'Необязательно. Подключение к внешней PostgreSQL со справочником сотрудников (см. docs/hr-directory.md). Пока выключено — раздел «Сотрудники» скрыт.' },
            { field: 'Почта', desc: 'SMTP для уведомлений. Есть кнопка «Отправить тестовое письмо».' },
            { field: 'Telegram и прокси', desc: 'Бот, чат, расписание сводок.' },
            { field: 'Мониторинг обновлений', desc: 'Необязательно. Внешняя задача (cron, n8n, скрипт) присылает статусы обновления дашбордов по HTTP с секретным заголовком. Пока выключено — вкладка в аналитике скрыта.' },
            { field: 'Юрлица-плательщики', desc: 'Справочник для актов.' },
          ].map(r => (
            <div key={r.field} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 150, flexShrink: 0 }}>
                <Text strong style={{ fontSize: 12 }}>{r.field}</Text>
              </div>
              <Text style={{ color: '#555', fontSize: 12 }}>{r.desc}</Text>
            </div>
          ))}
        </Card>
        <Paragraph style={{ fontSize: 13 }}>
          При первом входе через SSO учётная запись создаётся автоматически с ролью по умолчанию;
          при необходимости смените роль на странице <Text strong>Пользователи</Text>.
        </Paragraph>
      </Step>

      <SectionTitle>Резервное копирование</SectionTitle>
      <Step num={11} title="Справочники → Резервное копирование">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Нажмите <Text strong>Скачать резервную копию</Text> — система выгрузит все данные
          (пользователи, заявки, трудозатраты, справочники, историю изменений, оценки) одним
          JSON-файлом. Физические вложения заявок (загруженные файлы) в копию не входят —
          их нужно переносить отдельно из папки <Text code>uploads/</Text>. Храните копии в
          защищённом месте, рекомендуемая периодичность — ежедневно.
        </Paragraph>
        <Alert
          type="warning" showIcon style={{ marginBottom: 8, fontSize: 12 }}
          message="Импорт из резервной копии полностью заменяет текущие данные и необратим — используйте только для восстановления, не для тестов."
        />
        <Screenshot label="Страница Резервное копирование: экспорт в JSON и импорт с предупреждением о замене данных" src="/docs/admin-backup.png" />
      </Step>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

// Admin sees the whole manual (incl. the customer/executor walkthroughs — useful when helping
// someone else). Customer and executor accounts each see only their own section: the other
// roles' steps reference buttons/pages they don't have access to, so showing them is just noise.
const ALL_ITEMS = [
  {
    key: 'about',
    label: <Space><FundOutlined /> О системе</Space>,
    children: <AboutTab />,
  },
  {
    key: 'customer',
    label: <Space><SendOutlined /> Заказчик</Space>,
    children: <CustomerGuide />,
  },
  {
    key: 'executor',
    label: <Space><EditOutlined /> Исполнитель</Space>,
    children: <ExecutorTab />,
  },
  {
    key: 'admin',
    label: <Space><SettingOutlined /> Администратор</Space>,
    children: <AdminTab />,
  },
];

function itemsForRole(role: UserRole | undefined) {
  if (role === UserRole.CUSTOMER) return ALL_ITEMS.filter(i => i.key === 'customer');
  if (role === UserRole.EXECUTOR) return ALL_ITEMS.filter(i => i.key === 'executor');
  return ALL_ITEMS; // admin, or role unknown — safest default is to show everything
}

export default function HelpPage() {
  const { user } = useAuth();
  const items = itemsForRole(user?.role);
  const [tab, setTab] = useState(items[0].key);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0, color: TECH_COLOR }}>Справка и документация</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>Система учёта работ BI</Text>
        </div>
        <Badge count="v1.0" color={TECH_COLOR} style={{ marginLeft: 4 }} />
      </div>

      {items.length > 1 ? (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          size="large"
          items={items.map(i => ({
            key: i.key,
            label: i.label,
            children: <Reveal><div style={{ padding: '16px 0' }}>{i.children}</div></Reveal>,
          }))}
        />
      ) : (
        <Reveal><div style={{ padding: '16px 0' }}>{items[0].children}</div></Reveal>
      )}

      <Divider />
      <div style={{ textAlign: 'center', paddingBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Для добавления скриншотов поместите файлы PNG в папку{' '}
          <Text code style={{ fontSize: 11 }}>frontend/public/docs/</Text>{' '}
          и обновите соответствующие элементы в{' '}
          <Text code style={{ fontSize: 11 }}>src/pages/HelpPage.tsx</Text>
        </Text>
      </div>
    </div>
  );
}
