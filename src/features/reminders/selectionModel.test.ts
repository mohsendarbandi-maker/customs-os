import {describe,expect,it} from 'vitest';
import {areAllVisibleReminderIdsSelected,deselectVisibleReminderIds,selectableReminderIds,selectVisibleReminderIds,toggleReminderSelection} from './selectionModel';

describe('reminder bulk selection',()=>{
 it('exposes only server-backed reminders for bulk actions',()=>{
  expect(selectableReminderIds([{id:'r-1'},{id:'local-draft-1'},{id:'r-2'}])).toEqual(['r-1','r-2']);
 });
 it('toggles a selected reminder on and off without mutating the input',()=>{
  const selected=['r-1'];
  expect(toggleReminderSelection(selected,'r-2')).toEqual(['r-1','r-2']);
  expect(toggleReminderSelection(selected,'r-1')).toEqual([]);
  expect(selected).toEqual(['r-1']);
 });
 it('does not allow a local-only draft to enter server bulk selection',()=>{
  expect(toggleReminderSelection(['r-1'],'local-draft-1')).toEqual(['r-1']);
  expect(selectVisibleReminderIds(['r-1'],['r-1','r-2','local-draft-1'])).toEqual(['r-1','r-2']);
 });
 it('adds every visible id once and preserves previous selections',()=>{
  expect(selectVisibleReminderIds(['r-2','r-1'],['r-1','r-3','r-3'])).toEqual(['r-2','r-1','r-3']);
 });
 it('recognizes when all visible eligible reminders are selected',()=>{
  expect(areAllVisibleReminderIdsSelected(['r-1','r-2'],['r-1','r-2','local-draft-1'])).toBe(true);
  expect(areAllVisibleReminderIdsSelected(['r-1'],['r-1','r-2'])).toBe(false);
  expect(areAllVisibleReminderIdsSelected(['r-1'],['local-draft-1'])).toBe(false);
 });
 it('deselects only the current visible page and preserves unrelated IDs',()=>{
  expect(deselectVisibleReminderIds(['r-old','r-1','r-2'],['r-1','r-2','local-draft-1'])).toEqual(['r-old']);
 });

});
