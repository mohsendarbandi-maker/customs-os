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
  display_name?: string | null;
  display_phone?: string | null;
  display_user_id?: string | null;
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
  sender_name?: string | null;
  attachments?: ChatAttachment[];
};


export type ChatAttachment = {
  id: string;
  message_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  waveform: unknown;
  security_status: string;
  security_checked_at: string | null;
  security_error: string | null;
  url: string | null;
};
