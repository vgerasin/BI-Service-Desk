# Dashboard-refresh monitoring (optional integration)

Enable in **Управление → Система → Настройки → Мониторинг обновлений**. The page shows an ingest secret (generate or paste your own).
An external job (cron, n8n, any script) then pushes, once a day, the reports whose last scheduled refresh **did not succeed**.
The "Обновление дашбордов" tab in Аналитика appears only while the integration is enabled.

```bash
curl -X POST "$APP_URL/api/dashboard-refresh-logs/ingest" \
  -H "x-log-secret: $SECRET" -H "Content-Type: application/json" \
  -d '[{"reportName":"Sales overview","lastStatus":"Error: data source unavailable"}]'
```

Other endpoints (same header): `GET /api/dashboard-refresh-logs/recent`, `DELETE /api/dashboard-refresh-logs` (`{"ids":[1,2]}` or `{"all":true}`),
`POST /api/dashboard-refresh-logs/aliases` (`{"sourceName":"…","reportName":"…"}`) to map a source-system name to a report in the registry.
Reports are matched by name (case-insensitive) with the registry in *Каталог → Реестр отчётов*.
