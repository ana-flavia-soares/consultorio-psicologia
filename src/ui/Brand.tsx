import { brand, brandInitials } from '../config.ts';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" style={compact ? { padding: 0 } : undefined}>
      <span className="brand-mark" aria-hidden="true">{brandInitials()}</span>
      <span className="stack" style={{ gap: 2 }}>
        <span className="brand-name">{brand.name}</span>
        <span className="brand-role">{brand.role}</span>
      </span>
    </div>
  );
}
