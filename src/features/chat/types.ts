export type ChatConversation = {
  conversation_id: string;
  type: string;
  title: string | null;
  updated_at: string;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_created_at: string | null;
  unread_count: number;
  muted_until: string | null;
};

export type ChatMessage = {
  id: string;
  organization_id: string;
  conversation_id: string;
  sender_id: string;
  client_uuid: string;
  message_type: string;
  body: string | null;
  reply_to_message_id: string | null;
  forwarded_from_message_id: string | null;
  thread_root_message_id: string | null;
  delivery_status: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_for_all_at: string | null;
  created_at: string;
  updated_at: string;
};
