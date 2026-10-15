import { ReactNode } from 'react';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';

export interface HubTab { key: string; label: ReactNode; element: ReactNode; hidden?: boolean }

/** One page, several related sections as tabs. The active tab lives in the URL (?tab=...). */
export default function TabsHub({ tabs }: { tabs: HubTab[] }) {
  const [params, setParams] = useSearchParams();
  const visible = tabs.filter(t => !t.hidden);
  const requested = params.get('tab');
  const active = visible.some(t => t.key === requested) ? requested! : visible[0]?.key;

  return (
    <Tabs
      size="large"
      activeKey={active}
      destroyInactiveTabPane
      onChange={(key) => setParams(key === visible[0].key ? {} : { tab: key }, { replace: true })}
      items={visible.map(t => ({ key: t.key, label: t.label, children: t.element }))}
    />
  );
}
