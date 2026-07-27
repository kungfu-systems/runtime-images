# Course business reference

This independently rooted example answers one Builder question: how does a
normal customer-facing PostgreSQL application compose with an Agent-work
engine?

It is a complete, bounded vertical slice, not a general LMS or production SaaS.
Course creators can register, maintain a private collection of course projects,
delegate outline generation and revision, preserve every generated version, and
approve one version as the current business result. The default Agent-work
backend is a persistent, deterministic **simulation**. It does not run an AI
model or Kungfu and cannot produce Kungfu evidence, reviews, decisions,
receipts, roots, or seals. The same image can select a schema-constrained
OpenAI-compatible endpoint, either hosted or supplied by the optional local
llama.cpp delivery pack.

The visible job is deliberately ordinary: turn a creator's expertise, target
learner, promised outcome, and delivery constraints into a teachable
three-module outline. Every backend returns an inspectable draft through the
same port, so its purpose remains understandable before a future Kungfu adapter.
Each saved version also shows a five-step work handoff: what the creator
supplied, what the course app delegated, what the selected Course Designer
delivered, what PostgreSQL saved, and what remains for the creator to approve.
The version history distinguishes first drafts, revisions, and alternatives,
while an explicit change summary identifies the Agent's contribution.
Empty course-brief and feedback fields accept their visible example when the
creator presses Tab, then continue normal keyboard navigation. Generate,
improve, and approve actions show one visible lifecycle stage per second with
entry and exit motion while the real request runs; these stages explain the
application workflow and never claim to expose hidden model reasoning.

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

## Delivery modes

The core image contains no model and remains the same in every mode:

| Mode | Additional download | Configuration | Result label |
| --- | ---: | --- | --- |
| default simulation | none | database development secrets only | `Visible Mock Agent` |
| hosted endpoint | no local model | endpoint, model, and a secret file | configured provider |
| optional local pack | about 704 MB compressed beyond the core image | one Compose overlay | `Local Qwen Course Designer` |

The local pack pins the multi-platform llama.cpp server image by OCI digest and
pins `Qwen3-0.6B-Q4_K_M.gguf` to an exact repository revision plus SHA-256. The
model initializer downloads it once into a named cache volume and verifies the
checksum. Later application rebuilds do not download it again. llama.cpp is
reachable only on the private Compose network; it has no host port.

Start the local delivery pack:

```bash
COURSE_DB_MIGRATION_PASSWORD=synthetic_migration_42 \
COURSE_DB_APP_PASSWORD=synthetic_runtime_42 \
docker compose -f compose.yaml -f compose.offline.yaml up --build --detach
```

The first start downloads and loads the model, so readiness takes longer than
the default simulation. Existing courses retain their original backend binding;
new courses use the currently selected backend. This preserves old mock-backed
versions instead of silently relabeling them as model-generated.

For a hosted OpenAI-compatible endpoint, keep the bearer token in a local file
rather than Compose environment metadata:

```bash
COURSE_DB_MIGRATION_PASSWORD=synthetic_migration_42 \
COURSE_DB_APP_PASSWORD=synthetic_runtime_42 \
COURSE_AGENT_BASE_URL=https://provider.example/v1 \
COURSE_AGENT_MODEL=provider-model-id \
COURSE_AGENT_API_KEY_FILE=/absolute/path/to/local-token \
docker compose -f compose.yaml -f compose.hosted.yaml up --build --detach
```

The public image never embeds a provider credential. A distribution-operated
zero-configuration hosted experience must issue a bounded installation or
account token from its gateway; it must not bake a long-lived API key into the
image.

## Authority boundary

| Fact | Authority |
| --- | --- |
| learner identity, password credential, session | PostgreSQL |
| course project, saved brief, collection ownership | PostgreSQL |
| generated outline versions and the approved-version pointer | PostgreSQL |
| Agent run input/output provenance and delivery intent | PostgreSQL |
| backend binding, delivery intent, rebuildable status | PostgreSQL |
| delegated generation/revision execution and live work state | selected `AgentWorkPort/v2` backend |

`course.course_outline_versions` is append-only for content: generating or
revising inserts another version instead of overwriting a previous outline.
Approval changes only version status and
`course.course_projects.current_outline_version_id`. Mock execution state lives
in the explicitly named `mock_agent_work` schema. OpenAI-compatible delivery
state and idempotency records use the separate `agent_work` schema. The Web and
domain layers depend on `AgentWorkPort/v2`; only the composition root selects
and routes adapters.

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
idempotency keys. Each adapter records delivered keys before PostgreSQL
acknowledges them, while `course.agent_runs.outbox_command_id` prevents a replay
from creating a duplicate outline version. A restart or crash between adapter
completion and outbox acknowledgement therefore replays safely. Stale
processing locks are recovered after 30 seconds. Each visible outline version
joins back to its owning `course.agent_runs` row so the UI can explain the
action, prior-version input, creator feedback, backend, and transition that
produced it. External providers also receive the stable idempotency key. If a
provider does not honor that header, a crash before the adapter stores the
response may repeat inference, but the business outbox still commits at most
one course version.

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

The OpenAI-compatible adapter proves this substitution seam without coupling
the domain to one provider. A future Kungfu adapter must still use shared
contract tests; it must not redesign accounts, enrollments, ownership, routes,
or business-owned outline versions. Every real adapter fails closed rather than
silently falling back to the mock.
