import React from 'react';

export const CustomsLogo: React.FC<{size?:number; className?:string; showWordmark?:boolean}> = ({size=40,className='',showWordmark=false}) => (
  <div className={`customs-logo inline-flex items-center gap-2.5 ${className}`}>
    <img src="/icon.svg" alt="Customs OS" width={size} height={size} className="shrink-0 rounded-[28%] object-cover shadow-lg" />
    {showWordmark && <span className="leading-none"><span className="block font-black tracking-tight">Customs OS</span><span className="block text-[9px] opacity-70 mt-1">Customs & Logistics Management</span></span>}
  </div>
);
