# Customs OS — Release Readiness

## Phase status

- Phase 8 — Case Stage Control: implemented in Supabase and exposed at `/stage`.
- Phase 9 — Case Completion Readiness: implemented with `get_case_completion_readiness()` and completion gating.
- Phase 10 — Integrity Checks: implemented with `get_customs_os_integrity_report()` and `case_operational_readiness`.
- Phase 11 — Production Security Hardening: anonymous execution removed from workflow functions; immutable history tables are protected from client DML.
- Phase 12 — Release Candidate: source cleanup completed; release checklist recorded here.

## Required pre-release checks

1. `npm install`
2. `npm run build`
3. `npm run test`
4. Log in as owner and verify `/control`, `/operations`, `/stage`, `/history`, `/finance`, and `/exit`.
5. Run `get_customs_os_integrity_report()` while authenticated and confirm `ok=true` before production use.
6. Verify RLS and tenant isolation with at least one additional tenant before onboarding real customers.
7. Confirm Vercel production deployment succeeds after its current deployment rate-limit window clears.

## Release constraint

The current GitHub status has shown Vercel deployment rate limiting. This is a deployment-capacity issue, not evidence of a source build failure. Production release must not be marked complete until a real Vercel deployment succeeds.
