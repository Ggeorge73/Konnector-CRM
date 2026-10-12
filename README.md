# Konnector CRM

Konnector LLC's internal system for winning work — from first signal to signed contract: accounts,
capture pipeline, government bids, Bid/No-Bid, quotes with margin guardrails, registrations, partner
vetting, consultant bench, BD events, and the handoff to **Konnect Hub** (delivery) with project health
and client decisions flowing back.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000 — demo data, sign in as any role
```

Production uses Supabase (`DATA_BACKEND=supabase`, see `.env.example`, `docs/DATABASE.md`).

## Docs

- `CLAUDE.md` — commands, architecture, conventions
- `docs/PI-1.md` — SAFe PI plan, team, board flow (Jira project KCRM)
- `docs/PROGRESS.md` — what shipped each sprint
- `docs/DATABASE.md` — schema, row-level security, role matrix
- `docs/INTEGRATION.md` — Konnect Hub contract v1
