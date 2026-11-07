# Hybrid P2P Offline-First Architecture and Migration Plan

Status: Architecture proposal; no production code or database has been changed.
Target repository: `mohsendarbandi-maker/customs-os`
Base: current `main` branch
Decision: Hybrid multi-peer sync; every participating Windows device owns a durable local database; peers sync directly on the office LAN; Supabase Cloud remains an asynchronous external replica; files are replicated between peers and to cloud storage.

## 1. Executive decision

Build a **multi-writer, local-first peer system**, not a hidden client/server system.

- Each Windows workstation runs the application plus a local peer agent and its own SQLite database.
- Peers discover one another on the office LAN using mDNS and establish authenticated encrypted connections.
- A workstation can read and write while disconnected from the internet and while other peers are offline.
- When peers reconnect, they exchange durable change events and missing file chunks.
- When international connectivity returns, each peer (or a designated outbound-capable peer chosen dynamically) can exchange pending events and files with the existing Supabase project.
- No workstation is a required primary node. A peer may be offline or shut down without stopping the others.
- Supabase remains the cloud integration point for remote web access and off-site users. It is not reachable during a complete international outage; a national-network route cannot make an EU Supabase endpoint reachable unless a separately reachable domestic relay is deployed.

This is not a promise of instantaneous global consistency. The system is **eventually consistent** across disconnected peers. Local writes are immediate; remote changes become visible after successful peer/cloud synchronization.

## 2. Findings from the current repository and live project

Repository inspection on the default branch found:

- React 18 + Vite 6 + TypeScript, Supabase JS 2.118, Tailwind, Vitest, and a Workbox-based PWA service worker.
- The current deployment is a Cloudflare Worker serving static assets and proxying Supabase endpoints.
- There is no Tauri/Electron desktop shell, local peer daemon, SQLite runtime, peer discovery, or peer replication protocol in the current package manifest.
- `src/sw.ts` caches navigation/precache assets only. It explicitly does not cache API routes or authenticated tenant data.
- `src/lib/offlineQueue.ts` uses IndexedDB and supports a deliberately narrow RPC allowlist: `attach_registration_order`, `update_case_operational_data`, `update_shipment_maritime_data`, `create_operational_reminder`, and `chat_insert_message`. This is not full offline CRUD or cross-device replication.
- `src/lib/supabase.ts` has a restricted authenticated GET cache. It intentionally excludes RPCs, files, financial data, documents, chat, and other sensitive resources.
- The existing file manager already has Telegram archive/upload job concepts and file metadata tables. It is a workflow to preserve, not replace. The new file replication layer must coexist with Telegram archiving and existing Storage paths.
- The live Supabase project is active in `eu-west-1` and uses PostgreSQL 17. The public schema contains the existing customs, CRM, chat, finance, documents, file-manager, audit, and identity domains. The database must not be rebuilt or bulk-replaced for this migration.

Conclusion: the current PWA offers partial offline presentation and a limited RPC outbox. It does **not** meet the requested multi-device offline-first P2P behavior. A desktop peer runtime is required for reliable LAN discovery and direct peer transport. A browser tab/PWA cannot be treated as a reliable always-listening P2P host.

## 3. Target topology

```text
 Windows PC A                         Windows PC B
 ┌──────────────────────┐             ┌──────────────────────┐
 │ React UI (Tauri)     │             │ React UI (Tauri)     │
 │ Local SQLite         │◄── P2P ────►│ Local SQLite         │
 │ Peer Agent           │  mDNS +     │ Peer Agent           │
 │ File Chunk Store     │  QUIC/TLS   │ File Chunk Store     │
 │ Event Outbox/Inbox   │             │ Event Outbox/Inbox   │
 └──────────┬───────────┘             └──────────┬───────────┘
            │                                    │
            └────────────── LAN/Wi-Fi ───────────┘
                         │
                  Other workstations
                         │
             Any available peer with WAN
                         │ HTTPS (outbound)
                         ▼
              Existing Supabase Cloud
              PostgreSQL + Storage + Auth
```

Each peer is a full participant. There is no designated master database and no requirement that a particular PC stay powered on. Each device has a stable device identity and a revocable device credential.

### Browser and mobile compatibility

- The existing hosted PWA remains available and continues to use Supabase when reachable.
- Full P2P participation is initially a **Windows desktop capability** via Tauri + a native peer agent.
- A browser-only device cannot reliably advertise a LAN service or accept arbitrary inbound peer connections. For browser/mobile clients, either use the cloud when reachable or connect through a locally running desktop peer gateway on the same LAN. Do not claim full P2P support in Safari/ordinary browser without that gateway.
- Cross-site peers outside the office LAN require a separately approved direct-connect/VPN/relay strategy. LAN mDNS alone does not traverse NAT.

## 4. Runtime components

### 4.1 Desktop shell and local data

- Keep the existing React/Vite UI.
- Add Tauri for Windows packaging and a native Rust peer service.
- Use SQLite per device with WAL mode, foreign keys, migrations, integrity checks, and encrypted-at-rest storage where supported by the selected platform key store.
- Keep IndexedDB as a browser/PWA cache and draft fallback, not as the authoritative desktop database.
- Use a repository/data-access layer so React features no longer assume every query is a direct Supabase request.
- The local database is scoped to the authenticated organization(s) that the device is allowed to hold. Do not copy every tenant's records to every peer.

### 4.2 Peer discovery and transport

- LAN discovery: mDNS/DNS-SD service advertisement with a stable service type and device identity.
- Transport: authenticated QUIC over TLS 1.3 (or a proven libp2p transport); never expose an unauthenticated database port.
- Identity: per-installation keypair, device registration, signed challenge/response, organization membership checks, revocation, and key rotation.
- Pairing: an administrator-approved one-time pairing code/QR or device approval workflow.
- Synchronization: cursor-based event exchange with acknowledgements, bounded batches, retry with jitter, and periodic anti-entropy reconciliation.
- Peer discovery is a transport mechanism only. It must not imply that any peer is trusted merely because it is on the same Wi-Fi.

### 4.3 Change log and replication protocol

Do not replicate raw Postgres rows blindly. Introduce a durable application-level event protocol.

Each event includes at minimum:

- `event_id` (UUIDv7/UUID), `idempotency_key`, `organization_id`
- `aggregate_type`, `aggregate_id`, `operation`, `schema_version`
- `origin_device_id`, `actor_user_id`, `origin_sequence`
- `created_at`, `base_version`, `payload`, `payload_hash`
- optional causal parents/vector metadata where needed
- signature or authenticated transport provenance

Local write transaction:
1. Validate the command against the local schema and business rules.
2. Commit the local projection update and append the event/outbox row in one SQLite transaction.
3. Notify the UI that the local save succeeded and show sync as pending.
4. Send the event to available peers and cloud asynchronously.
5. Record per-destination acknowledgement; never delete an event merely because one peer acknowledged it.

Incoming event transaction:
1. Authenticate device and organization scope.
2. Validate schema version, payload size, signature, and idempotency key.
3. Reject duplicates safely.
4. Apply only if the domain's conflict policy allows it.
5. Store the event and update the local projection atomically.
6. Return an acknowledgement only after durable commit.

Use a per-peer cursor plus anti-entropy hash reconciliation to recover missed events after long outages. Do not depend on WebSocket delivery as the durable record.

### 4.4 Conflict policies

Never use global last-write-wins for financial or customs-critical fields.

| Domain | Policy |
|---|---|
| Chat messages, audit events, tracking events | Append-only; deduplicate by stable event/message ID |
| Comments, tags, low-risk preferences | Merge or field-level versioning; explicit deterministic rules |
| Drafts not yet submitted | Device-local until user submits/shares |
| Shipment weight/value, registration-order totals, bank details, LC/payment instrument, Sata code, customs status, declaration/exit | Detect concurrent edits; create a visible conflict; require authorized resolution |
| Immutable audit/status history | Append-only; never overwrite or delete |
| File content | Content-addressed immutable blobs; metadata revisions tracked separately |
| File name/folder metadata | Versioned metadata; conflicting moves/renames require deterministic merge or review |

For critical aggregates, use optimistic concurrency with `base_version`. If the incoming base version is stale, preserve both versions in a conflict record and do not silently apply the losing value. A resolution itself is a new audited event.

Cross-table invariants (for example, total shipment quantity/weight/value against the related registration order) must be validated on the command/event boundary. A device may save a draft offline, but it must not label an invariant-breaking aggregate as finalized/approved until validation succeeds against the latest known aggregate state.

### 4.5 File replication: peer + cloud

Preserve current `file_assets`, `file_locations`, `file_manager_files`, `file_manager_upload_jobs`, `file_transfer_jobs`, `shipment_documents`, and Telegram archive workflows.

Add a content-addressed blob layer:

- Compute SHA-256 before accepting a file.
- Store immutable chunks (for example 4–8 MiB) with a manifest containing total size, MIME type, hash, chunk hashes, and encryption metadata.
- Keep file metadata and ACLs in the event log; transfer bytes separately.
- Resume partial transfers by missing chunk hash; verify every chunk and the complete file before marking the destination complete.
- Replicate to available LAN peers first; queue cloud upload when Supabase Storage is reachable.
- Replicate from cloud to peers when the user/device has permission and storage policy allows it.
- Do not store signed URLs as durable file references. Store logical object IDs and resolve short-lived URLs at access time.
- Keep Telegram as an archive destination, not as the only local copy or as a substitute for peer replication.
- Define per-file replication policy: required peers, cloud-required, local-only, retention, maximum local cache size, and legal hold.
- Encrypt sensitive file content before peer transfer where required; authorization metadata must be checked before issuing chunks.

The existing `storage_backend` and `file_asset_id` fields should be mapped in a compatibility adapter. Avoid rewriting existing Storage paths until the migration has a verified inventory and rollback path.

## 5. Supabase cloud bridge

The current Supabase project remains active and is not replaced.

Add a cloud-sync bridge that exchanges events, not unrestricted table snapshots:
- Cloud accepts authenticated, idempotent event batches and stores a durable cloud inbox.
- Cloud returns acknowledged event IDs and a cursor for cloud-origin events.
- Devices apply cloud-origin events using the same validation/conflict path as peer-origin events.
- Cloud upload/download of file chunks uses existing Storage policies and scoped signed access.
- Existing RLS remains mandatory for cloud access. Local authorization must be independently enforced by the native peer service; a local SQLite file does not automatically inherit Supabase RLS.
- Do not ship Supabase service-role keys or other server secrets in the desktop app.
- A device that is offline from the international internet continues to operate locally and syncs later. No design can push to the EU Supabase project while the international route is unavailable.

A domestic relay may be added later only if there is an actually reachable domestic endpoint and a defined trust/security boundary. It is optional and not a prerequisite for LAN P2P.

## 6. Data model additions (proposed, not yet migrated)

Local SQLite tables:
- `local_device_identity`
- `local_peer_registry`
- `sync_events`
- `sync_outbox`
- `sync_inbox`
- `sync_peer_cursors`
- `sync_conflicts`
- `sync_file_manifests`
- `sync_file_chunks`
- `sync_file_transfers`
- `local_schema_migrations`

Cloud Postgres additions (after review and staging):
- `sync_devices` — registered/revocable device public keys and organization scope
- `sync_event_inbox` — durable idempotent event receipt
- `sync_cloud_cursors` — per-device/per-organization cursor
- `sync_conflicts` — server-visible conflicts requiring resolution
- optional `sync_file_manifests` — manifest and replication state, while bytes remain in Storage

All new tables require RLS, explicit grants, indexes, retention rules, and security advisor review. Event payloads must be allowlisted by aggregate type and schema version; never accept arbitrary SQL, table names, or client-selected RPC names.

## 7. Migration plan

### Phase 0 — Safety baseline and inventory
1. Freeze schema-changing work during the initial audit window.
2. Take and verify a Supabase backup; export schema and migration history.
3. Record current main commit SHA, Cloudflare Worker version, Storage buckets, object counts/sizes, RLS policies, RPCs, and active workflows.
4. Build a data-domain inventory and classify every table as read-only cache, append-only event, locally writable, cloud-only, or excluded.
5. Establish staging environment and synthetic organization fixtures. No production writes from experimental peers.

Exit criteria: recoverable backup, verified staging, table/file inventory, and signed-off domain conflict matrix.

### Phase 1 — Data-access boundary
1. Introduce typed repositories/command handlers behind existing React features.
2. Preserve Supabase implementation as the current online adapter.
3. Add local adapter interfaces and contract tests, initially disabled.
4. Identify every direct `.from()`, `.rpc()`, `.storage`, Auth, Realtime, and Edge Function call and assign an explicit offline policy.
5. Keep authentication/session refresh cloud-dependent initially; offline access requires a previously approved device grant and bounded local session policy.

Exit criteria: no silent direct cloud writes from modules marked offline-capable; online behavior unchanged.

### Phase 2 — Desktop runtime and local database
1. Add Tauri Windows packaging and native peer agent.
2. Implement SQLite schema migrations and organization-scoped bootstrap snapshot.
3. Implement encrypted device identity, pairing/revocation, local authorization, and secure local storage.
4. Add local read models for a limited pilot domain (start with reference data and shipment/case read views).
5. Add durable local command + event/outbox transaction.

Exit criteria: one workstation can restart and retain validated local work without contacting Supabase.

### Phase 3 — LAN P2P transport
1. Implement mDNS discovery and authenticated QUIC connection.
2. Implement handshake, peer allowlist, event exchange, acknowledgements, retries, and cursor recovery.
3. Test two and then three devices with intermittent connectivity and duplicate delivery.
4. Add status UI: LAN peers, peer last-seen, queued events, last successful peer sync, failed transfers, conflicts.

Exit criteria: two Windows devices exchange changes without any cloud access or central server.

### Phase 4 — Controlled write domains
1. Enable offline writes only for explicitly reviewed aggregates.
2. Implement aggregate-level optimistic concurrency and conflict review UI.
3. Add tests for simultaneous shipment/order edits, cross-device duplicate submissions, stale base versions, and business invariants.
4. Expand domain-by-domain; do not enable all database tables in one switch.

Exit criteria: no lost updates in concurrency test suite; financial/customs conflicts are visible and recoverable.

### Phase 5 — Files both ways
1. Implement content hashing, manifest/chunk transfer, resumability, integrity checks, encryption, and local quota.
2. Integrate file-manager metadata and existing Telegram archive jobs.
3. Replicate a test file from device A to B, then to Supabase Storage; repeat cloud-to-peer.
4. Verify offline PDF preview, file manager, chat forwarding, and shipment document linking.

Exit criteria: files are byte-identical after peer/cloud transfer; interrupted uploads resume; unauthorized peers cannot fetch files.

### Phase 6 — Supabase cloud bridge
1. Add cloud inbox/outbox tables and authenticated batch endpoints in staging.
2. Implement idempotent event ingest and cloud-origin event pull.
3. Add per-device cursor acknowledgements and reconciliation.
4. Test outage/recovery with long disconnection and cloud/peer concurrent edits.
5. Run a shadow sync that compares outcomes without changing production data.

Exit criteria: event parity and conflict handling verified against staging; no duplicate business operations.

### Phase 7 — Pilot and rollout
1. Pilot with two Windows devices and a test organization.
2. Run a read-only shadow period against live cloud data.
3. Enable a narrow write domain for one trained team.
4. Monitor queue age, sync latency, conflict rate, file integrity, database health, and device revocations.
5. Expand to the remaining devices only after acceptance tests pass.
6. Keep a feature flag and rollback path to cloud-only mode. Never delete local outboxes during rollback.

Exit criteria: operational sign-off, tested restore procedure, documented support process, and verified rollback.

## 8. Acceptance test matrix

- Two peers sync while the WAN cable is unplugged.
- A peer is shut down during transfer; remaining peers continue.
- A peer returns after several days and catches up from durable cursors.
- Duplicate events and reordered events do not create duplicate shipments, messages, tracking events, or payments.
- Two peers edit the same shipment weight/value while disconnected; both edits are retained as a conflict and no silent overwrite occurs.
- A registration-order aggregate cannot be finalized with invalid totals or inconsistent payment-instrument data.
- An immutable audit event cannot be updated/deleted by a peer.
- A device is revoked; it can no longer join or fetch new files/events.
- A file transfer interrupted mid-chunk resumes and verifies SHA-256.
- Cloud outage leaves LAN sync operational; cloud recovery drains the outbox without duplicates.
- A cloud-origin update is delivered to peers and conflicting local changes are surfaced.
- Browser/PWA clearly indicates that it is not a full P2P host when no desktop peer gateway is running.
- Restore from a single peer's backup is tested, including local DB and file blobs.

## 9. Operational requirements and limits

- Each workstation needs enough local disk for its organization-scoped database, file cache, and retained outbox.
- Use Windows startup services, controlled updates, disk health checks, and scheduled encrypted backups for the desktop peer agent.
- A single device failure must not stop other peers, but data that existed only on that device and was never replicated/backed up can be lost. Critical events should be acknowledged by at least one additional peer or cloud before showing a stronger durability status.
- No peer should automatically trust a new device because it is on the LAN.
- P2P mesh increases network traffic as peer count grows; use peer selection and bounded fan-out rather than sending every chunk to every device.
- A full mesh is not necessary for large offices. Peers can exchange through any currently online peer, while each peer retains its own durable copy. This is still multi-peer and has no fixed master.
- For off-site users, use cloud connectivity or an explicitly approved VPN/relay; LAN peer discovery does not cross the public internet.
- National internet connectivity does not guarantee access to Supabase in `eu-west-1`.

## 10. Explicit non-goals for the first release

- No automatic conversion of all existing Supabase tables into CRDTs.
- No multi-master Postgres replication between workstations.
- No desktop service-role credentials.
- No destructive production migration or change to existing user sessions.
- No removal of Telegram archiving, current Cloudflare Worker hosting, or existing browser/PWA access.
- No claim of full offline authentication for a first-time/unpaired device.

## 11. Immediate implementation sequence

1. Review this ADR with the business owner and approve the conflict matrix.
2. Create a staging Supabase branch/project and verified backups.
3. Add repository adapters and command boundaries to the current React app.
4. Build the Tauri + SQLite proof of concept with two Windows devices.
5. Prove LAN sync before implementing cloud sync.
6. Prove file replication before enabling operational writes.
7. Expand by domain under feature flags and acceptance tests.

**Safety statement:** This document is an implementation plan only. The live Supabase schema, production data, Cloudflare Worker, and default GitHub branch have not been modified.
