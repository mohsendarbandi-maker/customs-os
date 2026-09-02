# Customs OS

Customs OS is a multi-tenant Customs Clearance & Logistics Management System designed for Iranian customs brokerage operations.

## Phase 1 Purpose
The objective of Phase 1 is strictly the **Database Foundation**. It establishes:
- Multi-tenancy isolation enforced at the PostgreSQL database level
- Complete normalized schema covering cases, shipments, containers, declarations, permits, finance, and documents
- Row Level Security (RLS) policies across all tenant-scoped tables
- Database triggers for tenant immutability, role-escalation prevention, broker assignment validation, and audit trails
- Client-role data scoping ensuring clients access only their own dossiers

Phase 1 does NOT contain application UI, authentication screens, dashboards, AI, OCR, or third-party integrations.

## Architecture & Technology Stack
- **Database:** PostgreSQL via Supabase (Migrations in `supabase/migrations/`)
- **Frontend Core:** React + Vite + TypeScript (Scaffolding only)
- **Styling:** Tailwind CSS
- **State & Routing:** TanStack Query, React Router DOM
- **Testing:** Vitest

## Verification Status
**CURRENT STATUS: NOT READY / NOT LOCKED**

Phase 1 source code has been statically prepared. However, live execution commands (`npm install`, `npm run build`, `npm run lint`, `npm test`, and `supabase db reset`) require execution in a local shell environment with a running Supabase container. Phase 2 must not begin until live database verification passes. See `PHASE1_VERIFICATION_STATUS.md`.
