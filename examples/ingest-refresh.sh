#!/usr/bin/env sh
# Push failed dashboard refreshes to BI Service Desk. See docs/dashboard-refresh.md
: "${APP_URL:?}" "${SECRET:?}"
curl -fsS -X POST "$APP_URL/api/dashboard-refresh-logs/ingest" \
  -H "x-log-secret: $SECRET" -H "Content-Type: application/json" \
  -d '[{"reportName":"Sales overview","lastStatus":"Error: data source unavailable"}]'
