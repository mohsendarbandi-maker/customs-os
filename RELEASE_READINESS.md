# Customs OS — Release Readiness

## Phase status

- Phase 8 — Case Stage Control: implemented in Supabase and exposed at `/stage`.
- Phase 9 — Case Completion Readiness: implemented with `get_case_completion_readiness()` and completion gating.
- Phase 10 — Integrity Checks: implemented with `get_customs_os_integrity_report()` and `case_operational_readiness`.
- Phase 11 — Production Security Hardening: anonymous execution removed from sensitive workflow functions; immutable history tables are protected from client DML.
- Phase 12 — Release Candidate: source cleanup completed, stale security test corrected, temporary file removed, and Supabase security-advisor cleanup applied.

## Verification completed

- GitHub Actions Build workflow: successful on the release source after cleanup (`npm install` + `npm run build`).
- GitHub Actions workflow now runs `npm test` before `npm run build` on every push to `main`.
- Supabase migration history contains the Phase 8–11 production hardening migrations and the Phase 12 security-advisor cleanup.
- Live database currently contains 1 organization, 1 client, 1 case, 2 shipments, 108 audit-log rows, and 9 status-history rows.
- The live readiness function correctly requires an authenticated user; a database-owner SQL session is rejected rather than bypassing that control.

## Required before production use

1. Confirm a fresh `main` GitHub Actions run passes both `npm test` and `npm run build` after the latest workflow change.
2. Log in as owner and verify `/control`, `/operations`, `/stage`, `/history`, `/finance`, and `/exit` against the live Supabase project.
3. Run `get_customs_os_integrity_report()` from the signed-in application context and confirm `ok=true`.
4. Verify RLS and tenant isolation with at least one additional tenant before onboarding real customers.
5. Confirm a real Vercel production deployment succeeds and serves the latest `main` commit.

## Current release constraint

The latest Vercel/GitHub status remains **Deployment rate limited — retry in 24 hours**. This is a Vercel deployment-capacity restriction, not a source-build error. Therefore Customs OS is currently a **release candidate**, not yet a verified production release.
