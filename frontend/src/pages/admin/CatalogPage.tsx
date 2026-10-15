import { ProjectOutlined, DatabaseOutlined, ApartmentOutlined, BugOutlined } from '@ant-design/icons';
import TabsHub from '../../components/TabsHub';
import ReportsRegistryPage from './ReportsRegistryPage';
import DataSourcesPage from './DataSourcesPage';
import LineagePage from './LineagePage';
import KnownErrorsPage from './KnownErrorsPage';

/** «Каталог данных»: reports registry, data sources, lineage graph and the known-errors base. */
export default function CatalogPage() {
  return (
    <TabsHub
      tabs={[
        { key: 'reports', label: <span><ProjectOutlined /> Реестр отчётов</span>, element: <ReportsRegistryPage /> },
        { key: 'sources', label: <span><DatabaseOutlined /> Источники данных</span>, element: <DataSourcesPage /> },
        { key: 'lineage', label: <span><ApartmentOutlined /> Линейдж</span>, element: <LineagePage /> },
        { key: 'errors', label: <span><BugOutlined /> База ошибок</span>, element: <KnownErrorsPage /> },
      ]}
    />
  );
}
