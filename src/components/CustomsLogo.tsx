import React from 'react';

type CustomsLogoProps = {
  size?: number;
  className?: string;
  showWordmark?: boolean;
};

export const CustomsLogo: React.FC<CustomsLogoProps> = ({
  size = 38,
  className = '',
  showWordmark = true,
}) => {
  const mark = Math.max(28, Math.min(size, 64));

  return (
    <span
      className={`customs-logo ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: showWordmark ? 10 : 0,
        height: mark,
        width: showWordmark ? 'auto' : mark,
        minWidth: mark,
        maxWidth: '100%',
        flex: '0 0 auto',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
      aria-label="Customs OS"
    >
      <svg
        width={mark}
        height={mark}
        viewBox="0 0 48 48"
        role="img"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', flex: '0 0 48px', width: mark, height: mark }}
      >
        <rect x="2" y="2" width="44" height="44" rx="11" fill="#0F4C81" />
        <path d="M11 33.5h26M14 28.5h20M17 23.5h14M20 18.5h8" fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" />
        <path d="M11 38h26" fill="none" stroke="#22B8CF" strokeWidth="2.7" strokeLinecap="round" />
        <path d="M24 9.5v6.5" fill="none" stroke="#22B8CF" strokeWidth="2.7" strokeLinecap="round" />
        <circle cx="24" cy="8" r="2" fill="#22B8CF" />
      </svg>

      {showWordmark && (
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 0,
            flex: '0 1 auto',
            lineHeight: 1,
          }}
        >
          <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: Math.max(14, mark * 0.47), fontWeight: 800, letterSpacing: '.65px', color: 'var(--text)' }}>
            CUSTOMS OS
          </span>
          <span style={{ marginTop: 4, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: Math.max(6, mark * 0.19), fontWeight: 700, letterSpacing: '.45px', color: 'var(--text-muted)' }}>
            CUSTOMS &amp; LOGISTICS
          </span>
        </span>
      )}
    </span>
  );
};