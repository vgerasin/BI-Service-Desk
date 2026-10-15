import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { APP_NAME as BRAND } from '../branding';


// Matched by longest path prefix first, so e.g. "/admin/reports-ref" doesn't shadow
// a more specific "/admin/reports-ref/:id" if one is ever added here.
const ROUTE_TITLES: [string, string][] = [
  ['/login', 'Вход'],
  ['/auth/callback', 'Вход'],
  ['/survey', 'Оценка заявки'],
  ['/portal/requests', 'Заявка'],
  ['/portal', 'Портал заказчика'],
  ['/requests', 'Заявки'],
  ['/time-entries', 'Журнал трудозатрат'],
  ['/analytics', 'Аналитика и отчёты'],
  ['/act', 'Акт приёма-передачи'],
  ['/profile', 'Профиль'],
  ['/help', 'Справка и документация'],
  ['/admin/team', 'Команда'],
  ['/admin/catalog', 'Каталог данных'],
  ['/admin/system', 'Система'],
  ['/admin/users', 'Пользователи'],
  ['/admin/customers', 'Заказчики / Подразделения'],
  ['/admin/contractors', 'Подрядчики'],
  ['/admin/reports-ref', 'Реестр дашбордов / Отчётов'],
  ['/admin/data-sources', 'Источники данных'],
  ['/admin/lineage', 'Линейдж данных'],
  ['/admin/dictionaries', 'Справочники'],
  ['/admin/known-errors', 'База известных ошибок'],
  ['/admin/activity-logs', 'Журнал активности'],
  ['/admin/backup', 'Резервное копирование'],
  ['/admin/settings', 'Настройки системы'],
  ['/admin/acts', 'Акты приёма-передачи'],
];
ROUTE_TITLES.sort((a, b) => b[0].length - a[0].length);

function titleFor(pathname: string): string {
  const match = ROUTE_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : 'Главная';
}

/** Sets document.title on every navigation. Individual pages that show one specific
 *  entity (a request, a report) call useDocumentTitle to override this with the
 *  entity's own name once it loads. */
export default function PageTitleManager() {
  const location = useLocation();

  useEffect(() => {
    document.title = `${titleFor(location.pathname)} - ${BRAND}`;
  }, [location.pathname]);

  return null;
}
