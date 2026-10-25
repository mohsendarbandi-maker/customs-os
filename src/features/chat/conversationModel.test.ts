import { describe, expect, it } from 'vitest';
import { buildChatInboxRows, mergeChatConversationSources } from './conversationModel';
import type { ChatConversation } from './types';

const conversation = (
  overrides: Partial<ChatConversation> & Pick<ChatConversation, 'conversation_id'>,
): ChatConversation => ({
  conversation_id: overrides.conversation_id,
  type: overrides.type ?? 'group',
  title: overrides.title ?? overrides.conversation_id,
  updated_at: overrides.updated_at ?? '2026-10-24T08:00:00.000Z',
  last_message_id: overrides.last_message_id ?? null,
  last_message_body: overrides.last_message_body ?? null,
  last_message_created_at: overrides.last_message_created_at ?? null,
  unread_count: overrides.unread_count ?? 0,
  muted_until: overrides.muted_until ?? null,
  hierarchy_kind: overrides.hierarchy_kind ?? 'regular',
  parent_conversation_id: overrides.parent_conversation_id ?? null,
  cargo_owner_id: overrides.cargo_owner_id ?? null,
  shipment_id: overrides.shipment_id ?? null,
  shipment_display_name: overrides.shipment_display_name ?? null,
  shipment_bl_number: overrides.shipment_bl_number ?? null,
  shipment_status: overrides.shipment_status ?? null,
  display_name: overrides.display_name ?? null,
  display_phone: overrides.display_phone ?? null,
  display_user_id: overrides.display_user_id ?? null,
});

describe('chat inbox hierarchy model', () => {
  it('merges the regular and hierarchy RPC results by conversation ID', () => {
    const regular = conversation({
      conversation_id: 'shipment-1',
      title: 'پیش‌فرض',
      hierarchy_kind: 'regular',
    });
    const hierarchy = conversation({
      conversation_id: 'shipment-1',
      title: 'محموله جو',
      hierarchy_kind: 'shipment_group',
      parent_conversation_id: 'owner-1',
      shipment_id: 'cargo-1',
      unread_count: 2,
    });

    const result = mergeChatConversationSources([regular], [hierarchy]);

    expect(result).toHaveLength(1);
    expect(result[0].hierarchy_kind).toBe('shipment_group');
    expect(result[0].parent_conversation_id).toBe('owner-1');
    expect(result[0].unread_count).toBe(2);
  });

  it('places an owner with a new shipment message first and nests its shipment only once', () => {
    const rows = buildChatInboxRows([
      conversation({
        conversation_id: 'regular-1',
        title: 'گفتگوی معمولی',
        last_message_created_at: '2026-10-24T10:00:00.000Z',
      }),
      conversation({
        conversation_id: 'owner-1',
        title: 'صاحب کالا الف',
        hierarchy_kind: 'owner_group',
        last_message_created_at: '2026-10-24T07:00:00.000Z',
      }),
      conversation({
        conversation_id: 'shipment-1',
        title: 'محموله جو',
        hierarchy_kind: 'shipment_group',
        parent_conversation_id: 'owner-1',
        shipment_id: 'cargo-1',
        shipment_display_name: 'محموله جو',
        shipment_bl_number: 'BL-001',
        last_message_body: 'سند جدید بارگذاری شد',
        last_message_created_at: '2026-10-24T12:00:00.000Z',
        unread_count: 3,
      }),
    ]);

    expect(rows[0].kind).toBe('owner');
    if (rows[0].kind !== 'owner') throw new Error('Expected owner group first');

    expect(rows[0].owner.conversation_id).toBe('owner-1');
    expect(rows[0].unreadCount).toBe(3);
    expect(rows[0].unreadChildren).toBe(1);
    expect(rows[0].children.map((item) => item.conversation_id)).toEqual(['shipment-1']);
    expect(rows.some((row) => row.kind === 'conversation' && row.conversation.conversation_id === 'shipment-1')).toBe(false);
  });

  it('shows unread owner context if only one of its shipment chats has unread messages', () => {
    const rows = buildChatInboxRows([
      conversation({ conversation_id: 'owner-1', hierarchy_kind: 'owner_group', title: 'صاحب کالا الف' }),
      conversation({
        conversation_id: 'shipment-unread',
        hierarchy_kind: 'shipment_group',
        parent_conversation_id: 'owner-1',
        shipment_id: 'cargo-1',
        unread_count: 1,
        last_message_created_at: '2026-10-24T13:00:00.000Z',
      }),
      conversation({ conversation_id: 'owner-2', hierarchy_kind: 'owner_group', title: 'صاحب کالا ب' }),
    ], 'unread');

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('owner');
    if (rows[0].kind !== 'owner') throw new Error('Expected owner context');
    expect(rows[0].owner.conversation_id).toBe('owner-1');
    expect(rows[0].unreadCount).toBe(1);
    expect(rows[0].hasUnreadChildren).toBe(true);
  });

  it('filters regular conversations by folder without leaking shipment children into All', () => {
    const rows = buildChatInboxRows([
      conversation({ conversation_id: 'direct-1', type: 'direct' }),
      conversation({ conversation_id: 'group-1', type: 'group' }),
      conversation({ conversation_id: 'owner-1', hierarchy_kind: 'owner_group' }),
      conversation({ conversation_id: 'shipment-1', hierarchy_kind: 'shipment_group', parent_conversation_id: 'owner-1' }),
    ]);

    expect(rows.filter((row) => row.kind === 'conversation').map((row) => row.conversation.conversation_id).sort()).toEqual(['direct-1', 'group-1']);
    expect(buildChatInboxRows([
      conversation({ conversation_id: 'direct-1', type: 'direct' }),
      conversation({ conversation_id: 'group-1', type: 'group' }),
    ], 'groups').map((row) => row.kind === 'conversation' ? row.conversation.conversation_id : '')).toEqual(['group-1']);
  });
});
