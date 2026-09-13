# Customs OS — Release Readiness

## Phase status

- Phase 8 — Case Stage Control: implemented in Supabase and exposed at `/stage`.
- Phase 9 — Case Completion Readiness: implemented with `get_case_completion_readiness()` and completion gating.
- Phase 10 — Integrity Checks: implemented with `get_customs_os_integrity_report()` and `case_operational_readiness`.
- Phase 11 — Production Security Hardening: anonymous execution removed from sensitive workflow functions; immutable history tables are protected from client DML.
- Phase 12 — Release Candidate: source cleanup completed, stale security tests corrected, temporary files removed, and security-advisor cleanup applied.
- Phase 13 — Workflow Integrity & Credential Boundary: Phase 8–10 live workflow functions are represented by a canonical repository migration; EPL passwords are no longer returned to the browser; finance UI rounds base IRR amounts to database precision; Offline Queue is bound to the authenticated user and excludes event-creating tracking RPCs from automatic replay.
- Phase 14 — Maritime RPC Compatibility: the live maritime persistence RPC accepts and validates the optional client context used by the Operations UI, preserving tenant ownership and B/L identity rules.
- Phase 15 — Exit Stage Integrity: cargo-exit updates cannot regress archived/completed workflow state and final exit requires the exit-permit stage; exit-driven case stage changes are recorded in immutable status history.

## Verification completed

- Supabase Phase 13, 14 and 15 migrations applied successfully to the live project.
- Live workflow/readiness and credential functions are SECURITY INVOKER with explicit search paths and authenticated-only grants where appropriate.
- Browser-facing EPL credential lookup returns only username and password-configured status; plaintext Vault secrets are not exposed to the client.
- Operations preserves registration-order client ownership for independent orders and only auto-loads shipments explicitly linked to the selected case.
- Offline Queue automatic replay is limited to selected workflow updates and does not include authentication/session operations, case creation, or tracking-event creation.
- Finance UI now sends base IRR values rounded to the same two-decimal precision enforced by the database.
- GitHub Actions is configured to run tests before the production build on pushes to `main`.

## Required before production use

1. Confirm the newest `main` GitHub Actions run finishes with both `npm test` and `npm run build` successful.
2. Log in as owner and verify `/control`, `/operations`, `/stage`, `/history`, `/finance`, and `/exit` against the live Supabase project.
3. Run `get_customs_os_integrity_report()` from the signed-in application context and confirm `ok=true`.
4. Verify RLS and tenant isolation with at least one additional tenant before onboarding real customers.
5. Confirm a real Vercel production deployment succeeds and serves the latest `main` commit.

## Known repository/preview constraint

Supabase GitHub Preview currently attempts to initialize the repository against an environment where `organizations` already exists and reports `relation "organizations" already exists`. This remains a migration-history/preview-environment reconciliation issue and is separate from the application runtime schema already applied to the live project.

Vercel production deployment has not yet been verified for the latest source. The project remains a **release candidate**, not a verified production release.
