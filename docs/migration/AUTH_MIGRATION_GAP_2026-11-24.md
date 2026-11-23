# Customs OS — D1 Authentication Migration Gap

**Snapshot:** 2026-11-23 UTC  
**Scope:** Read-only schema/runtime inspection of the isolated `customs-os-migration-staging` Worker and current production source.  
**Status:** Multi-user D1 Auth is **not implemented or cutover-ready**. This document records the evidence and the required gates; it does not change any user records or credentials.

## Verified current state

### Production remains on the existing Supabase Auth proxy

- The live production app bundle uses the Supabase password-grant flow. Its compiled JavaScript does not contain the Staging-only `/api/auth/login` or `/api/auth/session` endpoints.
- The current `customs` Worker proxies browser `/auth/v1`, `/rest/v1`, `/storage/v1`, `/realtime/v1`, and `/functions/v1` calls to the existing Supabase project.
- The production login path must remain unchanged until D1 identity import, multi-user authorization, session migration/re-enrollment, and regression checks all pass.

### Staging D1 auth schema snapshot

The read-only Staging schema endpoint returned HTTP 200. It reported 34 tables and 1,097 counted rows across countable tables; one table count was unavailable. The auth-related counts were:

| Table | Rows | Meaning |
|---|---:|---|
| `profiles` | 1 | One imported workspace profile is present |
| `customs_admin_sessions` | 2 | Two staging session records exist; they are not proof of imported Supabase Auth users |
| `customs_admin_credentials` | 0 | The single-admin credential table is empty |
| `customs_admin_login_attempts` | 0 | No current rate-limit rows |

The schema is not a complete copy of the production Auth model. The D1 `profiles` table has only basic identity/role fields, while the legacy PostgreSQL profile contract also links to `auth.users` and includes `organization_id`, `client_id`, `phone`, `is_active`, and the tenant/role constraints.

### Staging login implementation is single-admin only

The current Staging Worker source has:
- a fixed admin email, `admin@darbandicommercial.ir`;
- one module-level hard-coded owner profile;
- one `CUSTOMS_ADMIN_PASSWORD` secret used by the Staging login endpoint;
- a single staging session-cookie mechanism;
- device-session listing/revocation attached to that staging identity.

This is useful for isolated recovery testing, but it is **not** the multi-user account system used by Customs OS. It must not be enabled on the production custom domains.

### Required Customs OS role model

The real application roles are:
- `owner`
- `admin`
- `broker`
- `accountant`
- `warehouse`
- `client`

Authorization also depends on organization membership and, for client accounts, `client_id`. Authentication alone is not authorization; every D1 API must enforce the authenticated user's organization, role, active status, and client scope server-side.

## Required implementation before D1 Auth can be considered complete

1. **Identity inventory and mapping:** reconcile every production `auth.users` identity with `profiles`, organizations, roles, and client links. Do not log or expose user rows, password hashes, tokens, or personal data in CI output.
2. **Credential transition:** define a safe password re-enrollment/reset process. Do not attempt to retrieve plaintext passwords. Do not silently invent a shared password for all users. Any one-time invitation/reset token must be random, single-use, expiry-limited, and stored hashed.
3. **Multi-user credential store:** replace the single-admin credential assumption with per-user credentials and a reviewed password-hashing strategy supported by Workers Web Crypto. Include normalized unique emails, disabled-user handling, password-change/recovery, and failed-login throttling.
4. **Tenant-aware sessions:** use opaque high-entropy session tokens; store only token hashes; bind every session to one user; support expiry, revocation, device labels, last-seen time, concurrent sessions, and current-session protection.
5. **Server-side authorization:** replace the single global Staging `profile` object with the authenticated user's resolved D1 profile. Apply tenant/role/client checks to every API, including file manager, documents, cases, clients, registration orders, finance, chat, and admin endpoints.
6. **Audit and recovery:** log login, logout, password reset, session revocation, user activation/deactivation, role changes, and tenant-scope changes without recording secrets.
7. **Tests:** cover wrong passwords, timing-safe comparison, lockout, disabled users, unknown users, session expiry, revocation, cross-tenant IDOR, every role, client scope, concurrent logins, browser restart, and cookie/CSRF/origin handling.
8. **Migration verification:** compare source identity/profile counts to D1 without printing user contents; verify every identity is mapped or has an explicit reset/re-enrollment status; verify no duplicate email/identity mappings or orphan profile links remain.
9. **Cutover gate:** production must continue using the current Supabase Auth proxy until all preceding gates pass and production login/session/device tests pass on desktop and iPhone. No domain reassignment is required for the current site recovery and must not be repeated as part of Auth migration.

## Current blockers

- The existing GitHub Preview Worker token can read Worker settings, deployment metadata, domains, and Staging schema, but its D1 database metadata request returned HTTP 401 / Cloudflare error 10000.
- The Staging migration workflow requires a separate least-privilege `CLOUDFLARE_D1_API_TOKEN` GitHub Environment secret with Account D1 Write access. It stopped before applying D1 migrations or deploying the Staging Worker because that secret was empty.
- The existing read-only schema snapshot shows only one `profiles` row and no record in `customs_admin_credentials`; there is no evidence of a complete multi-user Auth import.

## Production safety boundary

- Keep `darbandicommercial.ir`, `mobile.darbandicommercial.ir`, `chat.darbandicommercial.ir`, and `reminders.darbandicommercial.ir` on the existing `customs` Worker.
- Do not route production domains to the Staging Worker.
- Do not modify `main`, merge PR #314, change production Auth settings, invalidate sessions, or alter live user data as part of this staging-only work.
- Never print Cloudflare or Supabase secrets in workflow logs.
