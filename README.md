# MyBricks API

Back-end of **MyBricks**, a real-estate portfolio management platform: properties, clients, rental contracts and short-stay reservations, finances and portfolio KPIs (yield, cap rate, NOI, IRR).

> Portfolio project. Front-end: [my-bricks-front-end](https://github.com/JoaoAlfredoMader/my-bricks-front-end).

## Stack

- **Hono** on Node.js (TypeScript, ESM)
- **Prisma 7** + **PostgreSQL 17**
- **Better Auth** (organization, admin and anonymous plugins), wired in a later step
- **Docker Compose** for local services
- **Zod** for validation

## Architecture

Layered API. Dependencies point downwards and are wired by hand with factories (no DI framework).

```
route  →  controller  →  service  →  repository
```

| Layer | Responsibility |
|---|---|
| Route | HTTP binding: path, input validation, serialization |
| Controller | Receives validated input (never the Hono `Context`), calls the service, maps the result to status + DTO |
| Service | Business rules and calculations |
| Repository | The only layer that talks to Prisma |

```
src/
├── app.ts                 # Hono app factory (routes, error handling)
├── server.ts              # process entry point
├── config/env.ts          # validated environment
├── lib/prisma.ts          # Prisma client with the pg driver adapter
├── shared/errors/         # typed domain errors
└── modules/<feature>/     # route, controller, service, repository
```

## Getting started

```bash
cp .env.example .env   # then set BETTER_AUTH_SECRET (openssl rand -base64 48)
npm install
npm run db:up          # PostgreSQL on localhost:5433
npm run db:generate    # Prisma client -> src/generated/prisma
npm run db:migrate     # apply migrations
npm run db:seed        # reference data (idempotent)
npm run dev            # http://localhost:3000/health
```

## Authentication

[Better Auth](https://www.better-auth.com) mounted at `/api/auth/*`, with the `organization`, `admin` and `anonymous` plugins. E-mail/password always; Google when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

- **Every user works inside an organization (the tenant).** Signing up creates a personal organization (`Portfólio de <first name>`) with the user as `owner`, and activates it on every session.
- **Guest mode.** `POST /api/auth/sign-in/anonymous` creates a guest user with a demo organization that expires after `DEMO_TTL_HOURS` (default 24).
- **Guest becomes a real user.** Signing up while holding a guest session adopts the demo workspace: memberships move to the new user, authorship foreign keys follow through `ON UPDATE CASCADE`, the demo flag is cleared and the empty personal organization is dropped.
- **Invitations are links.** There is no e-mail provider yet: `POST /api/auth/organization/invite-member` returns the invitation id, and the front-end builds the link from it.
- **Platform admin.** The `admin` plugin role lives on `users.role`; it enables the `/api/auth/admin/*` endpoints (list users, impersonation).
- **`GET /api/me`** returns the authenticated user, the active organization and the member role. Domain routes read this context (`c.var.auth`) and never trust an organization id sent by the client.
- Better Auth runs with `advanced.database.generateId: false`: ids come from the database (`gen_random_uuid()`).
- The cookie is sent cross-origin only to `FRONTEND_URL` (CORS with credentials + `trustedOrigins`). In production keep front and API under the same parent domain.

## API conventions

- **Tenant scope.** Routes call `tenantScope(c)`, which reads the organization and role from the session. Owners and admins see every record of the organization; members only the ones they created. A record outside the caller's scope answers `404`, never `403`, so ids of other tenants do not leak.
- **Validation** happens in the route layer with Zod (`validate("json" | "query" | "param", schema)`). Failures answer `400` with `{ error: { code: "VALIDATION_ERROR", details: [{ path, message }] } }`.
- **Errors** are typed `AppError`s turned into `{ error: { code, message, details? } }` by the app-level handler: `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict, `422` business rule.
- **Lists** are paginated: `?page=1&pageSize=20` (max 100) answering `{ items, page, pageSize, total }`.

### Clients — `/api/clients`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | `search` (name, document digits, e-mail), `personType`, `page`, `pageSize` |
| `POST` | `/` | `name`, `personType` (`individual` default \| `company`), optional `document`, `email`, `whatsapp` |
| `GET` | `/:id` | |
| `PATCH` | `/:id` | any subset of the create fields; `null` clears an optional field |
| `DELETE` | `/:id` | `409` while the client still has properties |

`document` is a CPF for individuals and a CNPJ for companies, validated with check digits (alphanumeric CNPJ supported) and stored without punctuation. It is unique per organization. `whatsapp` is stored as digits only.

## Database

The model is normalized (3NF) and documented in [`docs/database/mybricks-database.dbml`](docs/database/mybricks-database.dbml), which can be pasted into [dbdiagram.io](https://dbdiagram.io).

- **Multi-tenant by organization.** Every foreign key between tenant tables is composite `(x_id, organization_id)`, so a row can never reference a parent of another organization.
- **Authorship** references `members(organization_id, user_id)`: the author must belong to the same organization.
- **Money** is stored as integer cents (`BigInt`). Convert in the DTO layer: `JSON.stringify` cannot serialize `BigInt`.
- **Derived values are never stored** (property status, IRR, cap rate, NOI, yield, financing installment and balance).
- **Rules Prisma cannot express** (one active contract per property, no overlapping confirmed reservations, `CHECK` constraints, case-insensitive unique e-mail) live in the hand-written migration `prisma/migrations/*_manual_constraints`. Prisma does not treat them as drift.
- **Reference data** (cities, subtypes, allowed usages, transaction categories) is seeded and idempotent. Display names are pt-BR; codes (enum values) stay in English.
- **Deleting an organization** must delete in order inside one transaction (properties, stored files, clients, occupants, agencies, organization). Postgres checks each cascade step separately, so a plain `DELETE` of the organization fails by design.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API with reload |
| `npm run build` / `npm start` | compile and run |
| `npm run typecheck` | TypeScript check |
| `npm run db:up` / `db:down` | start / stop local PostgreSQL |
| `npm run db:migrate` | create/apply migrations (dev) |
| `npm run db:seed` | seed reference data: 5,571 IBGE municipalities, property subtypes, allowed usages per property type, transaction categories |
| `npm run db:seed:fetch-cities` | regenerate `prisma/seed/data/cities.json` from the IBGE API |
| `npm run db:deploy` | apply migrations (production) |
| `npm run db:studio` | Prisma Studio |

## Conventions

- Code, API and commits in English; UI texts in pt-BR (front-end).
- Conventional Commits.
