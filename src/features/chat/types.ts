export type ChatConversationType = 'direct' | 'group' | 'company_channel' | 'related' | 'shared_company';
export type ChatMemberRole = 'owner' | 'admin' | 'member' | 'guest';
export type ChatMessageType = 'text' | 'system' | 'file' | 'voice';
export type ChatDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatConversation {
  conversation_id: string;
  type: ChatConversationType;
  title: string | null;
  updated_at: string;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_created_at: string | null;
  unread_count: number;
  muted_until: string | null;
}

export interface ChatMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  sender_id: string;
  client_uuid: string;
  message_type: ChatMessageType;
  body: string | null;
  reply_to_message_id: string | null;
  forwarded_from_message_id: string | null;
  thread_root_message_id: string | null;
  delivery_status: ChatDeliveryStatus;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_for_all_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMember {
  id: string;
  organization_id: string;
  conversation_id: string;
  user_id: string;
  role: ChatMemberRole;
  muted_until: string | null;
  last_read_message_id: string | null;
  joined_at: string;
  left_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatAttachment {
  id: string;
  organization_id: string;
  conversation_id: string;
  message_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  waveform: number[] | null;
  security_status: 'scanning' | 'clean' | 'blocked';
  security_checked_at: string | null;
  security_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ChatSearchResult {
  kind: 'message' | 'file' | 'person';
  id: string;
  conversation_id: string;
  title: string;
  snippet: string;
  created_at: string;
}

export interface PendingSend {
  clientUuid: string;
  body: string;
  createdAt: string;
  queued: boolean;
}
