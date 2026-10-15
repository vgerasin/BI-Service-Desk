# BI Service Desk

Self-hosted request tracker and time-tracking system for BI / analytics teams: intake of requests from
business users, work-time accounting, report registry with lineage, contractor acts, analytics and Telegram/e-mail notifications.

**Stack:** NestJS 10 · TypeORM · PostgreSQL 15 · React 18 · Vite · Ant Design 5 · Docker.

[English summary at the bottom](#english-summary)

## Возможности

- Заявки: портал для заказчиков, реестр для исполнителей, статусы, эскалации, оценка качества (CSI-опрос).
- Трудозатраты, подрядчики и ставки, формирование актов (DOCX).
- Каталог: реестр отчётов, источники данных, линейдж, известные ошибки.
- Аналитика: воронка, нагрузка, оценки; уведомления в Telegram и по e-mail.
- Роли: администратор, исполнитель, заказчик.
- Все интеграции включаются из интерфейса (**Управление → Система → Настройки**), без правки кода:
  - **Вход через SSO** — любой OAuth2 (authorization code) провайдер, [инструкция](docs/sso.md);
  - **База сотрудников** — внешняя PostgreSQL со справочником, [формат](docs/hr-directory.md);
  - **Почта** (SMTP), **Telegram** (бот и прокси);
  - **Мониторинг обновления дашбордов** — HTTP-приём статусов от cron/n8n/скрипта, [инструкция](docs/dashboard-refresh.md);
  - **Юрлица-плательщики** для актов.

  Необязательные интеграции, пока выключены, скрыты из интерфейса. Секреты хранятся в БД в зашифрованном виде (AES-256-GCM)
  и не возвращаются в браузер.

## Быстрый старт

```bash
cp .env.example .env        # заполните DB_PASSWORD, JWT_SECRET (openssl rand -hex 32), ADMIN_EMAIL
docker compose up -d --build
```

Откройте http://localhost:3000 и войдите как `ADMIN_EMAIL`. Если `ADMIN_PASSWORD` не задан, временный пароль
напечатан в логе: `docker compose logs app | grep setup`.

| Переменная | Назначение |
| --- | --- |
| `DB_PASSWORD` | пароль PostgreSQL (обязательно) |
| `JWT_SECRET` | подпись токенов и ключ шифрования секретов интеграций (обязательно; не меняйте после первого запуска) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | первый администратор; этот e-mail всегда получает роль admin |
| `APP_URL` | публичный адрес (ссылки в письмах, redirect URI для SSO) |
| `APP_NAME` | название в интерфейсе и письмах |
| `APP_PORT` | порт на хосте (по умолчанию 3000) |

Дополнительно (необязательно): `SMTP_*`, `TELEGRAM_*`, `DASHBOARD_LOG_SECRET` работают как значения по умолчанию,
если интеграция ещё не настроена в интерфейсе; `CORS_ORIGIN`, `DB_SYNCHRONIZE=false`, `DISABLE_SCHEDULED_JOBS=1`.

Для HTTPS поставьте перед приложением любой reverse proxy (Caddy, nginx, Traefik) и укажите `APP_URL=https://…`.
Данные хранятся в томах `postgres_data` (БД) и `uploads_data` (вложения). Резервная копия данных в JSON: Управление → Система → Резервное копирование
(вложения копируйте отдельно).

## Разработка

```bash
# БД
docker run -d --name bsd-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=bsd -p 5432:5432 postgres:15-alpine
# backend
cd backend && npm i && DATABASE_URL=postgresql://postgres:dev@localhost:5432/bsd JWT_SECRET=dev npm run start:dev
# frontend (прокси на :3000 настроен в vite.config.ts)
cd frontend && npm i --legacy-peer-deps && npm run dev
```

## Структура

```
backend/    NestJS API (также раздаёт собранный фронтенд из /public)
frontend/   React SPA
docs/       инструкции по интеграциям
examples/   пример отправки статусов обновления дашбордов
Dockerfile  общий образ (frontend + backend)
```

## English summary

BI Service Desk is a self-hosted request tracker and time-tracking tool for BI teams. Run it with
`cp .env.example .env && docker compose up -d --build`, open http://localhost:3000 and sign in as `ADMIN_EMAIL`.
SSO (generic OAuth2), SMTP, Telegram, an optional external HR directory and dashboard-refresh monitoring are configured in the web UI
under *Управление → Система → Настройки*; secrets are encrypted at rest. The UI is in Russian.

## License

MIT — see [LICENSE](LICENSE).
