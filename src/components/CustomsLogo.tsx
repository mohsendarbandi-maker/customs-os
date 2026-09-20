import React from 'react';

export const CustomsLogo: React.FC<{size?:number; className?:string; showWordmark?:boolean}> = ({size=44,className='',showWordmark=true}) => (
  <div className={`customs-logo inline-flex items-center shrink-0 ${className}`}>
    <img
      src="/logo.svg"
      alt="Customs OS"
      className="shrink-0 object-contain object-right"
      style={showWordmark ? {height:`${size}px`,width:'auto'} : {height:`${size}px`,width:`${size}px`}}
    />
  </div>
);
