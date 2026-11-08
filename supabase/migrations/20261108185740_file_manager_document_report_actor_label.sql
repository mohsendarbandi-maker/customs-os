alter table public.file_manager_document_reports
  add column if not exists actor_name text not null default 'کارمند';
