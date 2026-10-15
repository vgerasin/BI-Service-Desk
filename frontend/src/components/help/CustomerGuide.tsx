import { Typography, Card, Tag, Alert } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import { SectionTitle, Screenshot, Step } from './HelpPrimitives';

const { Paragraph, Text } = Typography;

// Заявитель (customer/portal) walkthrough — shared by HelpPage.tsx (role-gated tab) and
// LoginPage.tsx (popup for people who haven't logged in yet). Keeping it in one place means a
// screenshot refresh or a workflow change only has to happen once instead of drifting between
// two copies.
export default function CustomerGuide() {
  return (
    <div style={{ maxWidth: 820 }}>
      <Alert
        type="info" showIcon icon={<SafetyOutlined />}
        message="Роль: Заказчик (портал)"
        description="Вы видите только свои заявки. Внутренние инструменты системы (дашборд, аналитика, трудозатраты) недоступны."
        style={{ marginBottom: 24 }}
      />

      <SectionTitle>Вход в систему</SectionTitle>
      <Step num={1} title="Откройте браузер и перейдите на адрес системы">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Если в системе настроен корпоративный вход (SSO), нажмите кнопку входа через SSO —
          это самый быстрый способ, отдельный пароль от системы не нужен: при первом таком входе
          учётная запись создастся автоматически. Иначе нажмите <Text strong>Войти по паролю</Text>,
          введите email и пароль и нажмите <Text strong>Войти</Text>. Если пароль забыт — ссылка
          «Забыли пароль?» под формой отправит новый пароль на указанный email.
        </Paragraph>
        <Screenshot label="Страница входа: поля Email и Пароль, кнопка «Войти»" src="/docs/login-page.png" height={180} />
      </Step>

      <SectionTitle>Список заявок</SectionTitle>
      <Step num={2} title="Главный экран — ваши заявки">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          После входа вы сразу попадаете на <Text strong>Портал заявок</Text>.
          Переключатель <Text strong>Мои заявки / Все заявки</Text> определяет, что вы видите:
          только заявки, которые оформили лично вы, или все заявки вашего подразделения
          (например, если коллега подал заявку от имени всего отдела). Поле поиска ищет
          по названию и по номеру заявки; фильтры справа сужают список по статусу, типу
          и дашборду.
        </Paragraph>
        <Screenshot label="Портал заявок: таблица заявок с колонками Номер, Наименование, Статус и другими" src="/docs/portal-requests-list.png" />
      </Step>
      <Step num={3} title="Что означает статус заявки">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Статус в колонке «Статус» показывает, на каком этапе находится заявка и нужно ли
          от вас какое-то действие прямо сейчас:
        </Paragraph>
        <Card size="small" style={{ fontSize: 13, marginBottom: 8 }}>
          {[
            { tag: 'Новая', color: 'default', desc: 'Заявка зарегистрирована, ещё не рассмотрена командой. Действий от вас не требуется.' },
            { tag: 'В очереди', color: 'processing', desc: 'Заявка принята, ждёт свободного исполнителя.' },
            { tag: 'В работе', color: 'blue', desc: 'Исполнитель уже занимается задачей.' },
            { tag: 'На доработке', color: 'volcano', desc: 'Возвращена исполнителю на исправление после проверки.' },
            { tag: 'На проверке', color: 'purple', desc: 'Команда завершает работу. Если результат уже вас устраивает — можете закрыть заявку сами, не дожидаясь исполнителя — см. Шаг 8.' },
            { tag: 'Ожидание заказчика', color: 'cyan', desc: 'Работа приостановлена, команда ждёт вашего ответа в комментариях — см. Шаг 9.' },
            { tag: 'Выполнена', color: 'success', desc: 'Заявка закрыта. Вы можете оценить работу по заявке — см. Шаг 10.' },
            { tag: 'Отклонена', color: 'error', desc: 'Заявка закрыта без выполнения — причина указана в карточке заявки.' },
            { tag: 'Отменена', color: 'default', desc: 'Заявка отозвана до начала или в процессе работы.' },
          ].map(r => (
            <div key={r.tag} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'baseline' }}>
              <Tag color={r.color} style={{ minWidth: 150, textAlign: 'center', flexShrink: 0 }}>{r.tag}</Tag>
              <Text style={{ color: '#555', fontSize: 12 }}>{r.desc}</Text>
            </div>
          ))}
        </Card>
      </Step>

      <SectionTitle>Создание новой заявки</SectionTitle>
      <Step num={4} title="Нажмите кнопку «Новая заявка» в шапке портала">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Сначала выберите тип заявки — <Text strong>Ошибка/Баг</Text>, <Text strong>Доработка</Text> или
          <Text strong> Новый дашборд</Text>. Для вопросов и предложений, не относящихся к конкретному
          дашборду, свяжитесь с командой напрямую — такие обращения портал пока не принимает.
        </Paragraph>
        <Screenshot label="Выбор типа заявки: Ошибка / Баг, Доработка, Новый дашборд" src="/docs/portal-new-request-type.png" height={300} />
      </Step>
      <Step num={5} title="Заполните форму заявки">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          После выбора типа откроется форма с полями:
        </Paragraph>
        <Card size="small" style={{ fontSize: 13 }}>
          {[
            { field: 'Тема заявки', req: true, desc: 'Краткое описание задачи. Например: «Отчёт по продажам за квартал»' },
            { field: 'Дашборд / отчёт', req: false, desc: 'Выберите из реестра, если заявка касается уже существующего дашборда' },
            { field: 'Описание', req: true, desc: 'Что нужно сделать, какие данные использовать, примеры и пожелания. Кнопка «Добавить скриншот» и поле «Прикрепить файл» ниже принимают вложения до 20 МБ' },
          ].map(r => (
            <div key={r.field} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 140, flexShrink: 0 }}>
                <Text strong>{r.field}</Text>
                {r.req && <Text type="danger"> *</Text>}
              </div>
              <Text style={{ color: '#555' }}>{r.desc}</Text>
            </div>
          ))}
        </Card>
        <Paragraph style={{ fontSize: 13, margin: '8px 0 0' }}>
          Приоритет форма не спрашивает — команда выставляет его сама при рассмотрении заявки, по
          умолчанию «Средний»; если задача срочная, укажите это прямо в описании.
        </Paragraph>
        <Screenshot label="Форма создания заявки: Тема заявки, Дашборд/отчёт, Описание, кнопка «Отправить заявку»" src="/docs/portal-new-request-form.png" />
      </Step>
      <Step num={6} title="Нажмите «Отправить заявку»">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Заявка будет зарегистрирована со статусом <Tag color="default">Новая</Tag> и
          появится в вашем списке. Вы получите уведомление, когда статус изменится.
        </Paragraph>
        <Screenshot label="Подтверждение отправки: заявка появилась в списке со статусом «Новая»" src="/docs/portal-request-submitted.png" height={180} />
      </Step>

      <SectionTitle>Просмотр деталей заявки</SectionTitle>
      <Step num={7} title="Нажмите на любую заявку в списке">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Откроется страница заявки: описание, назначенный исполнитель, плановый срок,
          история изменений и обсуждение внизу. Кнопка <Text strong>+ Комментарий</Text> в блоке
          «Обсуждение» — основной канал связи с командой по этой заявке: используйте её, чтобы
          что-то уточнить или прикрепить дополнительный файл уже после подачи заявки. Для некоторых
          статусов (например, «На проверке» или «Ожидание заказчика») сверху появляется цветная
          плашка с пояснением и, если нужно, кнопкой действия — см. следующие шаги.
        </Paragraph>
        <Screenshot label="Страница заявки: плашка статуса, блок деталей, заявитель и исполнитель, обсуждение" src="/docs/portal-request-detail.png" />
      </Step>

      <SectionTitle>Если заявка на проверке</SectionTitle>
      <Step num={8} title="Статус «На проверке»">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Команда завершает работу над заявкой — переводить её в статус «Выполнена» самостоятельно
          не обязательно, это может сделать исполнитель. Но если результат уже понятен и вас
          устраивает, не нужно ждать: на странице заявки нажмите кнопку
          <Text strong> «Всё устраивает, закрыть»</Text> в фиолетовой плашке — заявка сразу
          перейдёт в статус «Выполнена», и вы сможете её оценить (Шаг 10). Система попросит
          подтвердить это действие.
        </Paragraph>
      </Step>

      <SectionTitle>Если заявка ожидает вашего ответа</SectionTitle>
      <Step num={9} title="Статус «Ожидание заказчика»">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          Когда команде нужен ваш ответ, чтобы продолжить работу, заявка переходит в статус
          <Tag color="cyan" style={{ margin: '0 4px' }}>Ожидание заказчика</Tag>
          и на странице заявки появляется отдельный баннер. Пока заявка в этом статусе, срок
          выполнения (SLA) не идёт — он возобновится только после вашего ответа. Ответьте на
          вопрос в комментариях, а затем выберите одно из двух действий в баннере:
        </Paragraph>
        <Card size="small" style={{ fontSize: 13, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 160, flexShrink: 0 }}><Text strong>Готово, выполнено</Text></div>
            <Text style={{ color: '#555' }}>Ваш ответ уже полностью закрывает вопрос — заявка сразу переходит в статус «Выполнена». Система попросит подтвердить это действие.</Text>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 160, flexShrink: 0 }}><Text strong>Возобновить работу</Text></div>
            <Text style={{ color: '#555' }}>Нужна дальнейшая доработка — заявка возвращается в работу. Комментарий с пояснением для команды обязателен.</Text>
          </div>
        </Card>
      </Step>

      <SectionTitle>Оценка выполненной работы</SectionTitle>
      <Step num={10} title="Оцените заявку в статусе «Выполнена»">
        <Paragraph style={{ fontSize: 13, margin: '4px 0' }}>
          На странице закрытой заявки, прямо под описанием, появляется жёлтая карточка
          <Text strong> «Оценка выполнения»</Text> с пятью вопросами о работе команды. На каждый
          нужно ответить <Text strong>Да</Text> или <Text strong>Нет</Text> — третьего варианта
          нет; комментарий под вопросом необязателен и может пояснить любой из двух ответов (если
          задержек не было, отвечайте «Да» и, если хотите, поясните это в комментарии). Оценка
          формируется автоматически по количеству ответов «Да» и используется в разделе
          <Text strong> Аналитика → Оценки</Text> для отслеживания качества работы по
          подразделениям — заполните её, это займёт меньше минуты. Отправленную оценку изменить
          нельзя, но её результат сразу виден вам на той же странице.
        </Paragraph>
        <Screenshot label="Карточка «Оценка выполнения»: пять вопросов с ответами Да/Нет и необязательным комментарием" src="/docs/portal-csi-survey.png" />
      </Step>
    </div>
  );
}
