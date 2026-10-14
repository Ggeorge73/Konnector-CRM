# Deploying Konnector CRM

Decided in `docs/adr/0001-hosting.md`: **Vercel** for the app, **Supabase Pro** for the database, auth and
storage, and sign-in with **Google + magic link** limited to `konnectorllc.com`.

| Environment | How it deploys                                                             | Data                            |
| ----------- | -------------------------------------------------------------------------- | ------------------------------- |
| Preview     | Vercel builds every pull request automatically                             | Demo store (no real data)       |
| Staging     | `Deploy` workflow after CI is green on `main`: migrate, deploy, smoke test | Supabase **staging** project    |
| Production  | `Deploy` workflow, run by hand with target `production`                    | Supabase **production** project |

Vercel never auto-deploys `main` (`vercel.json` → `git.deploymentEnabled`). That guarantees database
migrations always run before the code that needs them.

## One-time setup (owner: PO / IT)

Work through these in order. No secret ever goes in the repository. Each one lives in Supabase, Vercel or
GitHub.

### 1. Supabase: two Pro projects

1. Create projects `konnector-crm-staging` and `konnector-crm-prod` in region **East US (N. Virginia)**, on
   the Pro plan.
2. Production only: **Database → Backups**. Daily backups are on with Pro. Turn on **Point-in-time recovery**.
3. **Authentication → Providers**:
   - Turn on **Google**, using a Google Cloud OAuth client of type "Web application".
   - Turn on **Email** (magic link). Turn off email sign-up with password.
4. **Authentication → URL configuration**:
   - Site URL: the environment's app URL.
   - Redirect URLs: `<app URL>/auth/callback`.
5. Copy these four values for each project:
   - Project URL
   - `anon` key
   - `service_role` key
   - Database connection string: **Session pooler**, port 5432

The migrations create the private `files` storage bucket and its access rules. Nothing needs creating by hand.

### 2. Vercel: one project

1. Import the GitHub repo into Vercel and keep the Next.js defaults. The region comes from `vercel.json`
   (`iad1`, next to Supabase).
2. Under **Settings → Environment Variables**, set the variables listed in `.env.example`:

   | Variable                                               | Production                | Preview, branch `staging` | Preview (all other branches) |
   | ------------------------------------------------------ | ------------------------- | ------------------------- | ---------------------------- |
   | `DATA_BACKEND`, `NEXT_PUBLIC_DATA_BACKEND`             | `supabase`                | `supabase`                | `demo`                       |
   | Supabase URL / anon / service role                     | prod project              | staging project           | not set                      |
   | `APP_URL`                                              | production URL            | staging URL               | not set                      |
   | `ALLOWED_EMAIL_DOMAIN`                                 | `konnectorllc.com`        | `konnectorllc.com`        | `konnectorllc.com`           |
   | `CRON_SECRET`                                          | random, 32+ bytes         | different random value    | not set                      |
   | `APP_ENCRYPTION_KEY`                                   | `openssl rand -base64 32` | different value           | not set                      |
   | `KONNECTOR_INTEGRATION_SECRET`, `KONNECT_HUB_BASE_URL` | from Konnect Hub (S11)    | Konnect Hub staging       | not set                      |
   | `MOCK_KONNECT_HUB`                                     | not set                   | `true` until S11          | `true`                       |
   | `ALLOW_DEMO_RESET`                                     | **never**                 | **never**                 | `true`                       |
   | `ANTHROPIC_API_KEY`                                    | set to enable Copilot     | optional                  | not set (demo answers)       |
   | Google / Microsoft OAuth for mail sync                 | set (`docs/MAIL.md`)      | optional                  | not set                      |

   "Preview, branch `staging`" means a branch-scoped preview variable. The Deploy workflow pulls these for
   staging builds.

3. Keep **Deployment Protection** (Vercel Authentication) on for previews. Create an **automation bypass
   secret** so the workflow's smoke test can reach `/api/health`.
4. Add domains: production (for example `crm.konnectorllc.com`) and staging (for example
   `crm-staging.konnectorllc.com`).
5. Vercel Cron reads the schedules from `vercel.json`. It calls each job with `GET` and
   `Authorization: Bearer $CRON_SECRET`.

   | Job                      | Schedule (UTC)                |
   | ------------------------ | ----------------------------- |
   | `/api/cron/integrations` | every 5 minutes               |
   | `/api/cron/mail-sync`    | every 15 minutes              |
   | `/api/cron/daily`        | 10:55 daily (6:55 am Eastern) |

### 3. GitHub: environments for the Deploy workflow

Under **Settings → Environments**, create `staging` and `production`. Add required reviewers to `production`
so releases need a click.

| Secret / variable                              | Value                                                           |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `SUPABASE_DB_URL` (secret)                     | that environment's session-pooler connection string             |
| `VERCEL_TOKEN` (secret)                        | a Vercel access token, scoped to the team                       |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (secrets) | from `.vercel/project.json` after running `vercel link` locally |
| `VERCEL_AUTOMATION_BYPASS_SECRET` (secret)     | from step 2.3                                                   |
| `STAGING_DOMAIN` (variable, staging)           | for example `crm-staging.konnectorllc.com`                      |
| `PRODUCTION_URL` (variable, production)        | for example `https://crm.konnectorllc.com`                      |

### 4. First admin

There are no seed users in staging or production. Bootstrap each environment once, after its first migration:
see `docs/OPERATIONS.md` → "Bootstrap a new environment". It comes down to `pnpm db:bootstrap` before the first
sign-in, then `pnpm db:bootstrap --admin you@konnectorllc.com` after it. After that, everyone else waits on
the pending-access screen until an admin assigns them a role in Settings → Team.

## Releasing

- **Staging:** merge a PR to `main`. When CI goes green, `Deploy` migrates the staging database, deploys, and
  smoke-tests `/api/health`.
- **Production:** go to Actions → **Deploy** → Run workflow → target `production`, and approve the environment
  gate. It migrates production, deploys with `--prod`, and smoke-tests `/api/health`.
- **Roll back the app:** in Vercel, open Deployments, pick the previous production deployment and choose
  **Promote**.
- **Roll back the database:** migrations are forward-only. Write a new migration that reverts the change, or
  restore with point-in-time recovery. See `docs/OPERATIONS.md`.
