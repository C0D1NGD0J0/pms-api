# PropertyDesk API

> **A product by [WeTalkingTechLabs](https://wetalkingtechlabs.com)**

Node.js/Express REST API powering PropertyDesk — a multi-tenant SaaS platform that helps landlords and property managers streamline rental payments, lease management, maintenance tracking, and tenant operations.

**Production URL**: `https://pms-api-production.up.railway.app`

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [How the API and Frontend Fit Together](#how-the-api-and-frontend-fit-together)
- [Architecture](#architecture)
- [Features & Services](#features--services)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Background Queues](#background-queues)
- [Scheduled Jobs](#scheduled-jobs)
- [Testing](#testing)
- [Deployment](#deployment)
- [Git Hooks & Dependency Security](#git-hooks--dependency-security)
- [Documentation](#documentation)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (`>=22.12.0 <23`) |
| Language | TypeScript (strict mode) |
| Framework | Express.js |
| Database | MongoDB + Mongoose |
| Cache / Queues | Redis + Bull/BullMQ |
| Auth | JWT (HttpOnly cookies) + refresh token rotation |
| Payments | Stripe Connect (direct charges) |
| E-Signature | BoldSign |
| File Storage | AWS S3 + presigned URLs |
| Email | Nodemailer + EJS templates |
| Real-time | Socket.IO + Redis adapter + SSE |
| PDF Generation | Puppeteer + Chromium |
| Virus Scanning | ClamAV |
| Geocoding | node-geocoder |
| Observability | Sentry + X-Request-ID tracing |
| Dependency Injection | Awilix (scoped per request) |
| Tests | Jest + Supertest + mongodb-memory-server |
| Deployment | Railway (Docker, two-process) |

---

## How the API and Frontend Fit Together

PropertyDesk is two repos:

| Repo | What it is | Local URL | Hosted on |
|---|---|---|---|
| **pms-api** (this repo) | Express REST API + background worker | `http://localhost:5001/api/v1` | Railway |
| **pms-ui** | Next.js web app (staff, tenant and vendor portals) | `http://localhost:3000` | Vercel |

- The frontend calls the API at `NEXT_PUBLIC_API_BASE_URL` (pms-ui `.env`); the API only accepts browser requests from the origins in `FRONTEND_URL` (this repo's `.env`).
- Auth uses HttpOnly cookies set by the API, so both must run on `localhost` (or the same LAN IP) for login to work.
- Every tenant-scoped route includes the client id: `/api/v1/<resource>/:cuid/...`.
- Live updates reach the browser over Server-Sent Events and Socket.IO from the API process.
- Emails (account activation, invites, password reset) are sent by the **worker** process, so run both processes.

---

## Architecture

### Two-Process Design

PropertyDesk runs as two separate processes to keep the HTTP layer lean and background work isolated:

```
┌─────────────────────────────┐    ┌──────────────────────────────┐
│        API Process          │    │       Worker Process          │
│        (server.ts)          │    │     (worker_process.ts)       │
│                             │    │                               │
│  - Express HTTP (PORT=5001) │    │  - Background job processing  │
│  - REST API endpoints       │◄──►│  - Cron job scheduling        │
│  - Socket.IO real-time      │    │  - PDF generation (Puppeteer) │
│  - Bull Board UI            │    │  - Email sending              │
│  - Memory: ~100–150 MB      │    │  - Memory: ~200–300 MB        │
└─────────────────────────────┘    └──────────────────────────────┘
              │                                   │
              └──────────── Redis ────────────────┘
```

### Layered Application Structure

```
Controllers → Services → DAOs → Models
     │            │        │       │
  HTTP Layer  Business  Data    MongoDB
              Logic    Access   Schemas
```

### Directory Layout

```
pms-api/
├── app/
│   ├── controllers/       # HTTP request handlers
│   ├── services/          # Business logic layer
│   │   ├── auth/
│   │   ├── lease/         # Split into 4 focused sub-services
│   │   ├── payment/
│   │   ├── property/
│   │   ├── cron/
│   │   └── ...
│   ├── dao/               # Data Access Objects
│   ├── models/            # Mongoose schemas
│   ├── routes/            # Express route definitions
│   ├── workers/           # Bull queue job processors
│   ├── queues/            # Queue definitions
│   ├── caching/           # Redis cache layers
│   ├── sockets/           # Socket.IO handlers
│   ├── mailer/            # Email templates (EJS)
│   ├── di/                # Awilix container registration
│   └── shared/
│       ├── middlewares/   # Auth, rate limiting, validation
│       ├── validations/   # Express-validator + Zod schemas
│       ├── permissions/   # RBAC configuration
│       └── config/        # Environment + service config
├── tests/
│   ├── api/               # Route integration tests (Supertest)
│   ├── unit/              # Unit tests
│   ├── integration/       # Full integration tests (DB + Redis)
│   └── helpers/           # Mock factories, test utilities
├── app-documentation/     # Service-level documentation
├── server.ts              # API entry point
├── worker_process.ts      # Worker entry point
├── railway.toml           # Railway deployment config
└── Dockerfile             # Multi-stage Docker build
```

---

## Features & Services

### Authentication & Security
- JWT access tokens in HttpOnly cookies with refresh token rotation
- Multi-tenant isolation: every route scoped to a `:cuid` tenant identifier
- Role-based access control (Super Admin, Admin, Manager, Staff, Tenant, Vendor)
- Department-level permission filtering for staff
- Idempotency cache for webhook deduplication and mutation route safety
- ClamAV virus scanning on all file uploads
- Helmet, CORS, express-mongo-sanitize, and XSS sanitization

### User & Invitation Management
- User lifecycle: signup → invitation → activation (with consent collection)
- Bulk invitation processing via queue
- Profile management with role-specific data
- Password reset and account recovery flows

### Property & Unit Management
- Multi-unit property support with configurable numbering strategies
- Bulk unit creation via CSV processing
- Property approval workflows
- Geocoding and service area management
- Department-filtered property views for security staff

### Lease Management
- Full lease lifecycle: draft → active → renewal → expiry
- BoldSign e-signature integration
- Automated renewal detection (60 days prior) and signature dispatch
- PDF lease generation via Puppeteer

### Payments & Billing
- Stripe Connect destination charges via PaymentIntents (tenant → landlord payout, platform application fee)
- Manual payment recording
- Subscription plan management with usage tracking and entitlements
- Refund processing through a provider-agnostic `PaymentGatewayService`
- Paystack support for African market payments (NGN, GHS, ZAR, KES)
- Automated rent charge and autopay cron jobs

### Communication & Notifications
- In-app notifications with read/unread state
- Server-Sent Events (SSE) for real-time dashboard updates
- Socket.IO for live presence and event broadcasting
- Transactional email via Nodemailer with EJS templates
- i18n support (EN, FR, EN-NIG)

### Infrastructure
- Sentry error monitoring with X-Request-ID end-to-end tracing
- Bull Board queue monitoring UI (development and staging)
- Event-driven architecture via internal event emitter
- Redis-backed caching at auth, property, and event layers

---

## Quick Start

### Prerequisites

- **Node.js 22** (`>=22.12.0 <23`) and npm
- **MongoDB 7+ running as a replica set.** The API uses transactions, and MongoDB refuses them on a standalone server ("Transaction numbers are only allowed on a replica set member").
- **Redis 7+** (queues, cache, Socket.IO)
- An SMTP sandbox such as [Mailtrap](https://mailtrap.io) to receive sign-up and invite emails

The quickest way to get MongoDB and Redis is Docker:

```bash
# MongoDB as a single-node replica set
docker run -d --name pms-mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all
docker exec pms-mongo mongosh --quiet --eval \
  'rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]})'

# Redis
docker run -d --name pms-redis -p 6379:6379 redis:7
```

### First run

```bash
npm install            # also installs the git hooks
cp .env.example .env   # then fill in the values (see below)
npm run dev            # API on http://localhost:5001 + worker, both with hot reload
```

Then start the frontend (pms-ui, `npm run dev` → http://localhost:3000), open **/register** and create an account. The activation email lands in your Mailtrap inbox; follow its link to activate, then log in.

### Running the processes separately

```bash
npm run dev:api      # API only (debugger on :9229)
npm run dev:worker   # Worker only: queues, email, PDFs, cron (debugger on :9230)
```

`npm run dev` first kills any API/worker left running from a previous session (`npm run killdev`).

### Common problems

| Symptom | Fix |
|---|---|
| `FATAL: JWT_SECRET environment variable is required` | Set `JWT_SECRET` and `JWT_REFRESH_SECRET` in `.env` |
| `Transaction numbers are only allowed on a replica set member` | MongoDB isn't a replica set; see Prerequisites |
| Login works but the browser shows CORS errors | Add the frontend's origin to `FRONTEND_URL` (comma-separated) |
| Sign-up succeeds but no email arrives | The worker isn't running, or the `EMAIL_PROVIDER_*_DEV` values are wrong |
| File uploads fail | AWS S3 values are missing; uploads need a real bucket |

---

## Environment Variables

Every variable is listed, grouped and commented, in [`.env.example`](./.env.example). Copy it to `.env`; never commit `.env`.

**Needed to boot locally:** `PORT`, `FRONTEND_URL`, `AUTH_COOKIE_NAME`, `DEV_DB_URL`, `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`), `JWT_SECRET`, `JWT_REFRESH_SECRET`.

**Needed for the main flows:** the `EMAIL_PROVIDER_*_DEV` values (account activation, invites) and the AWS S3 values (uploads).

**Optional integrations:** Stripe, BoldSign, Twilio, Google geocoding, web push (VAPID), passkeys (WebAuthn), ClamAV, AI features, Sentry. Each is switched on by its own variables or `FEATURE_*` flag.

Which database URL is used depends on `NODE_ENV`: `DEV_DB_URL` in development, `TEST_DB_URL` in tests, and `PROD_DB_URL` / `DATABASE_URL` in production. Production also requires `PORT`, a database URL and a Redis URL, or the process exits at start-up.

### Process type

The same code runs as either process, chosen by `PROCESS_TYPE`:

```bash
PROCESS_TYPE=api      # default: HTTP API, Socket.IO, SSE
PROCESS_TYPE=worker   # queues and, with CRON_ENABLED=true, the scheduled jobs
```

Locally `npm run dev` starts both for you.

---

## Background Queues

The worker process handles 10 queues:

| Queue | Responsibility |
|---|---|
| `emailQueue` | Transactional email sending |
| `uploadQueue` | S3 file uploads |
| `pdfGeneratorQueue` | Lease and report PDF generation |
| `eSignatureQueue` | BoldSign e-signature dispatch |
| `propertyQueue` | Property processing and approval |
| `propertyUnitQueue` | Unit bulk operations |
| `invitationQueue` | User invitation delivery |
| `propertyMediaQueue` | Media and document processing |
| `eventBusQueue` | Internal event-driven messaging |
| `cronQueue` | Cron job execution |

---

## Scheduled Jobs

5 automated cron tasks (run in worker process only):

| Job | Schedule | Description |
|---|---|---|
| `mark-expired-leases` | Daily 1 AM UTC | Mark leases expired 7+ days past end date |
| `create-auto-renewals` | Daily 2 AM UTC | Generate renewal proposals 60 days before expiry |
| `process-approved-renewals` | Daily 3 AM UTC | Advance approved renewals to `ready_for_signature` |
| `auto-send-renewals` | Daily 8 AM UTC | Dispatch approved renewals for e-signature |
| `process-expiring-leases` | Daily 9 AM UTC | Send expiry notifications (30 / 14 / 7 days) |

---

## Testing

```bash
# All tests
npm test

# Integration tests (starts in-memory MongoDB + Redis)
npm run test:integration

# Unit tests only
npm run test:unit

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

**Test infrastructure**: Jest 29 + ts-jest, Supertest, `mongodb-memory-server`, `redis-memory-server`. All test runs are single-worker and fully isolated.

---

## Deployment

PropertyDesk API is deployed on [Railway](https://railway.app) as two services sharing a Redis instance.

**Setup:**
1. Create two Railway services from this repo (API and Worker), both built from the `Dockerfile`
2. Set `PROCESS_TYPE=api` on the API. On the worker set `PROCESS_TYPE=worker`, `START_COMMAND=node dist/worker_process.js` (without it the worker runs the API) and `CRON_ENABLED=true`. `railway.toml` has the full notes
3. Give both the same production variables (`PROD_DB_URL`, `REDIS_URL`, secrets); Railway sets `PORT`
4. The full step-by-step guide and pre-deploy checklist are in the maintainers' (uncommitted) `docs/RAILWAY_*.md`

**Estimated cost**: ~$5–8/month (two Hobby services)

---

## Git Hooks & Dependency Security

Husky hooks run on every commit and push (installed by `npm install`):

- **pre-commit:** `lint-staged` lints and formats the staged files.
- **pre-push:** security audit → Prettier check → ESLint → type check → tests affected by your changes.

The security audit (`.husky/audit-prod.js`) blocks a push when a production dependency has a high or critical advisory. Advisories with no fix and no exploit path can be allowed for a limited time in `.audit-allowlist.json`, each with a reason and a `reviewBy` date. Dependencies are pinned to exact versions (`.npmrc`: `save-exact`, `min-release-age=7d`); CI installs with `npm ci`.

What each check does, what to do when the audit blocks you, and the current allowlist entries: [`.husky/README.md`](./.husky/README.md). pms-ui uses the same setup.

---

## Documentation

| Document | Description |
|---|---|
| [`.husky/README.md`](./.husky/README.md) | Git hooks, the pre-push security audit and its allowlist |
| [`.env.example`](./.env.example) | Every environment variable, grouped and commented |
| [`docs/permission-system-guide.md`](./docs/permission-system-guide.md) | RBAC roles, permission strings and scopes |
| [`docs/simple-i18n-guide.md`](./docs/simple-i18n-guide.md) | How API messages are translated |

Deeper design notes (service index, security architecture, observability, idempotency, Railway deployment) live in `app-documentation/` and `docs/`, which are **not committed**. Ask a maintainer if you need them.

---

**PropertyDesk** — built by [WeTalkingTechLabs](https://wetalkingtechlabs.com)
Version `0.0.1` · Node.js `>=22.12.0 <23.0.0` · Last updated: 2026-11-19
