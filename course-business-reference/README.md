# Course business reference

This independently rooted example answers one Builder question: how does a
normal customer-facing PostgreSQL application compose with an Agent-work
engine?

It is a complete, bounded vertical slice, not a general LMS or production SaaS.
Learners can register, log in, receive one private course homework, complete a
two-round workflow, and log out. The current Agent-work backend is a persistent,
deterministic **simulation**. It does not run Kungfu and cannot produce Kungfu
evidence, reviews, decisions, receipts, roots, or seals.

## Run locally

Use synthetic development passwords and a project name that does not overlap
the Hub Starter deployment:

```bash
cd course-business-reference
COURSE_DB_MIGRATION_PASSWORD=synthetic_migration_42 \
COURSE_DB_APP_PASSWORD=synthetic_runtime_42 \
docker compose up --build --detach
```

Open <http://127.0.0.1:8090>. Ordinary `docker compose stop` and restart
preserve both named volumes. This project never automates
`docker compose down -v`.

The default binding is loopback-only. LAN or public ingress, TLS, real customer
data, account recovery, email verification, MFA, billing, organizations,
teacher roles, and production security certification are intentionally out of
scope.

## Authority boundary

| Fact | Authority |
| --- | --- |
| learner identity, password credential, session | PostgreSQL |
| course, enrollment, homework ownership | PostgreSQL |
| backend binding, delivery intent, rebuildable status | PostgreSQL |
| attempt, artifact evidence, review, outcome, seal | `AgentWorkPort/v1` backend |

`course.learner_homeworks` deliberately stores only the backend binding and a
rebuildable projection. Mock execution bytes live in the explicitly named
`mock_agent_work` schema. The Web and domain layers depend on
`AgentWorkPort/v1`; only the composition root selects `MockAgentWorkAdapter`.

## Security model

- Passwords use Node's built-in scrypt with `N=32768`, `r=8`, `p=1`, a random
  16-byte salt, and a 32-byte derived key.
- Session cookies are random 256-bit opaque values; PostgreSQL stores only
  their SHA-256 hashes. Cookies are `HttpOnly`, `SameSite=Lax`, and optionally
  `Secure`.
- State-changing requests require the configured exact Origin and a
  session-bound CSRF token. Authentication endpoints have a bounded in-memory
  rate limiter and generic errors.
- The browser never selects a learner, database role, workspace, or backend
  binding. Queries are current-user scoped and PostgreSQL applies forced RLS to
  sessions, enrollments, learner homework, and outbox rows.
- Migrations use `course_migrator`; the application reconnects as
  `course_app`, which is explicitly `NOBYPASSRLS`.

This is a reference security posture for disposable synthetic development data,
not a production authentication certification.

## Durable coordination

Registration creates the account, enrollment, homework, and provisioning
outbox message in one PostgreSQL transaction. Delivery uses stable idempotency
keys. The mock records each delivered key before PostgreSQL acknowledges it, so
a restart or a crash between adapter completion and outbox acknowledgement
replays safely. Stale processing locks are recovered after 30 seconds.

## Validation

From the repository root:

```bash
npm ci --ignore-scripts
npm run check
bash -n course-business-reference/scripts/compose-qualification.sh
```

The isolated Compose qualification starts on port `18090`, registers two
learners, proves per-account UUID isolation and Origin rejection, drives the
two-round golden path, repeats every idempotency key, verifies logout
revocation, restarts the application, and stops containers while preserving
volumes:

```bash
bash course-business-reference/scripts/compose-qualification.sh
```

## Forward-only evolution and successor integration

Migrations are ordered, forward-only SQL files. Never edit an applied
migration; append a new numbered file and keep empty-database and restore
qualification.

The later real integration is intentionally small and separate:

| `AgentWorkPort/v1` field/action | Provisional future Hub mapping |
| --- | --- |
| `sourceIdentity` | stable external business/homework identity |
| `bindingId` | public Hub work binding coordinate |
| `transitionId` | public current work transition/version |
| `provision` | create/admit bounded learner work |
| `run_first_submission` | execute first bounded work round |
| `submit_evidence` | attach public artifact evidence reference |
| `request_review` | request/observe fresh independent review |
| `seal` | close the accepted work lifecycle |
| `status`, `nextAction`, `audit` | public read model and typed next action |

These mappings are provisional until the independent Hub Starter coursework
delivery is complete. A successor must implement a new adapter and shared
contract tests; it must not redesign accounts, enrollments, ownership, routes,
or the primary page, and must fail closed rather than silently falling back to
the mock.
