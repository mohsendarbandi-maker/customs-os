# Customs OS — Cloudflare Migration Plan

Status: staging foundation only. Production remains on the existing Cloudflare Worker + Supabase services.

## Verified source inventory
- Repository: mohsendarbandi-maker/customs-os
- Source branch: main
- Source commit audited: 5cba78a125366320ec7ab831b317992dd3f80cb3
- Frontend: React 18 + Vite + TypeScript + PWA.
- Existing edge runtime: Cloudflare Worker customs, configured in wrangler.jsonc.
- Existing Worker proxies Supabase Auth, PostgREST, Storage, Realtime and Edge Functions.
- Supabase project: bjngfgiecvihofemptub, region eu-west-1, PostgreSQL 17.
- Repository contains 294 SQL migration files and 10 local Edge Function folders (including shared code); Supabase currently reports 16 active deployed Edge Functions.
- Supabase Management API reports ACTIVE_HEALTHY, but database SQL/migration APIs return PostgreSQL 57P03: database system is not accepting connections; Hot standby mode is disabled. Treat source DB as unavailable until read-only access or a provider backup is verified.
- Existing Cloudflare Workers customs and long-cell-b587 are present. Do not overwrite either during staging.

## Target architecture under evaluation
| Concern | Candidate | Migration rule |
| Web/PWA + API | Existing Cloudflare Worker + Static Assets | Keep current production Worker and routes unchanged |
| Operational relational data | Cloudflare D1 (SQLite) | Port PostgreSQL schema, constraints, triggers, RLS and RPC behavior explicitly; no direct PostgreSQL dump import |
| Documents and binary files | Cloudflare R2 | Enable bucket first; upload via short-lived signed URLs; store metadata separately |
| Background work | Workers Queues + Cron Triggers / Workflows | Preserve retries, idempotency and durable checkpoints |
| Authentication | Separate design decision | Supabase Auth is not replaced by D1; implement and test an independent identity/session system before cutover |
| Knowledge search / AI | Worker adapters and external providers | Preserve provider keys as Worker secrets; keep quotas and provider fallback explicit |
| Telegram archive | Existing archive flow during transition | Do not make Telegram the only copy of operational files; verify archive IDs, checksums and retrievability |

## Free-tier and capacity gates
- Cloudflare D1 Free: up to 500 MB per database and 5 GB total account storage; daily row-read/write limits apply. Queries can fail after daily limits are reached. Re-check official quotas before cutover.
- The most recent reported source DB size was about 1.3 GB, with audit history making up most of it. A single Free D1 cannot hold that reported size. Do not delete source audit records merely to fit a destination.
- Potential design: partition operational tables across D1 databases only where referential consistency and transaction boundaries permit; move immutable audit/event history to compressed, checksummed R2 archives only after retention/legal requirements and replay/query needs are agreed. Keep searchable summaries in D1. This is a proposal, not yet implemented.
- R2 is not currently enabled for the connected Cloudflare account; API returned 403 code 10042 instructing that R2 must first be enabled in the Cloudflare Dashboard.
- User requirement: all services remain on Free plan; no paid resource, upgrade, or paid third-party dependency without explicit approval. Implement quota monitoring, bounded retries, upload size limits, and fail-closed behavior.

## Staging resources created
- Cloudflare D1 database: customs-os-migration-staging
- Database ID: b938fa3c-4995-4d27-aeda-f72f2d484a3c
- Jurisdiction: eu; primary region: EEUR; read replication disabled.
- Initial database contains only migration-control tables; no customer, shipment, user, document or production rows were copied.
- This database is nonproduction. It is not connected to the production Worker or domain.

## Mandatory migration sequence
1. Recover source: obtain a provider-generated backup/export or verified read-only database access. Preserve the original Supabase project.
2. Inventory source: export PostgreSQL catalog, table counts/sizes, constraints, indexes, triggers, RLS policies, functions, extensions, auth users, storage objects, cron schedules and secrets references. Never export secret values into Git.
3. Classify data: transactional/operational tables, reference data, append-only audit/history, AI/knowledge content, file metadata and binary objects. Record exact counts and checksums.
4. Design target: define D1 partition boundaries and SQLite-compatible schemas. Explicitly map UUID, JSONB, arrays, numeric precision, timestamps, Postgres enums, auth.uid(), RLS, RPCs, triggers and transaction semantics.
5. Prepare R2: user enables R2 in Dashboard; create private bucket only after free quota and jurisdiction are confirmed. Keep files private; use scoped signed URLs.
6. Port backend: migrate Edge Functions one by one to Worker modules/Queue consumers/Cron. Do not copy deployed functions blindly: inspect each function's dependencies and secrets, convert Deno/npm imports and Supabase calls, add tests.
7. Import in resumable chunks: immutable source snapshot, deterministic primary-key order, chunk checksums, checkpoint after each committed batch, idempotent reruns, dead-letter handling.
8. Validate: compare every source/target table row count, stable checksums, file size/hash, foreign-key integrity, tenant isolation, auth/session behavior, workflows, reminders, chat, PDF Studio, Telegram archiving and mobile PWA.
9. Shadow test: route no user traffic to target until parity is proven. Test using a separate staging hostname and synthetic data.
10. Cut over: explicit user approval, DNS/Worker switch with rollback plan, retain Supabase untouched until a defined verification period completes.

## Current blockers
- Source PostgreSQL does not accept connections. D1 must not be populated with guessed or incomplete data.
- Supabase migration list API fails with the same 57P03 error; repository migrations do not prove which exact migrations were applied.
- R2 has not been enabled on the Cloudflare account.
- Auth migration and all Postgres-specific business logic still require a full code and schema audit.
- A source backup is not yet verified.

## Safety rules
- No DROP, TRUNCATE, DELETE or source project reset as part of migration preparation.
- No production DNS, Worker route, production D1, or Supabase configuration changes in this staging phase.
- No production secrets, PATs, service-role keys, auth tokens or customer data in Git.
- Stop if a migration cannot preserve a row, relationship, file hash or access-control rule; report the exact blocker rather than silently skipping it.
