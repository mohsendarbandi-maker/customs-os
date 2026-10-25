import type { ChatConversation } from './types';

export type ChatFolder = 'all' | 'coworkers' | 'groups' | 'owners' | 'shipments' | 'unread';

export type ChatInboxConversationRow = {
  kind: 'conversation';
  conversation: ChatConversation;
  unreadCount: number;
  activityAt: number;
};

export type ChatInboxOwnerRow = {
  kind: 'owner';
  owner: ChatConversation;
  children: ChatConversation[];
  unreadCount: number;
  unreadChildren: number;
  hasUnreadChildren: boolean;
  activityAt: number;
};

export type ChatInboxRow = ChatInboxConversationRow | ChatInboxOwnerRow;

const unreadCountOf = (conversation: ChatConversation) => Math.max(0, Number(conversation.unread_count) || 0);

export function chatConversationActivityTime(conversation: ChatConversation): number {
  const timestamp = conversation.last_message_created_at || conversation.updated_at;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}

/** Prefer the server-provided hierarchy metadata when the same conversation is returned twice. */
export function mergeChatConversationSources(
  regular: ChatConversation[],
  hierarchical: ChatConversation[],
): ChatConversation[] {
  const byId = new Map<string, ChatConversation>();

  for (const conversation of regular) {
    byId.set(conversation.conversation_id, conversation);
  }

  for (const conversation of hierarchical) {
    const existing = byId.get(conversation.conversation_id);
    byId.set(conversation.conversation_id, {
      ...existing,
      ...conversation,
      display_name: conversation.display_name ?? existing?.display_name ?? null,
      display_phone: conversation.display_phone ?? existing?.display_phone ?? null,
      display_user_id: conversation.display_user_id ?? existing?.display_user_id ?? null,
    });
  }

  return [...byId.values()].sort((a, b) => {
    const aOwner = a.hierarchy_kind === 'owner_group';
    const bOwner = b.hierarchy_kind === 'owner_group';
    if (aOwner !== bOwner) return aOwner ? -1 : 1;
    return chatConversationActivityTime(b) - chatConversationActivityTime(a);
  });
}

/** Builds one inbox row per conversation context; shipment chats only live below their owner group. */
export function buildChatInboxRows(
  conversations: ChatConversation[],
  folder: ChatFolder = 'all',
): ChatInboxRow[] {
  const owners = conversations.filter((item) => item.hierarchy_kind === 'owner_group');
  const childrenByOwner = new Map<string, ChatConversation[]>();

  for (const item of conversations) {
    if (item.hierarchy_kind !== 'shipment_group' || !item.parent_conversation_id) continue;
    const children = childrenByOwner.get(item.parent_conversation_id) ?? [];
    children.push(item);
    childrenByOwner.set(item.parent_conversation_id, children);
  }

  for (const children of childrenByOwner.values()) {
    children.sort((a, b) => {
      const unread = unreadCountOf(b) - unreadCountOf(a);
      return unread || chatConversationActivityTime(b) - chatConversationActivityTime(a);
    });
  }

  const ownerRows: ChatInboxOwnerRow[] = owners.map((owner) => {
    const children = childrenByOwner.get(owner.conversation_id) ?? [];
    const childUnread = children.reduce((total, item) => total + unreadCountOf(item), 0);
    const unreadChildren = children.filter((item) => unreadCountOf(item) > 0).length;
    const activityAt = Math.max(
      chatConversationActivityTime(owner),
      ...children.map(chatConversationActivityTime),
    );

    return {
      kind: 'owner',
      owner,
      children,
      unreadCount: unreadCountOf(owner) + childUnread,
      unreadChildren,
      hasUnreadChildren: unreadChildren > 0,
      activityAt,
    };
  }).filter((row) => {
    if (folder === 'groups' || folder === 'coworkers') return false;
    if (folder === 'unread') return row.unreadCount > 0;
    return true;
  });

  const regular = conversations.filter((item) => {
    if (item.hierarchy_kind === 'owner_group' || item.hierarchy_kind === 'shipment_group') return false;
    if (folder === 'owners' || folder === 'shipments') return false;
    if (folder === 'coworkers') return item.type === 'direct';
    if (folder === 'groups') return ['group', 'company_channel', 'shared_company'].includes(item.type);
    if (folder === 'unread') return unreadCountOf(item) > 0;
    return true;
  });

  const conversationRows: ChatInboxConversationRow[] = regular.map((conversation) => ({
    kind: 'conversation',
    conversation,
    unreadCount: unreadCountOf(conversation),
    activityAt: chatConversationActivityTime(conversation),
  }));

  const rows: ChatInboxRow[] = [...conversationRows, ...ownerRows];
  return rows.sort((a, b) => {
    const unread = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
    return unread || b.activityAt - a.activityAt;
  });
}
