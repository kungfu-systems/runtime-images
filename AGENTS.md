# Agent entry point

Kungfu Course Hub is an Apache-2.0 reference application for account-based
Agent products. It combines PostgreSQL business state, selectable inference,
and native Kungfu work control in one Docker application.

## Read in this order

1. `README.md` — product purpose, first run, and exploration paths.
2. `docs/ARCHITECTURE.md` — authority boundaries and end-to-end data flow.
3. `docs/EXTENDING.md` — supported extension methods and invariants.
4. `docs/API.md` — HTTP commands, authentication, and idempotency.
5. `docs/MAP.md` — repository navigation.
6. `CONTRIBUTING.md` — contribution and verification requirements.

## Discover Kungfu from the shipped Docker runtime

Do not explain Kungfu from memory when the Hub image is available. Start with
the artifact-local onboarding pack:

```sh
docker compose exec -T hub kungfu agent brief
```

This is an offline, read-only first contact. It describes Kungfu's value,
constraints, operating modes, public work model, and KFD-3 discovery surface.
Deepen the explanation only when needed:

```sh
docker compose exec -T hub kungfu agent verify --json
docker compose exec -T hub kungfu agent capabilities --json
docker compose exec -T hub kungfu agent work-model --json
```

`agent verify` checks the installed `kungfu agent` command tree against the
declared KFD-3 registry. `agent capabilities` is comprehensive and large; use
the brief first. These commands describe the shipped Kungfu interface. They do
not replace this application's business API or grant permission to mutate work.

## Canonical project structure

- `apps/course-hub/src/domain.mjs` — account and course use cases.
- `apps/course-hub/migrations/` — PostgreSQL roles, RLS, business state, and
  stored work-control roots.
- `apps/course-hub/src/agent-work-port.mjs` — inference port contract.
- `apps/course-hub/src/agent-work-router.mjs` — explicit backend selection.
- `apps/course-hub/src/*agent-work-adapter.mjs` — Mock and
  OpenAI-compatible inference adapters.
- `apps/course-hub/src/local-model-manager.mjs` and `model-catalog.mjs` —
  pinned local model delivery and private llama.cpp process control.
- `apps/course-hub/src/bootstrap-secrets.mjs` — one-shot, network-free
  generation and reuse of database credentials in a named volume.
- `apps/course-hub/src/outbox.mjs` — durable command delivery and recovery.
- `apps/course-hub/src/kungfu-course-work-control.mjs` — public Kungfu CLI
  lifecycle adapter.
- `apps/course-hub/src/server.mjs` — dependency composition and HTTP routes.
- `apps/course-hub/web/` — non-authoritative browser projection.
- `apps/course-hub/test/` — application and boundary tests.
- `Dockerfile` and `compose.yaml` — canonical publication and installation.
- `.github/workflows/application.yml` — trusted publication and fresh-install
  smoke of the OCI Compose application used by non-source users.
- `Dockerfile.dev` and `compose.dev.yaml` — fast source exploration over the
  exact published runtime.
- `course-business-reference/` — compatibility Compose entry, not a second
  application.
- `legacy/hub-starter/` — retained earlier demonstration, not the published
  Course Hub.

## Extension methods

Choose the smallest applicable seam:

- configure an OpenAI-compatible hosted provider without changing source;
- change the course workflow through migrations, domain inputs, output schema,
  prompt, API, and Web projection;
- add an inference backend by implementing `AgentWorkPort`, registering its
  binding kind, extending database constraints, and adding recovery tests;
- create another domain workflow by replacing course-specific business tables
  and artifacts while preserving identity, account isolation, outbox
  idempotency, inference provenance, and Kungfu settlement.

Use `docs/EXTENDING.md` as the checklist. Before editing, return an extension
map naming the exact files, new identities, migration, recovery behavior, and
tests. Do not describe this repository as a plugin framework: it is a complete
vertical reference with explicit seams.

## Invariants

- PostgreSQL remains authoritative for users and customer-owned business data.
- Generated business versions remain immutable; approval is a separate pointer.
- Inference provenance remains distinct from Kungfu work-control provenance.
- Every selected backend fails visibly; never silently fall back to Mock.
- Kungfu mutations use the packaged public CLI and retain returned roots and
  receipts; do not construct private Kungfu state.
- Applied migrations are never edited; add a forward-only numbered migration.
- Runtime image references, packages, and model files remain exact and pinned.
- Database credentials are generated once, passed through mounted files, and
  never published in the Compose artifact or exposed as host ports.
- The published container remains localhost-only by default, non-root,
  read-only, capability-free, and without Docker socket, host network, host
  paths, credentials, or model weights.
- Never automate `docker compose down -v`.

## Verify changes

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run check
bash -n scripts/smoke-image.sh scripts/smoke-browser.sh
```

Image and daemon smoke belongs on an ephemeral trusted runner by default. Follow
`CONTRIBUTING.md` for branches, DCO sign-off, pull requests, and publication.
