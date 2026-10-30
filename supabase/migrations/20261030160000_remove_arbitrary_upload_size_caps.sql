-- Do not impose per-bucket upload caps in the application.
-- The project-level Storage limit and provider/runtime constraints remain authoritative.
update storage.buckets
set file_size_limit = null
where id in ('chat-files','office-documents');
