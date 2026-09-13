# Customs OS

Customs OS is a multi-tenant Customs Clearance & Logistics Management System designed for Iranian customs brokerage operations.

## Current implementation

The repository now contains the database foundation plus the operational customs workflow used by the application:

- Multi-tenant PostgreSQL/Supabase schema with RLS and role-based access for owner/admin/broker/accountant/warehouse/client.
- Cargo-owner registry, independent registration orders, maritime/B/L data, declarations/EPL, valuation, documents, permits, finance, cargo exit, case history and stage control.
- Configurable permit rules and case completion/integrity checks.
- Immutable audit and status-history protections.
- Offline RPC queue for a deliberately limited set of replay-safe workflow updates; authentication/session operations and case creation are never queued automatically.
- EPL credentials stored in Supabase Vault; the browser receives only username and password-configured status, never the plaintext password.

## Architecture & Technology Stack

- **Database:** PostgreSQL via Supabase (`supabase/migrations/`)
- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS
- **State & Routing:** React state + React Router DOM; TanStack Query available for expansion
- **Testing:** Vitest
- **Runtime:** Node 22+

## Workflow model

The application follows the real customs sequence: preliminary maritime/cargo data -> unloading and release documents -> cargo-owner document pack -> valuation -> EPL declaration and kottaj -> customs path and permits -> payment -> exit -> completion/archive.

Kottaj is treated as an EPL output, not as an initial case field. A B/L uniqueness key is scoped by organization, shipping line, B/L number and B/L year.

## Release status

**CURRENT STATUS: RELEASE CANDIDATE — NOT YET VERIFIED FOR PRODUCTION**

Remaining release gates are operational verification against the live Supabase project, tenant-isolation testing with an additional tenant, successful CI on the latest `main`, and a successful Vercel production deployment serving that commit. The repository's `RELEASE_READINESS.md` is the authoritative release checklist.
