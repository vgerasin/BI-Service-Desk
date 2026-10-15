import { useState } from 'react';
import { Typography } from 'antd';
import { EyeOutlined } from '@ant-design/icons';

const { Text } = Typography;

export const TECH_COLOR = '#007AFF';

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '28px 0 12px' }}>
      <div style={{ width: 4, height: 20, background: TECH_COLOR, borderRadius: 2 }} />
      <Text strong style={{ fontSize: 15, color: TECH_COLOR }}>{children}</Text>
    </div>
  );
}

/**
 * Placeholder for documentation screenshots. The repository ships without them (they were
 * taken from a private deployment); drop PNGs into frontend/public/docs and set `src` to show one.
 */
export function Screenshot({ label, src }: { label: string; src?: string; height?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <figure style={{ margin: '10px 0 22px' }}>
      <img
        src={src}
        alt={label}
        onError={() => setFailed(true)}
        style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 10, border: '1px solid #e4eaf2' }}
      />
      <figcaption style={{ marginTop: 6, fontSize: 12, color: '#90a5c0', textAlign: 'center' }}>{label}</figcaption>
    </figure>
  );
}

export function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', background: TECH_COLOR,
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1,
      }}>{num}</div>
      <div style={{ flex: 1 }}>
        <Text strong style={{ fontSize: 14 }}>{title}</Text>
        <div style={{ marginTop: 6 }}>{children}</div>
      </div>
    </div>
  );
}
