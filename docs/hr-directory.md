# HR directory (optional integration)

When enabled in **Управление → Система → Настройки → База сотрудников**, the app reads employees from an
**external PostgreSQL database** (read-only; it never writes there). It is used to pick requesters/assignees,
show the org structure and resolve notification e-mails. If the integration is off, the "Сотрудники" section is hidden.

Connection form: host, port, database, user, password, SSL. The password is stored encrypted and is never sent back to the browser.
Use a **read-only** database role.

## Expected tables

```sql
-- One row per change of a person over time; the newest "Period" per "INN" is the current state.
CREATE TABLE "Sotrudniki" (
  "INN"         text,        -- stable person id (any unique string works)
  "Period"      timestamp,   -- version timestamp
  "SurName"     text,
  "Name"        text,
  "MiddleName"  text,
  "Position"    text,
  "Department"  text,
  "Email"       text,
  "Company"     text,
  "City"        text,
  "Chief"       text,        -- full name of the manager
  "OrgUnit"     text,
  "DateEnd"     timestamp    -- NULL = still employed
);

-- Org units. Hierarchy is encoded in the name as a numeric path:
--   "02 Finance"  →  "02/04 Treasury"  →  "02/04/02 Cash desk"
CREATE TABLE "OrgStructure" (
  "OrgUnitName" text,
  "Disbanded"   integer      -- 1 = no longer exists
);
```

The "Проверить подключение" button reports whether both tables are visible. How the tables get filled
(ETL, n8n, cron, a view over your HR system) is up to you.
