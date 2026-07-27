# Course business reference

This independently rooted example answers one Builder question: how does a
normal customer-facing PostgreSQL application compose with an Agent-work
engine?

It is a complete, bounded vertical slice, not a general LMS or production SaaS.
Course creators can register, maintain a private collection of course projects,
delegate outline generation and revision, preserve every generated version, and
approve one version as the current business result. The current Agent-work
backend is a persistent, deterministic **simulation**. It does not run an AI
model or Kungfu and cannot produce Kungfu evidence, reviews, decisions,
receipts, roots, or seals.

The visible job is deliberately ordinary: turn a creator's expertise, target
learner, promised outcome, and delivery constraints into a teachable
three-module outline. The Mock Agent returns a real, inspectable draft so the
port's purpose is understandable even before the future Kungfu adapter exists.
Each saved version also shows a five-step work handoff: what the creator
supplied, what the course app delegated, what the Mock Course Designer
delivered, what PostgreSQL saved, and what remains for the creator to approve.
The version history distinguishes first drafts, revisions, and alternatives,
while an explicit change summary identifies the Agent's contribution.

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
| course project, saved brief, collection ownership | PostgreSQL |
| generated outline versions and the approved-version pointer | PostgreSQL |
| Agent run input/output provenance and delivery intent | PostgreSQL |
| backend binding, delivery intent, rebuildable status | PostgreSQL |
| delegated generation/revision execution and live work state | `AgentWorkPort/v2` backend |

`course.course_outline_versions` is append-only for content: generating or
revising inserts another version instead of overwriting a previous outline.
Approval changes only version status and
`course.course_projects.current_outline_version_id`. Mock execution state lives
in the explicitly named `mock_agent_work` schema. The Web and domain layers
depend on `AgentWorkPort/v2`; only the composition root selects
`MockAgentWorkAdapter`.

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

Creating a course project creates its private work binding and provisioning
outbox message in one PostgreSQL transaction. Generation and revision use stable
idempotency keys. The mock records each delivered key before PostgreSQL
acknowledges it, while `course.agent_runs.outbox_command_id` prevents a replay
from creating a duplicate outline version. A restart or crash between adapter
completion and outbox acknowledgement therefore replays safely. Stale
processing locks are recovered after 30 seconds. Each visible outline version
joins back to its owning `course.agent_runs` row so the UI can explain the
action, prior-version input, creator feedback, backend, and transition that
produced it.

## Validation

From the repository root:

```bash
npm ci --ignore-scripts
npm run check
bash -n course-business-reference/scripts/compose-qualification.sh
```

The isolated Compose qualification starts on port `18090` and uses only
synthetic accounts. It proves a crash after adapter completion, timeout retry,
concurrent duplicate actions, per-account UUID and direct-RLS isolation,
Origin/CSRF/body-size/rate-limit/session-expiry controls, the two-round golden
path, database and application restart recovery, and a PostgreSQL
backup/restore round trip. It stops containers while preserving named volumes
and retains a machine-readable evidence JSON plus a run-specific database dump
under the ignored `.artifacts/` directory:

```bash
bash course-business-reference/scripts/compose-qualification.sh
```

## Forward-only evolution and successor integration

Migrations are ordered, forward-only SQL files. Never edit an applied
migration; append a new numbered file and keep empty-database and restore
qualification.

The later real integration is intentionally small and separate:

| `AgentWorkPort/v2` field/action | Provisional future Hub mapping |
| --- | --- |
| `sourceIdentity` | stable external course-project identity |
| `bindingId` | public Hub work binding coordinate |
| `transitionId` | public current work transition/version |
| `provision` | create/admit bounded course-outline work |
| `generate_outline` | generate a first visible outline from the saved brief |
| `revise_outline` | generate another version from the brief, prior version, and feedback |
| `status`, `nextAction`, `audit` | public read model and typed next action |

These mappings are provisional until the independent Hub Starter coursework
delivery is complete. A successor must implement a new adapter and shared
contract tests; it must not redesign accounts, enrollments, ownership, routes,
or business-owned outline versions, and must fail closed rather than silently
falling back to the mock.
