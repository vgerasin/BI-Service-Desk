import { SettingOutlined, UnorderedListOutlined, AuditOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import TabsHub from '../../components/TabsHub';
import SettingsPage from './SettingsPage';
import DictionariesPage from './DictionariesPage';
import ActivityLogsPage from './ActivityLogsPage';
import BackupPage from './BackupPage';

/** «Система»: settings & integrations, dictionaries, activity log, backups. */
export default function SystemPage() {
  return (
    <TabsHub
      tabs={[
        { key: 'settings', label: <span><SettingOutlined /> Настройки</span>, element: <SettingsPage /> },
        { key: 'dictionaries', label: <span><UnorderedListOutlined /> Словари</span>, element: <DictionariesPage /> },
        { key: 'activity', label: <span><AuditOutlined /> Журнал активности</span>, element: <ActivityLogsPage /> },
        { key: 'backup', label: <span><CloudDownloadOutlined /> Резервные копии</span>, element: <BackupPage /> },
      ]}
    />
  );
}
