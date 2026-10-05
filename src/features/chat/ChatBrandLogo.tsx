import React from 'react';

export const ChatBrandLogo: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <div
    aria-label="لوگوی چت سازمانی"
    className="shrink-0 grid place-items-center rounded-2xl"
    style={{
      width: size,
      height: size,
      background: 'linear-gradient(145deg,#0b7ea4,#075a78)',
      boxShadow: '0 10px 26px rgba(11,126,164,.22)',
    }}
  >
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M10 15.5A7.5 7.5 0 0 1 17.5 8h29A7.5 7.5 0 0 1 54 15.5v22A7.5 7.5 0 0 1 46.5 45H31l-10.5 8 2-8h-5A7.5 7.5 0 0 1 10 37.5v-22Z"
        fill="white"
        fillOpacity=".96"
      />
      <circle cx="22" cy="26.5" r="3.2" fill="#0b7ea4" />
      <circle cx="32" cy="26.5" r="3.2" fill="#0b7ea4" />
      <circle cx="42" cy="26.5" r="3.2" fill="#0b7ea4" />
      <path d="M18 36c4.3 3.6 8.9 5.4 14 5.4S41.7 39.6 46 36" stroke="#0b7ea4" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  </div>
);
