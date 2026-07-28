# Extending Course Hub

## Start with an extension map

Before changing code, ask a coding Agent to read `AGENTS.md`, this guide, and
`docs/ARCHITECTURE.md`. If the product is running, also ask it to execute:

```sh
docker compose exec -T hub kungfu agent brief
docker compose exec -T hub kungfu agent verify --json
```

The Agent should return:

1. the user-visible outcome;
2. the new business identities and immutable artifacts;
3. the PostgreSQL migration and account-isolation rule;
4. the inference command and provenance;
5. the Kungfu binding, Evidence artifact, review, decision, and seal;
6. the exact files and tests to change.

This prevents a UI-only prototype from being mistaken for a complete workflow.

## Fast development loop

Create `.env` from `.env.example`, then use the developer overlay:

```sh
COMPOSE_PROJECT_NAME=kungfu-course-hub-dev \
docker compose -f compose.yaml -f compose.dev.yaml up --build --detach
```

The overlay builds on the exact released Course Hub image and replaces only
`apps/course-hub/src`, `web`, and `migrations`. It keeps the packaged Kungfu CLI
and llama.cpp runtime, downloads no model weights, and avoids reproducing the
release package supply chain.

After an edit, rerun the command and check:

```sh
docker compose -f compose.yaml -f compose.dev.yaml ps
curl --fail http://127.0.0.1:8080/readyz
npm run check
```

Use a new `COMPOSE_PROJECT_NAME` for experiments that must not share named
volumes.

## Customize the course workflow

Use this path when the business object remains a course but its brief, generated
shape, or approval experience changes.

| Change | Files |
| --- | --- |
| add or change a business field | new numbered migration, `src/domain.mjs`, `src/server.mjs`, `web/app.js` |
| change generated structure | `src/course-outline-schema.mjs`, provider adapter, Mock adapter, Web rendering |
| change prompt behavior | `src/openai-compatible-agent-work-adapter.mjs` and inference tests |
| change an action | `src/agent-work-port.mjs`, domain, outbox, API, Web, SQL checks |
| change acceptance evidence | `src/kungfu-course-work-control.mjs` and projection tests |

Required checks:

- append a forward-only migration; never edit an applied migration;
- retain forced RLS on every user-owned table;
- retain immutable generated versions;
- retain provider/model/input/output provenance;
- describe the real generated artifact in Kungfu Evidence;
- test empty-database migration and restart recovery.

## Add an Agent backend

An OpenAI-compatible hosted provider is already configuration-only. Add source
only when a provider needs a different protocol or result mapping.

1. Implement `health`, `execute`, and `read` from
   `apps/course-hub/src/agent-work-port.mjs`.
2. Give the binding a stable, unambiguous prefix.
3. Teach `backendKindForBinding` to resolve that prefix.
4. Register the adapter in the `server.mjs` composition root.
5. Validate its configuration in `config.mjs`.
6. Add the backend kind through a new migration wherever SQL constraints list
   allowed backends.
7. Expose availability and provenance through `/api/runtime`.
8. Add backend selection and visible failure states in the Web projection.
9. Test idempotency, timeout, malformed output, restart recovery, and the
   absence of silent Mock fallback.

Do not let an adapter write business versions or Kungfu records directly. It
returns an `AgentWorkPort` result; the domain and work-control layers retain
their own authority.

## Create another domain workflow

Examples include customer onboarding, proposal review, compliance evidence, or
content approval.

Treat the course implementation as a pattern, not a table-renaming exercise:

| Course reference | New workflow question |
| --- | --- |
| `course_projects` | What customer-owned case or project persists? |
| `course_outline_versions` | What immutable Agent-produced artifact is versioned? |
| approved version pointer | What explicit business decision selects a result? |
| `AgentWorkPort` command | What bounded work should inference perform? |
| `kungfu:course:<id>` | What stable business binding survives retries and sessions? |
| Evidence artifact | What exact output can an independent reviewer inspect? |
| review verdict | What policy makes the artifact fit, insufficient, or invalid? |
| typed decision | Continue, request evidence, revise, or close? |
| seal | What settled native state must remain independently verifiable? |

Recommended implementation order:

1. define the user-visible job and one immutable output;
2. add user-owned PostgreSQL tables and forced RLS;
3. add domain commands and idempotent outbox delivery;
4. add one deterministic Mock adapter;
5. bind the saved artifact to one native Kungfu lifecycle;
6. project provenance and work control separately in the UI;
7. qualify two-account isolation, duplicate delivery, restart recovery, review,
   decision, and seal;
8. only then add local or hosted inference.

If multiple products will share the same platform, first extract small,
behavior-preserving modules for identity/session, outbox delivery, inference
routing, and Kungfu work control. Do not introduce a plugin registry until a
second real workflow proves the required variation.

## Change the local model catalog

Pinned choices live in `apps/course-hub/src/model-catalog.mjs`. Every entry
requires an immutable source revision, exact URL, byte count, SHA-256,
memory estimate, and visible label.

Changing the catalog requires:

- source validation;
- installation and checksum tests;
- one real model smoke for any newly claimed working choice;
- clear download and memory expectations.

Do not place model weights in Git or the application image.

## Preserve the publication boundary

The root `Dockerfile` is the only first-party product assembly. It consumes
exact architecture-specific Kungfu packages and an exact llama.cpp base.
`Dockerfile.dev` is an exploration overlay and must not become release
evidence.

Before a pull request:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run check
bash -n scripts/smoke-image.sh scripts/smoke-browser.sh
```

Use the trusted workflow for native image smoke. Do not weaken pinned
identities, localhost defaults, non-root execution, read-only root, capability
drop, or named-volume retention to make a test pass.
