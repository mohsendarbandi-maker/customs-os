import React from 'react';
import {Link2} from 'lucide-react';
import {Link} from 'react-router-dom';
import {CaseAlertPanel} from './CaseAlertPanel';
import {ControlCenterPage} from './ControlCenterPage';

export const ControlCenterWithAlertsPage:React.FC=()=> <><div dir="rtl" className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 pt-4"><Link to="/shipment-case-link" className="inline-flex items-center gap-2 rounded-xl border app-border bg-[var(--surface)] px-4 py-2.5 text-sm font-bold hover:opacity-80"><Link2 size={16}/> اتصال محموله‌های بدون پرونده</Link></div><CaseAlertPanel/><ControlCenterPage/></>;
