import React from 'react';

type CustomsLogoProps = {
  size?: number;
  className?: string;
  showWordmark?: boolean;
};

export const CustomsLogo: React.FC<CustomsLogoProps> = ({
  size = 44,
  className = '',
  showWordmark = true,
}) => {
  const markSize = size;
  const width = showWordmark ? Math.round(size * 4.286) : markSize;

  return (
    <span
      className={`customs-logo inline-flex shrink-0 items-center ${className}`}
      style={{ width, height: markSize, minWidth: width, maxWidth: width }}
      aria-label="Customs OS"
    >
      <svg
        viewBox="0 0 240 56"
        width="100%"
        height="100%"
        role="img"
        aria-hidden="true"
        preserveAspectRatio="xMinYMid meet"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <rect x="2" y="2" width="52" height="52" rx="14" fill="#0F4C81" />
        <path d="M11 35h34M15 30h26M18 25h20M21 20h14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="M12 39h32" stroke="#22B8CF" strokeWidth="3" strokeLinecap="round" />
        <path d="M28 10v8" stroke="#22B8CF" strokeWidth="3" strokeLinecap="round" />
        <circle cx="28" cy="9" r="3" fill="#22B8CF" />
        {showWordmark && (
          <>
            <text x="66" y="30" fontFamily="Arial, Helvetica, sans-serif" fontSize="22" fontWeight="800" letterSpacing="1" fill="#0F4C81">
              CUSTOMS OS
            </text>
            <text x="67" y="46" fontFamily="Arial, Helvetica, sans-serif" fontSize="9" fontWeight="600" letterSpacing=".7" fill="#64748B">
              CUSTOMS &amp; LOGISTICS
            </text>
          </>
        )}
      </svg>
    </span>
  );
};