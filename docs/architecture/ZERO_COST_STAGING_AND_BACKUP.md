# Zero-Cost Development, Staging and Backup Policy

Status: Adopted cost constraint — no paid services or cloud branches.
Date: 2026-11-09
Applies to: `architecture/hybrid-p2p-offline`

## Decision

The Hybrid P2P project must be developed and validated without adding subscription, compute, branch, hosting, storage, relay, or CI charges. Do not create a paid Supabase branch/project, upgrade Supabase, enable paid Cloudflare products, or incur GitHub-hosted compute charges.

The existing Supabase production project remains unchanged. This document replaces the paid managed-staging suggestion in the Phase 0 report.

## Free staging strategy

1. Use a local Supabase-compatible development stack on an existing company workstation, powered by Supabase CLI and a Docker-API-compatible runtime such as Podman. The local stack runs on the workstation and does not consume hosted Supabase quota.
2. Keep all local services bound to localhost unless a temporary LAN test specifically requires access. Never expose the local Supabase stack or default credentials to the public internet.
3. For schema-accurate tests, restore a verified production database backup into the local isolated stack. Do not simply run all repository migrations: the audit found migration history drift (291 live versions versus 283 branch SQL files). Reconcile the baseline first.
4. Use sanitized or synthetic organization fixtures for engineering and multi-device tests. Do not export production personal data into GitHub, CI logs, or shared test fixtures.
5. Run the React/Vite application locally, use Wrangler local development for Worker behavior, and run Rust/Tauri builds locally when the desktop runtime is introduced.
6. Use the public GitHub repository's free Actions allowance for source-only tests where suitable. CI must not connect to or mutate production Supabase, and must not require hosted staging secrets.
7. Test direct peer sync on two or three existing Windows PCs over the existing office LAN. This needs no cloud relay or always-on server; each test device owns a local database and durable queue.

Supabase documents local development as free and outside hosted project quotas. It requires Supabase CLI and a container runtime. See:
- https://supabase.com/docs/guides/local-development
- https://supabase.com/docs/guides/local-development/docker-and-native-runtimes

GitHub states that Actions minutes are free for public repositories:
- https://github.com/pricing

## Backup and restore without paid hosted backups

The free path is a controlled, on-demand backup to an existing company-controlled encrypted disk, not an assumption that the hosted free plan supplies automatic backups.

Before any database migration:
1. Obtain authorized database backup access without pasting passwords, connection strings, service-role keys, or tokens into chat or committing them to Git.
2. Produce a complete PostgreSQL backup of schema and data from the live production database using an authorized local administrative workstation.
3. Export the Storage object bytes for every existing bucket, plus the metadata/object-path inventory. A database-only dump is not a complete application backup.
4. Record checksums, file counts, object counts, database dump size, and timestamps in a local backup manifest. Keep the backup encrypted and access-restricted.
5. Restore the database dump and Storage objects into the isolated local stack. Run integrity checks, validate required object paths and metadata, and execute representative read-only application workflows.
6. Mark the backup as verified only after successful restore; a completed export without a restore test is not a verified backup.
7. Keep at least one separate offline copy on existing company-owned storage. No new paid storage provider is allowed.

Do not delete, rename, or rewrite existing Supabase Storage objects as part of this work.

## Production and billing safety

- No Supabase project/branch creation, plan upgrade, database migration, data write, auth setting change, or storage mutation without separate explicit authorization.
- No Cloudflare Worker deployment, public route, paid add-on, tunnel or relay.
- No new SaaS relay, managed TURN service, paid CI runner, paid backup vendor, or new hosted database.
- Use environment-local secret stores. Do not place privileged keys in browser, PWA, Tauri frontend assets, Rust binaries, test output, repository files, or issue reports.
- All database CLI commands must explicitly select the local target (for example `--local`) during development. Do not rely on CLI defaults when a command can target a linked project.
- Add a guard to scripts/CI that refuses production URLs/project refs for test, reset, seed, or migration commands.

## Constraints and limitations

- Hosted Supabase Free currently has no managed database branching and no automatic backups; hosted free projects have resource limits and inactivity pausing. This project will not use paid hosted branching.
- A local restore proves that the backup artifact is usable; it does not prove the hosted provider's disaster-recovery capability.
- Free local staging requires a suitable existing Windows/Linux machine and sufficient free disk/RAM. Podman or another Docker-compatible runtime must already be available or installable at no license cost.
- The company must have at least two available Windows devices and LAN access to prove real P2P behavior. A single-machine unit test cannot satisfy the two-device Definition of Done.
- If administrative database credentials or Storage export access are unavailable, the exact blocker is backup access. Do not claim Phase 1 complete.

## Revised Phase 1 exit gate

Phase 1 is complete only when all are evidenced:
- [ ] Local development stack starts without a hosted Supabase branch.
- [ ] Complete production database backup artifact exists on encrypted company storage.
- [ ] All eight existing Storage buckets' object data and metadata are backed up, or exclusions are explicitly approved.
- [ ] Backup restores into local isolated environment.
- [ ] Database integrity, key relationships and representative business workflows are verified after restore.
- [ ] Migration drift is reconciled and a local-only migration dry-run passes.
- [ ] Rollback instructions are proven against the local restored copy.
- [ ] No paid service or production environment was changed.

Until each item passes, Phase 1 remains blocked and no implementation migration is applied to production.
