# Customs OS — Cloudflare Free Rebuild Execution

Status: **Phase 0 started; isolated staging only. No production cutover.**

## Non-negotiable invariants
1. Supabase project `bjngfgiecvihofemptub` is the immutable source of truth until an independently verified full export and parity check exist.
2. No source SQL writes, cleanup, reset, pause, restore-overwrite, or WAL manipulation.
3. No production DNS, Worker route, production binding, or secret changes in this rebuild phase.
4. No paid plans, paid add-ons, or third-party paid dependencies. If a free quota cannot be proven or a billing ceiling cannot be enforced, the feature is disabled rather than allowed to create a charge.
5. Never import guessed, synthetic, partial, or schema-incompatible rows as if they were production data.
6. Every import is resumable, idempotent, checksummed, and count-verified. Preserve source primary keys and relationships.

## Verified current state
- Frontend: React 18 + Vite + TypeScript + PWA.
- Existing production Worker: `customs`; it proxies Auth, REST, Storage, Realtime and Functions to Supabase.
- Existing production Worker routes and domains remain unchanged.
- Isolated D1: `customs-os-migration-staging`, id `b938fa3c-4995-4d27-aeda-f72f2d484a3c`, EU jurisdiction. It currently contains migration-control and function-archive records only.
- 16 deployed Supabase Edge Function sources / 27 source files are archived in that D1. They are not yet ported or deployed as replacements.
- Existing R2 bucket `customs-os-migration-staging` is empty. No production documents were copied.
- PostgreSQL is currently unavailable with repeated WAL recovery / no-space errors. No verified database backup has been located in the available project metadata.

## Target architecture (Free-first, subject to quota gates)
| Capability | Target | Rules |
|---|---|---|
| Static app / PWA | Existing Worker + Static Assets | Preserve UI and URLs; add API only behind staging Worker until tested |
| Relational operations | D1 (SQLite) | Partition only along proven transaction boundaries; preserve FK semantics and exact numeric values |
| Authentication | Dedicated Worker auth service + D1 session store | Existing Supabase password hashes/sessions are not assumed portable; existing accounts require a verified migration or secure password-reset flow |
| Files | Browser local processing first; R2 only after quota/billing safeguards | Do not upload files until enforceable storage and request ceilings are verified; never use R2 as an unbounded sink |
| Background jobs | Worker scheduled events / Queues only within verified Free quotas | Idempotent jobs, bounded retries, dead-letter reporting, no uncontrolled polling |
| AI | Provider adapter with explicit per-provider limits | No paid AI dependency; if no free provider quota/credential is available, AI is marked unavailable rather than silently billed |
| Realtime/chat | Evaluate Durable Objects/WebSockets and D1 polling limits | Do not promise parity until message ordering, fan-out, attachments and retention are tested |

## Free-tier gates
- D1 Free documented limits: 500 MB per database, 5 GB total account storage, 10 databases, 5 million rows read/day and 100,000 rows written/day. Enforce per-query and per-day budgets in application code and expose usage diagnostics.
- The source Postgres database was previously reported at about 1.3 GB. One D1 database cannot hold that footprint. No data may be deleted merely to fit. Partitioning, compression or archive is allowed only after source export and semantic review; archive storage must not become the only copy until retrieval and billing controls are proven.
- R2 is not treated as guaranteed zero-cost: exceeding its free included quotas can incur charges, and this account connection cannot inspect billing or enforce a spend cap. Keep the bucket empty until owner-side usage/billing guardrails are verifiable.
- Worker, Queue, Durable Objects, AI and any other services must each pass a current Free quota review before production use. If quota usage cannot be monitored and bounded, disable that capability.
- Never use a Workers Paid plan, D1 paid tier, R2 paid usage, or external paid service.

## Phases and acceptance criteria
### Phase 0 — Isolated foundation (in progress)
- Keep production untouched.
- Inventory all frontend table/RPC/storage/auth dependencies from source code and the deployed function archive.
- Establish a staging-only API contract and automated tests.
- Document known missing source artifacts and exact blockers.

### Phase 1 — Recoverable schema specification
- Reconcile all 294 repository migration files against the live database migration history when access returns.
- Extract authoritative Postgres catalog: tables, columns, defaults, constraints, indexes, views, triggers, functions, RLS policies, extensions, enum definitions and storage policies.
- Produce a reviewed SQLite mapping. Explicitly handle UUIDs, JSONB, arrays, enums, numeric precision, timestamps, transaction boundaries, trigger semantics and authorization predicates.
- Do not generate a production schema from incomplete TypeScript interfaces or placeholder migration files.

### Phase 2 — Auth and tenant isolation
- Design user identity, secure password handling, session rotation/revocation, MFA strategy, role model and organization-level access checks.
- Verify whether Supabase Auth user export/password hash migration is available. If not, use a controlled account recovery/password reset; never fabricate credentials or weaken authentication.
- Add negative tests proving users cannot access another organization.

### Phase 3 — Operational data and file migration
- Obtain a provider backup or stable read-only source.
- Export deterministic primary-key chunks with row counts, SHA-256 checksums and resumable checkpoints.
- Preserve all records, IDs, relationships and metadata. Compare counts and checksums before marking any table verified.
- Do not move binary files to R2 until storage quota enforcement is independently verified.

### Phase 4 — Port services
- Port each of the 16 archived Edge Functions individually; replace Supabase SDK calls with typed Worker repositories and D1 statements.
- Preserve business invariants and workflow transitions. Add tests for shipment registration, order-registration bank details, BL, customs declaration, exit, finance, reminders, knowledge, PDF/document processing and chat.
- Keep external credentials in Worker secrets; never commit secret values.

### Phase 5 — Shadow testing and cutover
- Use a separate staging hostname and synthetic test tenant only.
- Compare workflows, authorization, data integrity, file retrieval and mobile PWA behavior.
- Cutover requires explicit approval after full parity. Keep Supabase intact and recoverable through a defined rollback window.

## Current blockers (must not be hidden)
- No verified export of PostgreSQL rows, Auth users, Storage objects, Vault secrets or migration history.
- Existing repo migration files include compatibility-marker files that contain no schema changes; file count alone is not proof of a complete schema.
- The handwritten `src/types/supabase.ts` is explicitly marked a manual contract, not generated schema.
- R2 billing guard cannot currently be verified; no object uploads are permitted.
- Therefore, a functional login/operational cutover cannot yet be claimed. Work may proceed on code and staging scaffolding, but production data and auth parity remain blocked.

## Operational reporting
For every phase, report: files changed, commit/PR, resources touched, exact tests, free-quota assumptions, data imported (counts + checksums), unresolved gaps, and whether production traffic was changed.
