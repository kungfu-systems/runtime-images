# Architecture

## Purpose

Course Hub demonstrates one complete business workflow in which customer data,
model output, and work governance remain independently inspectable.

It is a vertical reference rather than a generic plugin framework. The course
domain is real code and real PostgreSQL state; the extension seams show where a
Builder can substitute another domain or provider without collapsing authority
into one opaque application.

## Runtime topology

```text
trusted browser
    |
    | session cookie + CSRF + exact Origin
    v
Course Hub (one non-root, read-only application container)
    |
    +---- PostgreSQL private network
    |       users, sessions, RLS, course projects, immutable versions,
    |       approvals, backend switches, outbox, stable roots
    |
    +---- AgentWorkPort
    |       Mock | private local llama.cpp | configured hosted endpoint
    |
    +---- packaged kungfu CLI
            Assignment, Evidence Episode, independent review,
            typed decision, portable seal
```

The image contains Course Hub, the exact Kungfu CLI, and llama.cpp. PostgreSQL
runs as the second Compose service. Model weights and hosted-provider
credentials are never included in the image.

The published installation also runs the same Hub image once as a network-free
`bootstrap` service. It creates two random database credentials in a private
named volume using exclusive, atomic files. PostgreSQL and the Hub mount those
files read-only. A later restart validates and reuses them instead of rotating
credentials behind existing database state. PostgreSQL has no host port.

## Authority model

| Fact | Authority | Application projection |
| --- | --- | --- |
| user, credential, session | PostgreSQL | account header and session API |
| course ownership and brief | PostgreSQL with forced RLS | course collection |
| generated course version | selected Agent output persisted by PostgreSQL | version detail |
| provider, model, and transition | AgentWorkPort result persisted by PostgreSQL | generation provenance |
| approved version | PostgreSQL pointer and statuses | approved badge |
| work claim and artifact | Kungfu Assignment and Evidence | Work control card |
| review and continuation | Kungfu review and typed decision | Work control card |
| sealed state | Kungfu portable seal | Work control card |

The Web layer issues commands and projects results. It is not authoritative for
any row or Kungfu record.

## Generate request

1. The browser posts a course action with the session cookie, exact Origin,
   CSRF token, and an idempotency key.
2. `server.mjs` authenticates the user and calls `CourseDomain`.
3. The domain transaction verifies RLS-scoped ownership and appends a pending
   outbox command.
4. `OutboxDispatcher` claims the command and invokes the explicitly selected
   `AgentWorkPort` adapter.
5. The adapter returns a schema-validated outline and immutable provider
   provenance. A selected local or hosted backend cannot fall back to Mock.
6. A PostgreSQL transaction creates `agent_runs` and the next append-only
   `course_outline_versions` row.
7. `KungfuCourseWorkControl` derives the stable
   `kungfu:course:<course-id>` binding, creates one version-specific work
   artifact, and runs the public CLI lifecycle.
8. Returned Assignment, Episode, review, decision, and seal roots are stored
   with that immutable business version.
9. The outbox command becomes delivered and the API projects the current
   course.

## Failure and recovery

- HTTP retries reuse the client idempotency key.
- Adapter deliveries retain processing/completed/failed state.
- Stale processing claims can be retried after the bounded timeout.
- A process crash after provider output but before business projection is
  reconciled through durable delivery state.
- Kungfu settlement reads current native status and resumes rather than
  inventing a second work journal.
- PostgreSQL restart, Hub restart, and duplicate requests are qualification
  scenarios.

Unknown contract combinations and invalid native state fail closed.

## Source boundaries

```text
apps/course-hub/
  migrations/       database authority and forward-only evolution
  src/
    security.mjs    credential, token, and rate-limit helpers
    db.mjs          migrations, roles, and scoped transactions
    domain.mjs      business commands and projections
    agent-work-*    inference port, routing, and adapters
    outbox.mjs      durable asynchronous delivery
    local-model-*   verified model installation and activation
    kungfu-*        native work lifecycle and its projection
    server.mjs      composition root and HTTP transport
  web/              browser projection
  contracts/        public port shapes
  test/             behavior and boundary tests
```

Packaging policy remains outside the app:

- `Dockerfile` assembles the reproducible product.
- `compose.yaml` declares the supported local topology and persistent
  installation configuration.
- `.github/workflows/application.yml` publishes that topology as an OCI Compose
  artifact and smokes a fresh no-checkout installation.
- `contracts/` and `release/` bind claims to exact artifacts.
- `scripts/` and `.github/workflows/` qualify source and images.

## Kungfu and KFD-3 discovery

The installed Kungfu runtime is a better explanation source than stale external
notes. From a running Hub:

```sh
docker compose exec -T hub kungfu agent brief
docker compose exec -T hub kungfu agent verify --json
docker compose exec -T hub kungfu agent work-model --json
```

The brief is offline and read-only. `agent verify` checks the shipped Agent
command tree against its KFD-3 registry. These interfaces explain Kungfu's
participant-facing contract; Course Hub still uses the separate public
`kungfu work` family for real work lifecycle mutations.

## Non-claims

This architecture does not prove production authentication, public ingress,
email recovery, MFA, organization roles, billing, SSO, backup safety, high
availability, security certification, or universal model quality.
