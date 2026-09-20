import React from 'react';

export const CustomsLogo: React.FC<{size?:number; className?:string; showWordmark?:boolean}> = ({size=40,className='',showWordmark=false}) => (
  <div className={`customs-logo inline-flex items-center ${className}`}>
    <img src="/logo.svg" alt="Customs OS" width={showWordmark ? Math.round(size * 3.45) : size} height={size} className="shrink-0 object-contain" />
  </div>
);
