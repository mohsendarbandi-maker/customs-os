import React from 'react';

type CustomsLogoProps = {
  size?: number;
  className?: string;
  showWordmark?: boolean;
};

/** Stable brand mark: the icon is isolated from the wordmark so it can never
 * participate in the layout sizing of navigation icons or mobile controls. */
export const CustomsLogo: React.FC<CustomsLogoProps> = ({ size = 40, className = '', showWordmark = true }) => {
  const mark = Math.max(28, Math.min(size, 52));

  return (
    <span className={`customs-logo ${className}`} aria-label="Customs OS">
      <span className="customs-logo__mark" style={{ width: mark, height: mark }} aria-hidden="true">
        <svg viewBox="0 0 48 48" width="100%" height="100%" focusable="false">
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#0b568f" />
          <path d="M10 34h28M13 29h22M16 24h16M19 19h10" fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" />
          <path d="M10 39h28" stroke="#22b8cf" strokeWidth="2.7" strokeLinecap="round" />
          <path d="M24 9v7" stroke="#22b8cf" strokeWidth="2.7" strokeLinecap="round" />
          <circle cx="24" cy="8" r="2" fill="#22b8cf" />
        </svg>
      </span>
      {showWordmark && (
        <span className="customs-logo__wordmark">
          <strong>CUSTOMS OS</strong>
          <small>CUSTOMS &amp; LOGISTICS</small>
        </span>
      )}
    </span>
  );
};
