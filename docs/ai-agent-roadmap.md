# AI Agent Delivery Log

This file is the **source of truth for AI-assisted work** on this project. Every agent (Claude Code, Codex, GPT, etc.) must read the last entry before starting and add a new entry when done.

---

## How to use this file

**Before starting work:**
1. Read the latest row in the delivery table — understand what was done last.
2. Read "Backlog" — understand what is expected next.
3. If your task is not aligned with the backlog, flag it before proceeding.

**After completing work:**
1. Add a new row at the **top** of the delivery table (newest first).
2. Fill in all columns — date, agent, summary, reference (PR/spec/file), and next steps.
3. Update the Backlog section if priorities changed.
4. Update `README.md` if the API surface, infra, or contracts changed.

---

## Delivery Table

| Date | Agent | Delivered | Reference | Next Steps |
|---|---|---|---|---|
| 2026-04-14 | Claude Code | **E2E validation (Playwright):** 41 checks across all user flows — register → auto-login → setup-1, login (bad/good creds), provider switching, key toggle, gated next button, duplicate email, short password, provider-change state reset. **Bug fixed:** duplicate email returned 500 Internal Server Error; now returns 409 `"Este email já está cadastrado."` (pg error code 23505). | commits `79ec67b` | Setup-2 and done-screen E2E coverage; settings panel E2E |
| 2026-04-14 | Claude Code | **Setup wizard UX overhaul:** provider grid 4×1 → 2×2 with icons + FREE badge on OpenRouter; dynamic placeholder per provider (`sk-ant-...`, `sk-...`, `AIza...`, `sk-or-v1-...`); per-provider guide box with 3-step instructions + visible CTA button linking to key generation page; "Próximo →" helper text ("↑ Teste a conexão antes de continuar") shown until test passes and hidden on success; guide built via DOM API (no innerHTML — XSS-safe). | commits `e6de95c`, `e8d12f2` | — |
| 2026-04-14 | Claude Code | **OpenRouter support:** 4th LLM provider using OpenAI-compatible API (`POST /openrouter.ai/api/v1/chat/completions`) with `HTTP-Referer` header; 7 free-tier models listed (llama-3.3-70b, deepseek-r1, llama-3.1-8b, llama-3.2-3b, gemma-2-9b, mistral-7b, qwen-2.5-7b); added to provider enum validation in settings route. | commits `16849c2` | — |
| 2026-04-14 | Claude Code | **LLM provider setup wizard (setup-1 + setup-2 screens):** `POST /api/setup/test-llm` saves provider/key/model to DB, calls LLM with a test prompt, restores previous settings on failure; `GET/PUT /api/settings` with masked sensitive values; `settingsService` with in-memory cache; migration `007_add_settings.sql`. Providers: Anthropic, OpenAI, Gemini. | commits `ae3510a`–`cfcefb2` | — |
| 2026-04-14 | Claude Code | **Auth system + setup wizard shell:** JWT auth (`@fastify/jwt` + `@fastify/cookie`); register, login, logout, `/api/auth/me` routes; migration `006_add_users.sql`; single-file `src/ui.html` wizard with screens: register, login, setup-1, setup-2, done, app, settings panel; CSP fixed (`unsafe-inline` for inline scripts). **Critical bug fixed:** register endpoint was not issuing JWT cookie — user reached setup-1 without session, all auth-protected calls returned 401 showing misleading "Erro na conexão.". Fix: register now signs JWT and sets cookie (`RETURNING id`). | commits `84ce181`, `10f149d` | — |
| 2026-03-22 | Claude Code | Integration test stack: DB helper (`pool`, `runMigrations`, `truncateAll`), fake n8n server (queue-based `waitForRequest`), 3 integration tests for `POST /webhooks/meta/lead-ads`, 4 integration tests for `POST /webhooks/v1/leads`. CI gains `postgres:16` service container and runs integration tests sequentially. | `docs/superpowers/plans/2026-03-22-integration-test-stack.md` · commits `0881e4a`–`400127d` | Prometheus alerting rules |
| 2026-03-22 | Claude Code | Project hygiene: `vitest.config.ts` scoping test discovery to `tests/` only (prevents worktree duplication). | [PR #12](https://github.com/amaralthedoug/testn8nmetaapi/pull/12) | Integration test container stack |
| 2026-03-22 | Claude Code | Docker fixes: `env_file` changed from `.env.example` to `.env`; Postgres healthcheck (`pg_isready`) added; `depends_on` uses `condition: service_healthy`; `restart: on-failure` on app. | [PR #11](https://github.com/amaralthedoug/testn8nmetaapi/pull/11) | vitest.config.ts |
| 2026-03-22 | Claude Code | Migration runner rewritten to run all `*.sql` files in order with `schema_migrations` tracking table (idempotent, rollback on error). `002_placeholder.sql` added to close sequence gap. | [PR #10](https://github.com/amaralthedoug/testn8nmetaapi/pull/10) | Docker fixes |
| 2026-03-22 | Claude Code | CI pipeline: GitHub Actions workflow (`npm ci → tsc --noEmit → eslint → vitest`) on push/PR to main. ESLint v9 flat config (`eslint.config.js`) with `@typescript-eslint` rules. | [PR #9](https://github.com/amaralthedoug/testn8nmetaapi/pull/9) | Migration runner fix |
| 2026-03-22 | Claude Code | README revised: Instagram integration section, `POST /webhooks/v1/leads` contract + response table, `BACKEND_API_KEY` documented, multi-tenant routing section, migrations table, updated architecture diagram and project structure. | [PR #8](https://github.com/amaralthedoug/testn8nmetaapi/pull/8) | CI pipeline |
| 2026-03-22 | Claude Code | Instagram SDR integration: `POST /webhooks/v1/leads` unified endpoint (Bearer `X-Api-Key`), Zod schema, mapper v1.0, `lead_sources` table (migrations 004/005), `leadSourcesRepository`, unified webhook controller with mapper registry. 86 tests passing. | `docs/superpowers/specs/2026-03-22-instagram-sdr-integration-design.md` · [PR #7](https://github.com/amaralthedoug/testn8nmetaapi/pull/7) | README update |
| 2026-03-21 | Claude Code | Multi-tenant routing + per-form field mapping. `routing.json` with form→page→default→env cascade. `resolveRoute` and `applyFieldMap` pure functions. `leads.n8n_target_url` persisted for retry correctness. `app.decorate` wiring. 63 tests passing. | `docs/superpowers/specs/2026-03-21-multi-tenant-routing-design.md` · [PR #6](https://github.com/amaralthedoug/testn8nmetaapi/pull/6) | Instagram SDR integration |
| 2026-03-21 | Claude Code | Dead-letter replay RBAC spec and implementation plan. CLAUDE.md conventions doc. README rewrite with architecture, env vars, observability, and roadmap sections. `.env.example` updated with `ADMIN_API_KEY` and `META_APP_SECRET`. | `docs/superpowers/specs/2026-03-21-dead-letter-replay-rbac-design.md` · `docs/superpowers/plans/2026-03-21-dead-letter-replay-rbac.md` · [PR #5](https://github.com/amaralthedoug/testn8nmetaapi/pull/5) | Multi-tenant routing |
| 2026-03-21 | Claude Code | OpenAPI docs (`GET /docs`) and Prometheus metrics (`GET /metrics`). Added `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui`, `fastify-metrics`. Zod schemas on all routes. Downgraded `fastify-raw-body` and `@fastify/helmet` to Fastify v4-compatible versions. 16 tests, TS clean. | [PR #3](https://github.com/amaralthedoug/testn8nmetaapi/pull/3) · `docs/superpowers/specs/2026-03-21-openapi-prometheus-design.md` | Dead-letter replay API with RBAC |
| 2026-03-21 | Claude Code | HMAC `X-Hub-Signature-256` validation on `POST /webhooks/meta/lead-ads`. | [PR #2](https://github.com/amaralthedoug/testn8nmetaapi/pull/2) | OpenAPI docs + Prometheus metrics |
| 2026-03-21 | Claude Code | Hybrid Facebook Lead Ads ingestion backend: webhook → PostgreSQL → n8n async delivery with retries and deduplication. | [PR #1](https://github.com/amaralthedoug/testn8nmetaapi/pull/1) | HMAC signature validation |
| 2026-03-21 | Codex | Created this delivery log. | `docs/ai-agent-roadmap.md` | Keep updated after each delivery |

---

## Backlog

Priority order — work top to bottom.

| Priority | Item | Notes |
|---|---|---|
| 🔴 High | E2E coverage: setup-2, done screen, settings panel | Playwright tests for the second half of the wizard and the settings slide-over |
| 🟡 Medium | Settings panel: LLM test button | Allow re-testing the LLM key from settings panel without going through the wizard again |
| 🟡 Medium | Setup-2 E2E — Meta Verify Token + App Secret validation | Currently only unit tested via the route handler |
| 🟡 Medium | Prompt tester — `askAnthropic` ignores apiKey/model params | `promptTesterService.ts` calls `askLLM()` (DB settings) instead of using the key/model passed by the tester UI — inconsistency between tester tab and demo tab |
| 🟢 Low | Prometheus alerting rules | Define alert thresholds for delivery failure rate and latency. |
| 🟢 Low | Grafana dashboard | Visualize `http_request_duration_seconds` and delivery attempt metrics. |

---

## Conventions

- **Newest row first** in the delivery table.
- **One row per PR** — not per commit.
- **Reference must be a PR link or a spec/design file path** — never a raw commit SHA.
- **Next Steps must reflect the backlog** — if you reorder priorities, update both.
- If a task was validated manually, note it in the summary (e.g., "verified manually in staging").
