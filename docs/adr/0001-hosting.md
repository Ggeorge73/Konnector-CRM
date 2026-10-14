# ADR 0001 — Hosting, database plan and production sign-in

- **Status:** Proposed. Waiting on the Product Owner's decision (Jira KCRM-67).
- **Date:** 2026-10-14
- **Deciders:** Olugbenga George (PO / Business Owner)

## Context

Konnector CRM is a Next.js 15 app using Supabase for Postgres (with RLS), Auth and Storage. PI-3 takes it to
production (`docs/PI-3.md`). These choices are expensive to undo, so the build kit asks the PO to make them.

What the app needs from a host:

- Next.js App Router with server actions, route handlers and middleware.
- Three scheduled jobs that call our endpoints with `Authorization: Bearer $CRON_SECRET`:
  - `/api/cron/integrations` every 5 minutes
  - `/api/cron/mail-sync` every 15 minutes
  - `/api/cron/daily` once a day
- Secrets kept in the host's environment store, separately for preview, staging and production.
- A preview deployment per pull request, so the PO can see a change before it merges.
- A US region close to the Supabase project (Konnector is in Georgia).
- Log drains, so the structured logs from KCRM-72 can be kept and searched.

## Options

### 1. Vercel (recommended)

- **Pros:**
  - Built by the Next.js team, so every feature works without adapters.
  - Gives a preview URL for every PR out of the box.
  - Vercel Cron covers our three jobs; Pro is needed for the 5-minute schedule.
  - Has log drains and a US East region.
  - Supabase has a first-party integration that syncs its environment variables.
- **Cons:**
  - Per-seat pricing on Pro.
  - Function timeouts limit long jobs. Ours are short and already batched.
  - Some lock-in through Vercel-specific config. That is limited to `vercel.json`, because the app itself stays host-agnostic.

### 2. Netlify

- **Pros:**
  - Preview per PR.
  - Scheduled functions.
  - Comparable price.
- **Cons:**
  - Next.js support goes through an adapter that tends to lag new Next releases. Middleware and server actions have historically been the rough edges.
  - Scheduled functions would need a thin wrapper around our cron endpoints.

### 3. Container (Fly.io or Azure App Service)

- **Pros:**
  - Full control and no function timeouts.
  - Fits if Konnector standardises on Azure alongside Microsoft 365.
  - The same image could run anywhere.
- **Cons:**
  - We own the Dockerfile, scaling, TLS and rollouts.
  - No preview-per-PR without extra pipeline work.
  - Cron needs a separate scheduler.
  - Takes the most effort to stand up and keep healthy.

## Database plan (Supabase)

| Plan | Fit                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| Free | Not for production: projects pause when idle, and there are no backups                                               |
| Pro  | **Recommended.** Daily backups, point-in-time recovery as an add-on, no pausing, enough for the team's volume        |
| Team | Adds SSO to the Supabase dashboard and audit logs for the dashboard. Only worth it if the dashboard itself needs SSO |

## Production sign-in

**Recommended:** Google plus a magic-link fallback, limited to `ALLOWED_EMAIL_DOMAIN` (`konnectorllc.com`).

- Both are already built.
- KCRM-69 adds a server-side domain check and a "pending access" state, so new users see nothing until an
  admin assigns a role.
- Microsoft sign-in can be added later if the company moves to Microsoft 365.

## Environments

| Environment | Branch / trigger      | Database                          | Konnect Hub                   |
| ----------- | --------------------- | --------------------------------- | ----------------------------- |
| Preview     | every PR              | Demo store (`DATA_BACKEND=demo`)  | Mock                          |
| Staging     | `main`                | Supabase staging project          | Konnect Hub staging (KCRM-79) |
| Production  | release tag / promote | Supabase production project (Pro) | Konnect Hub production        |

## Decision

_To be filled in by the PO._ Once decided, this ADR is set to **Accepted**, and these stories can start:

- KCRM-68 (Supabase production)
- KCRM-70 (CI/CD)
- KCRM-71 (scheduled jobs)

## Consequences (if Vercel + Supabase Pro are chosen)

- `vercel.json` declares the three cron schedules. `CRON_SECRET` is set per environment.
- The Supabase ↔ Vercel integration manages the database environment variables. All other secrets are set
  in Vercel.
- Migrations run from CI against staging, then production, before each deploy.
