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

### Lookups — `/api/lookups`

Read-only reference data for the forms (shared by every organization).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/cities` | `search` (min. 2 characters, accent-insensitive), optional `state` (UF), `limit` (max 50) |
| `GET` | `/transaction-categories` | revenue and expense categories |
| `GET` | `/property-catalog` | for each property type: its subtypes and the usages allowed for it |

### KPIs — `/api/kpis`

Read-only indicators, calculated on every request from the stored data (nothing is persisted). Both endpoints take `asOf` (`YYYY-MM-DD`, default today).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/portfolio` | totals, counts by status and one row per property; optional `clientId` |
| `GET` | `/properties/:id` | the same indicators for one property |

Yields, cap rate and IRR are fractions (`0.07` = 7%); money is integer cents.

- **Revenue.** Manual mode: the rent typed on the property. Contract mode: the rent of the active conventional contract; for `short_stay` properties, the monthly average of the confirmed bookings whose check-in is in the last 12 months. `revenueSource` says which one applied. The expected occupancy rate applies to rents (expected income) but not to bookings (income already realized).
- **NOI** = annual revenue − annual expenses. **Gross yield** = revenue / estimated value. **Cap rate** = NOI / estimated value. Both are `null` without an estimated value.
- **Own use and loan for use** produce no income: they have no revenue or yields and stay out of the portfolio income, but their expenses are still reported and their value counts in the total patrimony.
- **Portfolio** totals are weighted by the ownership share. Yield and cap rate only use properties that have a value, on both sides of the division, so a property without a value cannot skew them.
- **IRR** is built from the monthly cash flow from the acquisition month to the `asOf` month: the acquisition cost goes out at month 0, each following month brings the operating result (current revenue − expenses, held constant), transactions land in the month they occur (recurring ones in every month until they end) and the estimated value comes back at the end. The monthly rate is found by bisection and annualized `(1 + r)^12 − 1`. It is `null` with a reason (`no_acquisition_date`, `no_acquisition_cost`, `no_estimated_value`, `period_too_short`, `no_solution`) when it cannot be computed. The acquisition (date and cost) is set on the property.

### Transactions — `/api/transactions`

One-off or monthly-recurring revenues and expenses of a property that are not rent (sale, renovation, financing installment, fees...). Rent comes from the contracts and reservations.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | `propertyId`, `categoryId`, `type` (`revenue` \| `expense`), `isRecurring`, `from` / `to` (inclusive, on `occurredOn`), `page`, `pageSize`; latest first |
| `POST` | `/` | `propertyId`, `categoryId`, `amountCents` (> 0), `occurredOn`, `description`, `isRecurring`, `recurrenceEndsOn` |
| `GET` | `/:id` | |
| `PATCH` | `/:id` | any subset except the property |
| `DELETE` | `/:id` | |

- The **category decides revenue vs expense** (`GET /api/lookups/transaction-categories`); the amount is always positive and `type` is derived from the category in every response.
- A recurring transaction repeats every month from `occurredOn` until `recurrenceEndsOn` (`null` = still running). An end date only makes sense on a recurring transaction and cannot be before the first occurrence. Turning recurrence off on a `PATCH` drops the end date.

### Properties — `/api/properties`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | `search` (name), `propertyType`, `usageType`, `clientId`, `page`, `pageSize` |
| `POST` | `/` | required: `name`, `propertyType`, `usageType`. Optional: details, money, `clientId`, nested `address` and `manualRental` |
| `GET` | `/:id` | |
| `PATCH` | `/:id` | any subset. `null` clears a nullable field; `address` / `manualRental` are replaced as a whole, `null` removes them |
| `DELETE` | `/:id` | removes the property and everything attached to it |

- Money fields (`*Cents`) are integer cents; percentages and areas are plain numbers.
- `status` is derived on every read: `own_use` and `loan_for_use` follow the usage; otherwise `rented` when there is a tenant or rent (manual mode) or an active contract (contract mode), else `vacant`.
- Cross-field rules are checked against the state after the write: the usage must be allowed for the property type, the subtype must belong to it, only parking properties have a spot label, and manual rental data is only accepted in manual mode. The client must exist in the organization and be visible to the caller.
- `acquisition` (`acquisitionType`, `acquiredOn`, `costCents`) is replaced as a whole like `address`; an inheritance needs a base date. It feeds the IRR (see KPIs).
- `legalRecord` (registration status, registry number/office, irregularity description only when irregular), `insurance` (a row means insured) and `financing` are nested the same way. A financing needs an acquisition by purchase or construction: sending one without it, or moving the acquisition to inheritance or removing it while financed, is a `400`.
- `agencyId` links the property to the agency that manages it (`/api/agencies`).
- `GET /api/properties/:id/financing-schedule?asOf=` returns the SAC or Price schedule (installment, interest, amortization and balance per month, due on the same day of each month, clamped to short months) and where the financing stands on `asOf`: paid and remaining installments, outstanding balance, total paid, total interest and the next installment. The nominal annual rate (percent) is split evenly into a monthly rate; rounding is per row and the last amortization absorbs the difference.
- Not covered yet: photos and documents (they wait for the object storage), geocoding.

### Agencies — `/api/agencies`

The agencies that manage the organization's properties; shared by every member. `GET /` (`search`, `page`, `pageSize`), `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (`409` while any property still uses it). The name is unique per organization.

### Proposals — `/api/properties/:propertyId/proposals`

Offers received or made on a property (`purchase`, `sale`, `rental`, `linked`, `informal`) with an amount in cents, a date, who made it and notes. `GET /` (`proposalType`, `page`, `pageSize`; latest date first), `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`. An unknown or invisible property is a `404`, not an empty list.

### Contracts — `/api/contracts`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | `propertyId`, `status`, `contractType`, `page`, `pageSize`; newest start first |
| `POST` | `/` | `propertyId`, `contractType`, `startDate`, optional `endDate`, `notes`; the occupant as `occupantId` **or** a new `occupant`; `rentTerms` for conventional contracts |
| `GET` | `/:id` | |
| `PATCH` | `/:id` | active contracts only: `endDate` (`null` = open-ended), `notes`, part of `rentTerms` |
| `POST` | `/:id/end` | optional `endDate`; active contracts only |
| `POST` | `/:id/cancel` | active contracts only |

- Contracts are **never deleted**: they are ended or cancelled, so the history stays. Deleting a property is the only thing that removes them.
- Creating a contract on a property that already has an active one **ends the old one in the same transaction** (its end date moves to the new start when that shortens it) and answers with `replacedContractId`. At most one active contract per property is also enforced by the database, so two concurrent requests cannot break it (the loser gets `409`).
- The property must be in `contract` rental mode and let out (not `own_use` / `loan_for_use`). `short_stay` contracts need a `short_stay` property and carry no rent terms; every other contract is `conventional` and needs them.
- An occupant with a document already stored in the organization is reused, not duplicated. Members only see occupants that appear in contracts of properties they created (`GET /api/occupants`).
- Calendar dates are `YYYY-MM-DD`; money is integer cents.

### Reservations — `/api/reservations`

Short-stay bookings (Airbnb-style) of properties with `short_stay` usage.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | `propertyId`, `contractId`, `status`, `from` / `to` (stays overlapping the window `[from, to)`, for a calendar), `page`, `pageSize`; latest check-in first |
| `POST` | `/` | `propertyId`, `checkIn`, `checkOut`, `totalAmountCents` (default 0), `notes`, optional `contractId`; the guest as `occupantId` **or** a new `occupant` |
| `GET` | `/:id` | |
| `PATCH` | `/:id` | confirmed reservations only: dates, total, notes, `contractId` (`null` unlinks) |
| `POST` | `/:id/cancel` | confirmed reservations only |

- **No overlap.** Two confirmed reservations of the same property cannot share a night; answers `409` naming the clashing reservation. The check-out day is free, so same-day turnover is allowed. A cancelled reservation frees its dates. The database enforces it too (`EXCLUDE` constraint), so concurrent requests for the same dates cannot both win.
- **Contract link (optional).** It must be an active `short_stay` contract of the same property and the stay must fall inside its period. It is only re-checked when the dates or the link change.
- Reservations are **never deleted**, only cancelled. `nights` is derived from the dates.
- Guests are occupants, like contract tenants: a known document reuses the stored occupant, and members see the guests of reservations on properties they created.

## Database

The model is normalized (3NF) and documented in [`docs/database/mybricks-database.dbml`](docs/database/mybricks-database.dbml), which can be pasted into [dbdiagram.io](https://dbdiagram.io).

- **Multi-tenant by organization.** Every foreign key between tenant tables is composite `(x_id, organization_id)`, so a row can never reference a parent of another organization.
- **Authorship** references `members(organization_id, user_id)`: the author must belong to the same organization.
- **Money** is stored as integer cents (`BigInt`). Convert in the DTO layer: `JSON.stringify` cannot serialize `BigInt`.
- **Derived values are never stored** (property status, IRR, cap rate, NOI, yield, financing installment and balance).
- **Rules Prisma cannot express** (one active contract per property, no overlapping confirmed reservations, `CHECK` constraints, case-insensitive unique e-mail) live in the hand-written migration `prisma/migrations/*_manual_constraints`. Prisma does not treat them as drift.
- **Reference data** (cities, subtypes, allowed usages, transaction categories) is seeded and idempotent. Display names are pt-BR; codes (enum values) stay in English.
- **Deleting an organization** must delete in order inside one transaction (properties, stored files, clients, occupants, agencies, organization). Postgres checks each cascade step separately, so a plain `DELETE` of the organization fails by design.

## Tests

[Vitest](https://vitest.dev), with PostgreSQL running (`npm run db:up`).

```bash
npm test            # whole suite
npm run test:watch  # re-run on change
```

- **Isolated database.** Tests run against `<database>_test` on the same server (created, migrated and seeded automatically before the run), never against the development database. The helpers refuse to truncate anything whose name does not end in `_test`.
- **`tests/unit`**: pure logic with no database (the KPI calculations).
- **`tests/api`**: the real app wired against the test database and called in-process, one file per module. Each file tells one scenario in order (sign-ups, then creation, validation, listing, editing, visibility of members, isolation between organizations, deletion), so run a file as a whole rather than a single test. Checks inside a test are soft: a run reports every broken expectation, each with its name and the response that broke it.
- Better Auth skips its own origin check when `NODE_ENV=test`, so only the app-level CORS is covered.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API with reload |
| `npm run build` / `npm start` | compile and run |
| `npm run typecheck` | TypeScript check |
| `npm test` / `test:watch` | Vitest suite (see Tests) |
| `npm run db:up` / `db:down` | start / stop local PostgreSQL |
| `npm run db:migrate` | create/apply migrations (dev) |
| `npm run db:seed` | seed reference data: 5,571 IBGE municipalities, property subtypes, allowed usages per property type, transaction categories |
| `npm run db:seed:fetch-cities` | regenerate `prisma/seed/data/cities.json` from the IBGE API |
| `npm run db:deploy` | apply migrations (production) |
| `npm run db:studio` | Prisma Studio |

## Conventions

- Code, API and commits in English; UI texts in pt-BR (front-end).
- Conventional Commits.
