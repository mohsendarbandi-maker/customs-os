# Customs OS — Release Readiness

Status: NOT READY FOR RELEASE APPROVAL

## Verified
- GitHub main CI run 44102021708 succeeded for unit tests, typecheck, lint and Vite production build.
- PostgreSQL fixture/migration and concurrency contract tests are reported successful in PR 292.
- Supabase project is active and live schema includes the two customs workflow/daily digest migrations.
- Main Worker deployment step succeeded in run 44108881420, but the live build-signature smoke test failed. A second automated Worker deploy occurred in run 44109859363 and its smoke step was cancelled. Worker metadata last modified at 2026-11-17 15:05:27 UTC.

## Not yet verified
- Full authenticated UI acceptance across owner/admin/broker/warehouse roles.
- Tenant isolation across all operational, financial and file resources.
- Function-by-function review of SECURITY DEFINER functions.
- End-to-end daily digest push invocation and retry behavior.
- Authenticated UI acceptance for independent activity lifecycle; SQL/TypeScript/Build CI passed on PR 294 but manual UI review remains untested.
- Activity-scoped rollback action (not implemented yet).
- PDF page classification, splitting, parent/child lineage and archive recovery.
- Registration-order capacity reconciliation with representative staging data.
- Mobile smoke test in PR 294 latest verification (skipped).
- Root-cause confirmation and clean live build-signature smoke test after automatic Worker deployments.

## Explicitly prohibited without new approval
- Production migrations or data backfills.
- Merge to main.
- Cloudflare Worker deployment or website release.


## Stage 2 status (PR 294)

- Independent activity schema, RLS, trigger history, dependency graph, reminder/cost/file references and RTL workspace are implemented on a feature branch.
- Initial test run failed during fixture setup only (duplicate cluster-wide role); corrected fixture has been pushed.
- Latest CI at the time of this entry was still running. This PR is not yet release-ready or accepted.
- No production migration, merge or deployment was performed.


## Deployment incident status

- Main ref restored to `968c58f2624c04f53cc98f094be888cd7e74dc72`.
- Two automated Cloudflare Worker deployment steps were observed in runs 44108881420 and 44109859363; live runtime verification did not pass cleanly.
- PR 295 is Draft and separates validation from explicit manual deployment. It is not merged, so the old main workflow remains active until approval/merge.
- No Production database migration, backfill or data mutation was performed.
