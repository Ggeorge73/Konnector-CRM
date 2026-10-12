# Konnector Copilot

Claude-powered drafts inside the CRM. Open any account, contact or opportunity and press **Copilot**.

| Task               | Where                           | What you get                                                         | What you click           |
| ------------------ | ------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| Summarise account  | Account                         | Headline, situation, opportunities, risks, next actions              | Copy · Save as note      |
| Draft follow-up    | Account, contact, opportunity   | Subject + body grounded in the timeline, optional extra instructions | Edit · Copy · Log · Send |
| Suggest Bid/No-Bid | Opportunity (owner, executives) | 1–5 score per criterion with reasons, verdict, open questions        | Use in scorecard         |
| Notes → follow-ups | Account, contact, opportunity   | Concrete BD tasks with due dates and priority                        | Tick, then Create tasks  |
| RFP checklist      | Opportunity with a PDF          | Key dates, every requirement with its reference, evaluation criteria | Create proposal tasks    |

## Configuration

| Env var             | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | Server-side key. Never exposed to the browser.               |
| `COPILOT_MODE`      | `auto` (default: live when a key is set), `live`, or `demo`. |

Requests use structured outputs validated with Zod, adaptive thinking and per-task effort (low for
emails and notes, high for bid and RFP work). Refusals, truncated answers and outages are shown as a
friendly message and logged with status `refused` or `error`.

## Code

- `src/lib/copilot/context.ts` — role-scoped context builders (the only place prompts get CRM data).
- `src/lib/copilot/run.ts` — permission checks, rate limit, model call, validation, usage log.
- `src/lib/copilot/anthropic.ts` — the Claude API adapter (`server-only`).
- `src/lib/copilot/demo.ts` — demo-mode answers.
- `src/components/copilot/` — the drawer and the `/copilot` usage page.
- Tests: `src/lib/__tests__/copilot.test.ts` (fake model), `e2e/copilot.spec.ts` (demo mode).
