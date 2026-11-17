# Customs OS — Release Readiness

Status: NOT READY FOR RELEASE APPROVAL

## Verified
- GitHub main CI run 44102021708 succeeded for unit tests, typecheck, lint and Vite production build.
- PostgreSQL fixture/migration and concurrency contract tests are reported successful in PR 292.
- Supabase project is active and live schema includes the two customs workflow/daily digest migrations.
- Cloudflare Worker deploy and live smoke test succeeded in the latest main workflow run.

## Not yet verified
- Full authenticated UI acceptance across owner/admin/broker/warehouse roles.
- Tenant isolation across all operational, financial and file resources.
- Function-by-function review of SECURITY DEFINER functions.
- End-to-end daily digest push invocation and retry behavior.
- Independent activity entity lifecycle.
- PDF page classification, splitting, parent/child lineage and archive recovery.
- Registration-order capacity reconciliation with representative staging data.
- Mobile smoke test on latest main (the relevant step was skipped in run 44102021708).

## Explicitly prohibited without new approval
- Production migrations or data backfills.
- Merge to main.
- Cloudflare Worker deployment or website release.
