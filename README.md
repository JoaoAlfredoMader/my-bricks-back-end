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

## API reference (OpenAPI)

- **`GET /api/openapi.json`**: the OpenAPI 3.1 document, built at start-up from the Zod schemas the routes already validate with (public: it describes the API, it exposes no data).
- **`GET /api/docs`**: a readable reference page (Scalar) for that document. Better Auth documents its own endpoints (`/api/auth/*`) at `/api/auth/reference`.
- **`docs/openapi.json`** is a committed copy (`npm run openapi:export` regenerates it), so the front-end can generate its typed client from the repository:

  ```bash
  npx openapi-typescript docs/openapi.json -o src/api/schema.d.ts
  ```

  Every operation has an `operationId` (`listClients`, `createProperty`, `getPortfolioKpis`...), which is the name of the function in a generated client. Request bodies and responses are named components (`CreatePropertyRequest`, `Property`, `PropertyPage`, `ErrorResponse`...).
- **How it stays true.** `src/openapi/routes.ts` describes each endpoint once (method, path, who may call it, the request schemas the route validates with, the response schema). The response schemas are checked against the TypeScript DTOs the services return, and tests then:
  - compare the registry with the routes the app really registers, **in both directions**: a new endpoint without an entry, or an entry for a route that does not exist, fails the build;
  - validate the document as OpenAPI 3.1 and check that every reference resolves;
  - **call every operation against the real API** (the guest workspace with the sample portfolio) and check each answer: the status must be documented, the body must parse with its response schema and carry **nothing the schema does not describe**, errors must be an `ErrorResponse`, and every operation must have been exercised;
  - fail when `docs/openapi.json` is stale.
- To add an endpoint: write the route, add its entry to `OPERATIONS` (and `output()` / `input()` for new schemas), run `npm run openapi:export`.

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
| `GET` | `/` | `propertyId`, `categoryId`, `type` (`revenue` \| `expense`), `isRecurring`, `from` / `to` (inclusive period, see below), `page`, `pageSize`; latest first |
| `POST` | `/` | `propertyId`, `categoryId`, `amountCents` (> 0), `occurredOn`, `description`, `isRecurring`, `recurrenceEndsOn` |
| `GET` | `/:id` | |
| `PATCH` | `/:id` | any subset except the property |
| `DELETE` | `/:id` | |

- The **category decides revenue vs expense** (`GET /api/lookups/transaction-categories`); the amount is always positive and `type` is derived from the category in every response.
- A recurring transaction repeats every month from `occurredOn` until `recurrenceEndsOn` (`null` = still running). An end date only makes sense on a recurring transaction and cannot be before the first occurrence. Turning recurrence off on a `PATCH` drops the end date.
- **Period filter (`from` / `to`).** A one-off transaction is kept when its `occurredOn` is inside the period. A recurring one is a single record that stands for a charge every month, so it is kept when its run touches the period: it started on or before `to` and it has no end or ends in the month of `from` or later. The end counts **by month, inclusive** (an end date on any day of the month of `from` still reaches it), which is the same reading the IRR cash flow and the monthly cash flow (`/api/kpis/cash-flow`) use. A monthly charge that began in 2021 and never ended therefore shows up in "this year". Ordering (`occurredOn` desc) and pagination do not change; the other filters combine with the period.

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
- Not covered yet: geocoding (latitude and longitude stay empty).

### Guest workspace and maintenance

- **A guest gets a workspace worth exploring.** Signing in as a guest creates a demo organization that expires after `DEMO_TTL_HOURS` and fills it with a made-up portfolio built around *today*: 9 properties (apartments, a short-stay flat, a commercial room, a logistics warehouse, a plot, a beach house, a parking spot, a vacant apartment), 3 clients, an agency, 4 contracts (one ended, one about to end), 8 reservations (one coming up, one cancelled), expenses and a revenue, proposals, a financing with its schedule and an irregular registry. The indicators come out plausible (portfolio cap rate in the single digits, IRR where there is an acquisition). The guest can change everything, generate a contract PDF and upload files on top of it. If the sample cannot be written (for instance the reference data was never seeded) the guest still gets a working, empty workspace. If the guest signs up for real, the workspace is kept with all its data.
- **Housekeeping.** `npm run maintenance` runs it once (cron-friendly); the server also runs it at start and every `MAINTENANCE_INTERVAL_MINUTES` (default 60, `0` turns it off), never overlapping with itself. Each run:
  1. deletes **expired demo organizations** with everything in them. The objects in the storage go first, then the rows in the order Postgres needs (feedback, properties and what hangs from them, stored files, clients, occupants, agencies, the organization). If an object cannot be deleted the organization is kept and retried on the next run, instead of orphaning the file. The guest accounts that owned them are removed too, unless the guest still belongs to another organization;
  2. sweeps **orphan files** older than an hour;
  3. purges **audit entries** older than 12 months;
  4. purges **expired sessions and verification tokens**.
  It returns a report with the counts. Real (non-demo) organizations are never candidates.
- **Composition root.** `src/container.ts` wires the app by hand; the server, the scripts and the tests all build it from there.

### Feedback — `/api/feedback`

Any signed-in user (guests included) can `POST /` a message (3 to 5000 characters) and `GET /` what they sent (`status`, `page`, `pageSize`). An attachment is not supported yet.

### Platform admin — `/api/admin/*`

The owner panel. It needs the `admin` platform role (`users.role`, set in the database or by another admin); being the owner of an organization is not enough, and a session that is *impersonating* never gets these routes.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/feedback` | everything every organization sent, with author and organization (`status`, `page`, `pageSize`) |
| `PATCH` | `/api/admin/feedback/:id` | `{ "status": "open" \| "resolved" }` |
| `GET` | `/api/admin/audit-logs` | the whole audit trail, optionally narrowed with `organizationId` |
| — | `/api/auth/admin/*` | Better Auth's admin plugin: list/ban users, `impersonate-user`, `stop-impersonating` |

**Creating the operator.** `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run admin:create` (optional `ADMIN_NAME`). Idempotent: it creates the account if it does not exist (through Better Auth, so the password is hashed the way sign-in expects), promotes it if it exists without the role, and does nothing if it is already an admin. An existing account keeps its password and data. The password is read from the environment so it never lands in the shell history, and it is never printed.

**Impersonation** ("see as"): the session becomes the target user's and `/api/me` reports `impersonatedById`. The admin can read and edit as that user, but **every `DELETE` answers `403`** until `stop-impersonating`, and everything done in the meantime is audited with the impersonator.

### Audit log — `/api/audit-logs`

`GET /` returns the trail of the caller's organization, **only for owners and admins** (members get `403`; the organization comes from the session, never from the query). Filters: `action`, `entityType`, `actorUserId`, `from` / `to` (calendar days, inclusive), `page`, `pageSize` (max 100). Newest first; the numeric `id` travels as a string.

- **What is recorded.** Successful (2xx) creations, updates and deletions of properties, clients, transactions, contracts (including `end_contract` and `cancel`) and reservations, feedback, plus logins (e-mail, guest, sign-up, social), logouts, member invitations and removals, and impersonation start/end. Reads, rejected requests (4xx) and blocked deletes leave no trace. Each route opts in with `audited(action, entityType)`; the record id is the `:id` of the path or the `id` of the created resource.
- **Each entry has** the actor (a snapshot of name, e-mail and role, so it stays readable after the user is deleted), the organization (`null` for platform-level events), the impersonator when there is one, the request (`method`, `path`, `status` in `details`), the address (from `x-forwarded-for` / `x-real-ip`, so run behind a proxy that sets it) and the browser.
- **Writing never breaks the action**: a failure to write is logged and swallowed.
- **Retention** is 12 months: the repository can purge older entries; the periodic job comes with the demo cleanup.

### Contract template and PDF

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/contract-template` | the organization's template, or the default one (`isDefault: true`), with the catalog of tokens and any unknown token in the text |
| `PUT` | `/api/contract-template` | `{ header, clauses, footer }` as HTML; **owners and admins only** |
| `DELETE` | `/api/contract-template` | back to the default; owners and admins only |
| `POST` | `/api/contracts/:id/pdf` | renders the contract with the template and stores it as the contract's PDF |
| `GET` | `/api/contracts/:id/pdf` | downloads it (attachment, never cached) |

- **Tokens** are written in Portuguese because the people who edit the template are Brazilian landlords: `{{locador}}`, `{{documento_locador}}`, `{{locatario}}`, `{{documento_locatario}}`, `{{imovel}}`, `{{endereco}}`, `{{valor_mensal}}`, `{{dia_vencimento}}`, `{{indice_reajuste}}`, `{{data_inicio}}`, `{{data_fim}}`, `{{data_emissao}}`. Values are HTML-escaped (a tenant named `<b>x</b>` shows as text), and an unknown token stays as typed so a typo is visible in the PDF and listed in `unknownPlaceholders`. The landlord is the property's client (its owner) or, without one, the organization.
- **Sanitizing.** Only `p`, `h1`–`h3`, `ul`/`ol`/`li`, `br`, `strong`/`b`, `em`/`i` and `u` survive, without attributes; scripts, styles, links, images and iframes are dropped (a `div` becomes a paragraph). A template whose clauses end up with no text is refused.
- **The PDF** is an A4 document written with `pdfkit` and the standard Helvetica fonts (they cover Portuguese): centered header, justified clauses, signature lines for the landlord and the tenant, footer and "Página i de n". Only characters of the Latin-1/Windows-1252 set render correctly.
- Only **conventional** contracts have a PDF (the text talks about monthly rent, due day and adjustment); a short-stay contract answers `422`. Generating again replaces the previous PDF (its record and object are removed), and the contract exposes `pdfUrl` once it has one. The default contract is a plain residential lease meant as a starting point, not legal advice.

### Photos — `/api/properties/:propertyId/photos`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | the photos in order (position 0 is the cover) |
| `POST` | `/` | multipart form, field `file`: JPEG, PNG or WebP; up to 30 photos per property; goes to the end of the list |
| `PUT` | `/order` | `{ "photoIds": [...] }`: every photo of the property exactly once, in the wanted order |
| `GET` | `/:id/content` | the image (inline), authenticated by the session cookie |
| `DELETE` | `/:id` | removes the photo, its file record and its object |

### Documents — `/api/properties/:propertyId/documents`

`GET /` (optional `category`, case-insensitive), `POST /` (multipart: `file` plus an optional `category` of up to 50 characters; PDF, JPEG, PNG, WebP, DOCX or XLSX), `GET /:id/content` (always an `attachment`, never cached), `PATCH /:id` (`{ "category": string | null }`) and `DELETE /:id`.

### Uploads and storage

- **Drivers.** `STORAGE_DRIVER=local` keeps files in `STORAGE_DIR` (development); `s3` talks to any S3-compatible bucket (R2, B2, MinIO, AWS) with `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` and `S3_FORCE_PATH_STYLE`. Switching is configuration only; the S3 driver is covered with a fake client, not against a live bucket.
- **The database keeps the metadata, the storage keeps the bytes.** A file's key is generated (`<organization>/<uuid>.<ext>`): the name sent by the client never reaches the storage and is reduced to its last path segment.
- **Checks.** The declared type must be allowed **and the bytes must start with that type's signature** (a script renamed `.png` is refused with `415`), empty files are `400`, and anything over `MAX_UPLOAD_MB` (default 15) is `413`, enforced on the request body too. Served files carry `X-Content-Type-Options: nosniff`.
- **Order of writes.** The object is stored first; if the database then refuses, the object is taken back. On delete the rows go first and the object after; if the storage is unreachable the leftover is picked up by the sweep.
- **Orphan sweep.** `sweepOrphanFiles` removes files that nothing points to (no photo, document, contract PDF or feedback attachment): what a deleted property leaves behind and what a failed delete could not reach. It only looks at files older than a cut-off, so an upload in flight is safe. A periodic job will run it with the demo cleanup.
- Visibility follows the property: members only reach files of properties they created. Uploads and deletions are audited (`upload` / `delete` on `photo` and `document`).

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
| `npm run admin:create` | create or promote the platform operator (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) |
| `npm run openapi:export` | regenerate `docs/openapi.json` |
| `npm run maintenance` | one housekeeping run (expired demos, orphan files, audit retention, stale sessions) |
| `npm run db:up` / `db:down` | start / stop local PostgreSQL |
| `npm run db:migrate` | create/apply migrations (dev) |
| `npm run db:seed` | seed reference data: 5,571 IBGE municipalities, property subtypes, allowed usages per property type, transaction categories |
| `npm run db:seed:fetch-cities` | regenerate `prisma/seed/data/cities.json` from the IBGE API |
| `npm run db:deploy` | apply migrations (production) |
| `npm run db:studio` | Prisma Studio |

## Conventions

- Code, API and commits in English; UI texts in pt-BR (front-end).
- Conventional Commits.
