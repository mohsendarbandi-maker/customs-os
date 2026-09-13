# Customs OS — Release Readiness

## Phase status

- Phase 8 — Case Stage Control: implemented in Supabase and exposed at `/stage`.
- Phase 9 — Case Completion Readiness: implemented with `get_case_completion_readiness()` and completion gating.
- Phase 10 — Integrity Checks: implemented with `get_customs_os_integrity_report()` and `case_operational_readiness`.
- Phase 11 — Production Security Hardening: anonymous execution removed from sensitive workflow functions; immutable history tables are protected from client DML.
- Phase 12 — Release Candidate: source cleanup completed, stale security tests corrected, temporary files removed, and security-advisor cleanup applied.
- Phase 13 — Workflow Integrity & Credential Boundary: Phase 8–10 live workflow functions are now represented by a canonical repository migration; EPL passwords are no longer returned to the browser; finance UI rounds base IRR amounts to the database precision; Offline Queue is bound to the authenticated user and excludes event-creating tracking RPCs from automatic replay.

## Verification completed

- Supabase Phase 13 migration applied successfully to the live project.
- Live `advance_case_stage`, `get_case_completion_readiness`, and `get_customs_os_integrity_report` functions are SECURITY INVOKER with an explicit `search_path` and authenticated-role grants.
- Browser-facing EPL credential lookup now returns only `epl_username` and `password_configured`; plaintext Vault secrets are not exposed to the client.
- Offline Queue automatic replay is limited to selected workflow updates and does not include authentication/session operations, case creation, or tracking-event creation.
- GitHub Actions is configured to run tests before the production build on pushes to `main`.

## Required before production use

1. Confirm the newest `main` GitHub Actions run finishes with both `npm test` and `npm run build` successful.
2. Log in as owner and verify `/control`, `/operations`, `/stage`, `/history`, `/finance`, and `/exit` against the live Supabase project.
3. Run `get_customs_os_integrity_report()` from the signed-in application context and confirm `ok=true`.
4. Verify RLS and tenant isolation with at least one additional tenant before onboarding real customers.
5. Confirm a real Vercel production deployment succeeds and serves the latest `main` commit.

## Known repository/preview constraint

Supabase GitHub Preview currently attempts to initialize the repository against an environment where `organizations` already exists and reports `relation "organizations" already exists`. This is a migration-history/preview-environment reconciliation issue and is separate from the application runtime schema already applied to the live project.

Vercel production deployment has not yet been verified for the latest source. The project remains a **release candidate**, not a verified production release.
