import { APP_NAME } from '../branding';

/** Neutral logo: a rounded square with three bars + the product name. Replace with your own logo if you like. */
export function BrandIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="64" height="64" rx="14" fill="#007AFF" />
      <g fill="#fff">
        <rect x="14" y="34" width="8" height="16" rx="2" />
        <rect x="28" y="22" width="8" height="28" rx="2" />
        <rect x="42" y="12" width="8" height="38" rx="2" />
      </g>
    </svg>
  );
}

export default function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <>
      <BrandIcon />
      <div style={{ lineHeight: 1.2 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', whiteSpace: 'nowrap', letterSpacing: 0.2 }}>
          {APP_NAME}
        </div>
        {subtitle && <div style={{ fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap' }}>{subtitle}</div>}
      </div>
    </>
  );
}
