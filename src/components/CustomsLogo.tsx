import React from 'react';

type CustomsLogoProps = { size?: number; className?: string; showWordmark?: boolean };

/** Compact geometric line mark: globe meridians, warehouse roof and cargo vessel. */
export const CustomsLogo: React.FC<CustomsLogoProps> = ({ size = 40, className = '', showWordmark = true }) => {
  const mark = Math.max(28, Math.min(size, 52));
  return (
    <span className={`customs-logo ${className}`} aria-label="Customs OS">
      <span className="customs-logo__mark" style={{ width: mark, height: mark }} aria-hidden="true">
        <svg viewBox="0 0 48 48" width="100%" height="100%" focusable="false" fill="none">
          <defs><linearGradient id="customs-line-logo" x1="7" y1="4" x2="41" y2="44" gradientUnits="userSpaceOnUse"><stop stopColor="#1E88E5"/><stop offset="1" stopColor="#0A4D8C"/></linearGradient></defs>
          <rect x="1" y="1" width="46" height="46" rx="13" fill="var(--surface)" stroke="var(--border)"/>
          <circle cx="24" cy="22" r="15" stroke="url(#customs-line-logo)" strokeWidth="1.5"/>
          <path d="M9.5 22h29M24 7c-5 4-7 9-7 15s2 11 7 15M24 7c5 4 7 9 7 15s-2 11-7 15M12 14h24M12 30h24" stroke="url(#customs-line-logo)" strokeWidth="1.1" strokeLinecap="round"/>
          <path d="M9 31h30l-4 5H14l-5-5Z" fill="#0A4D8C" stroke="#0A4D8C" strokeLinejoin="round"/>
          <path d="M14 29V24l6-3 6 3v5M14 25h12M17 27h2m3 0h2" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M7 39c4-1.6 6-1.6 10 0s6 1.6 10 0 6-1.6 10 0 4 1.6 5 1.2" stroke="#18B6C9" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </span>
      {showWordmark && <span className="customs-logo__wordmark"><strong>CUSTOMS OS</strong><small>CUSTOMS &amp; LOGISTICS MANAGEMENT</small></span>}
    </span>
  );
};
