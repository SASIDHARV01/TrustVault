type BrandMarkProps = {
  compact?: boolean;
};

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <span className="brand" aria-label="TrustVault">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="img">
          <path d="M16 2.75 27 7v8.2c0 6.72-4.47 11.86-11 14.05C9.47 27.06 5 21.92 5 15.2V7l11-4.25Z" />
          <path d="m11.4 16.1 3.05 3.05 6.35-7" />
        </svg>
      </span>
      {!compact && <span>TrustVault</span>}
    </span>
  );
}
