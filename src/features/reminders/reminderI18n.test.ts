import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {formatReminderDate,formatReminderDateTime,reminderNumber,reminderText,ReminderLocaleTree} from './reminderI18n';

describe('reminder bilingual presentation',()=>{
 it('translates core actions and removes literal newline escape artifacts',()=>{
  expect(reminderText('یادآورها','en')).toBe('Reminders');
  expect(reminderText('ثبت یادآور','en')).toBe('Create reminder');
  expect(reminderText('یادآور جدید\n\nبدون سررسید','fa')).toBe('یادآور جدید بدون سررسید');
  expect(reminderText('یادآور جدید\\n\\nبدون سررسید','fa')).toBe('یادآور جدید بدون سررسید');
  expect(reminderText('یادآور جدید\n\nبدون سررسید','en')).toBe('New reminder No due date');
  expect(reminderText('یادآور جدید\\n\\nبدون سررسید','en')).toBe('New reminder No due date');
 });
 it('translates interface strings but preserves user-entered reminder data verbatim',()=>{
  const html=renderToStaticMarkup(React.createElement(ReminderLocaleTree,{language:'en'},
   React.createElement(React.Fragment,null,
    React.createElement('h1',null,'یادآورها'),
    React.createElement('p',{'data-user-content':'true',dir:'auto'},'پیگیری محموله اسناد'),
    React.createElement('p',{'data-user-content':'true',dir:'auto'},'شرکت دربندی')
   )
  ));
  expect(html).toContain('Reminders');
  expect(html).toContain('پیگیری محموله اسناد');
  expect(html).toContain('شرکت دربندی');
  expect(html).not.toContain('Shipment Documents');
 });
 it('formats the same instant using the Jalali calendar in the Tehran timezone',()=>{
  const date=new Date('2026-03-21T08:30:00.000Z');
  expect(formatReminderDate(date,'fa')).toContain('۱۴۰۵');
  expect(formatReminderDate(date,'en')).toContain('1405');
  expect(formatReminderDateTime(date,'en')).toContain('·');
  expect(reminderNumber(1234,'fa')).toBe('۱٬۲۳۴');
  expect(reminderNumber(1234,'en')).toBe('1,234');
 });
});
