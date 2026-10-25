# Chat attachment scanning

Chat attachment security scanning is disabled by application configuration. Files are uploaded directly to their conversation-scoped storage path and become available as soon as the upload and attachment registration succeed. The scanner endpoint is inert, scan triggers are removed, and its scheduled job is disabled.

The application still enforces authenticated conversation membership, organization scoping, storage path validation, and the configured 50 MiB attachment size limit. It does not inspect file contents or claim that uploaded files are safe; users should only open files from trusted senders.
