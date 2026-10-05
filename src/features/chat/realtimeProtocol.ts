export type RealtimeMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  message_type: string;
  created_at: string;
  updated_at: string;
};

export type RealtimeReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type RealtimeRead = {
  message_id: string;
  user_id: string;
  status: string;
  read_at: string | null;
  delivered_at: string | null;
};

export type RealtimeTyping = {
  user_id: string;
  typing: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

export function parseRealtimeMessage(value: unknown): RealtimeMessage | null {
  const root = record(value);
  const source = root ? record(root.record) : null;
  if (!source) return null;
  const id = stringField(source,'id');
  const conversationId = stringField(source,'conversation_id');
  const senderId = stringField(source,'sender_id');
  const messageType = stringField(source,'message_type');
  const createdAt = stringField(source,'created_at');
  const updatedAt = stringField(source,'updated_at');
  if (!id || !conversationId || !senderId || !messageType || !createdAt || !updatedAt) return null;
  const bodyValue = source.body;
  return {
    id,
    conversation_id: conversationId,
    sender_id: senderId,
    body: typeof bodyValue === 'string' ? bodyValue : null,
    message_type: messageType,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function parseRealtimeReaction(value: unknown): {record: RealtimeReaction; operation: 'insert'|'update'|'delete'} | null {
  const root = record(value);
  const source = root ? record(root.record) : null;
  if (!source) return null;
  const id = stringField(source,'id');
  const messageId = stringField(source,'message_id');
  const userId = stringField(source,'user_id');
  const emoji = stringField(source,'emoji');
  const createdAt = stringField(source,'created_at');
  const operationValue = stringField(root ?? {},'operation');
  if (!id || !messageId || !userId || !emoji || !createdAt) return null;
  const operation: 'insert'|'update'|'delete' =
    operationValue === 'insert' || operationValue === 'delete' || operationValue === 'update'
      ? operationValue
      : 'update';
  return {
    record: {
      id,
      message_id: messageId,
      user_id: userId,
      emoji,
      created_at: createdAt,
    },
    operation,
  };
}

export function parseRealtimeRead(value: unknown): RealtimeRead | null {
  const root = record(value);
  const source = root ? record(root.record) : null;
  if (!source) return null;
  const messageId = stringField(source,'message_id');
  const userId = stringField(source,'user_id');
  const status = stringField(source,'status');
  if (!messageId || !userId || !status) return null;
  const readAtValue = source.read_at;
  const deliveredAtValue = source.delivered_at;
  return {
    message_id: messageId,
    user_id: userId,
    status,
    read_at: typeof readAtValue === 'string' ? readAtValue : null,
    delivered_at: typeof deliveredAtValue === 'string' ? deliveredAtValue : null,
  };
}

export function parseRealtimeTyping(value: unknown): RealtimeTyping | null {
  const root = record(value);
  if (!root) return null;
  const userId = stringField(root,'user_id');
  const typingValue = root.typing;
  if (!userId || typeof typingValue !== 'boolean') return null;
  return {user_id:userId,typing:typingValue};
}
