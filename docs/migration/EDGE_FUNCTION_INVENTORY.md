# Deployed Supabase Edge Function Inventory

This inventory was collected from the live Supabase Edge Function management API on 2026-11-22. It records dependency names and object/table references only. It intentionally does not copy function source, hard-coded identifiers, hashes, secret values, or credentials into Git.

| Function | Deployed version | Local source folder | Main dependency areas | External services / secret names |
|---|---:|---|---|---|
| customs-circular-ingestor | 5 | Missing | knowledge_sources, customs-knowledge, knowledge_page_extractions | SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY; IranImpex, Telegram |
| knowledge-ai | 92 | Present | profiles, knowledge_sources, customs-knowledge, knowledge_page_extractions, knowledge_chunks | GEMINI_API_KEY, Supabase credentials; Gemini API |
| ai-assistant | 146 | Present | shipments, clients, cases, declarations, shipment documents/extractions, finance, vessels, file manager, reminders, registration orders, knowledge, AI interactions | OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, Cloudflare AI tokens |
| knowledge-memory-worker | 21 | Missing | knowledge_page_extractions, knowledge_chunks, knowledge_sources, messenger_connections/chats, knowledge_worker_state | Supabase service credentials, Gemini; Telegram |
| sync-vessel-ais-v2 | 14 | Missing | vessels | OPENWATERS_API_TOKEN; AIS provider |
| release-quarantined-chat-files | 3 | Missing | No direct table references detected in entrypoint | No environment variables detected in entrypoint |
| ai-operator | 83 | Present | Customs workflow, finance, documents, reminders, registration orders, profiles, audit logs, permit rules and owner settings | OPENROUTER_API_KEY, OPENAI_API_KEY, Cloudflare AI tokens |
| scan-chat-file | 75 | Present | RPC internal_get_reminder_secret | Supabase service credentials |
| send-reminders | 73 | Present | reminders, notification preferences, customs declaration workflow/checklists, permits, profiles, push subscriptions | Supabase service credentials; VAPID/web-push package |
| owner-console | 89 | Present | profiles, organization settings, finance settings, AI gateway settings, organizations | Supabase service credentials / secret key set |
| messenger-gateway | 88 | Present | chat, messenger connections, shipment files, file manager, Telegram archive, delivery outbox, webhook events, file transfer and share tokens | Telegram Bot API, Bale, Meta Graph; Supabase service credentials |
| send-chat-push | 70 | Present | chat conversation members, notification outbox/preferences, push subscriptions | Supabase service credentials; VAPID/web-push package |
| ai-core | 92 | Present | customs operations, documents/extractions, reminders, finance, registration orders, AI interactions, knowledge, action proposals and risk findings | Gemini, Cloudflare AI, Groq, OpenRouter, OpenAI |
| ai-voice | 2 | Missing | profiles, customs_documents | Groq, Cloudflare AI, OpenAI; Supabase service credentials |
| sync-vessel-ais | 8 | Present | vessels | AIS Friends |
| vessel-multi-source | 8 | Missing | No direct table references detected in entrypoint | VesselFinder, MyShipTracking, Maritime Optima, MagicPort |

## Findings and migration implications

1. There are 16 deployed functions, but only 9 have matching local function folders in the repository (excluding the shared folder). Seven deployed functions need source recovery and review before a complete code migration.
2. The largest business-critical surfaces are messenger-gateway, ai-operator, ai-assistant, ai-core, knowledge-memory-worker and send-reminders. These must be migrated in dependency order, not copied as a single opaque bundle.
3. Functions rely heavily on PostgreSQL tables, RPCs, Vault-backed secrets and Supabase Auth. Replacing the database requires porting the underlying data model and authorization contracts before these functions can run independently.
4. Some functions use external APIs and provider secrets. Only the secret variable names are inventoried here; secret values must be re-created as Cloudflare Worker secrets by the owner and must never be committed to Git.
5. Deployed function versions differ from local repository history. The deployed source is the reference for behavior, while local migrations/tests remain necessary for reconstructing the database contracts.
6. Function source recovery is not the same as migration: each function still needs Deno-to-Workers compatibility review, provider adapter changes, idempotency/retry behavior, tenant authorization tests, and integration tests against the target schema.
7. Do not disable or delete the Supabase functions until Cloudflare equivalents pass staging tests and production cutover is explicitly approved.
