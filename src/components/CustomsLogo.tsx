import React from 'react';

export const CustomsLogo: React.FC<{size?:number; className?:string; showWordmark?:boolean}> = ({size=40,className='',showWordmark=false}) => (
  <div className={`customs-logo inline-flex items-center gap-2 ${className}`}>
    <span
      className="customs-logo-mark relative grid place-items-center shrink-0 overflow-hidden"
      style={{width:size,height:size,borderRadius:Math.round(size*0.28)}}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width={size*0.68} height={size*0.68} fill="none">
        <path d="M12 17h40v23H12z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/>
        <path d="M12 26h40M25 17v9M39 17v9" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
        <path d="M8 46c6-4 11-4 17 0s11 4 17 0 11-4 17 0" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
        <path d="M19 52c4-2 8-2 12 0s8 2 12 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".72"/>
      </svg>
    </span>
    {showWordmark && <span className="leading-none"><span className="block font-black tracking-tight">Customs OS</span><span className="block text-[9px] opacity-70 mt-1">Customs & Logistics</span></span>}
  </div>
);
