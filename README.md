# Kungfu Course Hub

This repository publishes one Docker application for a small commercial
Builder to understand and extend a Kungfu-managed Agent product.

The current development candidate is a complete reference slice:

- creators register and sign in;
- PostgreSQL owns private per-account course collections, durable sessions,
  immutable outline versions, approvals, backend bindings, and the outbox;
- Mock, a user-installed local Qwen model, or a separately configured hosted
  OpenAI-compatible provider generates visible course content;
- Kungfu independently controls every generated course version through a real
  Assignment, Evidence Episode, review, typed decision, and state seal.

Inference answers “who generated the draft?” Kungfu answers “what work was
claimed, evidenced, reviewed, decided, recovered, and sealed?” The UI presents
those as separate truths.

> This is a pre-Alpha development candidate and a reference architecture. It is
> not a production SaaS, public-ingress configuration, billing system, account
> recovery service, or security certification.

## Run

Requirements: Docker with Compose v2 on `linux/amd64` or `linux/arm64`, including
Docker Desktop on matching Intel or Apple Silicon Macs.

```sh
COURSE_DB_MIGRATION_PASSWORD=synthetic_migration_42 \
COURSE_DB_APP_PASSWORD=synthetic_runtime_42 \
docker compose up --detach
```

Open <http://127.0.0.1:8080>, register, create a course, and generate its first
outline. The default Agent is an explicitly labelled deterministic Mock, so the
first start downloads no model.

The checked-in Compose file binds only to loopback. To expose a disposable
preview to one trusted LAN, set both the bind address and matching public
origin explicitly:

```sh
HUB_BIND_ADDRESS=192.168.1.20 \
HUB_PUBLIC_ORIGIN=http://192.168.1.20:8080 \
COURSE_DB_MIGRATION_PASSWORD=synthetic_migration_42 \
COURSE_DB_APP_PASSWORD=synthetic_runtime_42 \
docker compose up --detach
```

Ordinary stop/restart preserves all named volumes. This project never
automatically runs `docker compose down -v`.

## One image, optional models

There is one first-party Hub image for every delivery mode. It includes:

- the Course Hub Web application and migrations;
- the exact architecture-matched Kungfu public CLI package;
- the llama.cpp runtime;
- no model weights and no provider credential.

After signing in, open **AI: Mock** in the header. A model is downloaded only
after **Download** is clicked, is streamed into the named model volume, checked
against its pinned byte count and SHA-256, and atomically installed. Activation
starts the private llama.cpp process inside the same container. A partial
download is resumable.

The initial catalog deliberately offers different capability and storage
levels:

| Choice | Download | Intended use |
| --- | ---: | --- |
| Qwen3 0.6B Q4_K_M | 396,705,472 bytes | fastest end-to-end evaluation |
| Qwen3 1.7B Q8_0 | 1,834,426,016 bytes | balanced local drafting |
| Qwen3 4B Q4_K_M | 2,497,280,256 bytes | stronger course design |

The runtime never silently falls back to Mock when a selected local or hosted
provider fails. Existing saved versions retain their original provider, model,
delivery mode, backend binding, and transition provenance.

A hosted OpenAI-compatible provider is an optional deployment overlay. Mount
its token as a local secret file and set `COURSE_HOSTED_AGENT_BASE_URL`,
`COURSE_HOSTED_AGENT_MODEL`, `COURSE_HOSTED_AGENT_PROVIDER_LABEL`, and
`COURSE_HOSTED_AGENT_API_KEY_FILE`. The public image does not contain a shared
provider key.

## Authority and handoff

| Concern | Authority |
| --- | --- |
| identity, session, account isolation | PostgreSQL |
| course brief, collection, versions, approval | PostgreSQL |
| inference output and model provenance | selected Agent backend, persisted by PostgreSQL |
| work claim, Evidence, review, decision, recovery, seal | Kungfu public CLI and native state |
| presentation and commands | non-authoritative Web application |

Each course has one stable `kungfu:course:<course-id>` binding. Each generated
version receives its own immutable work artifact and native lifecycle. The Web
application does not construct private Kungfu records: it uses packaged public
JSON CLI commands, stores only stable roots and receipts with the business
version, and can resume an interrupted lifecycle from native status.

The collapsed **Work control · current truth** card shows the actual handoff:
Agent output → business version → Kungfu Assignment → Evidence → independent
review → typed decision → seal.

## Reproducible delivery

[`contracts/hub-starter-runtime.contract.json`](contracts/hub-starter-runtime.contract.json)
and [`release/runtime.lock.json`](release/runtime.lock.json) bind:

- the exact Kungfu source commit and amd64/arm64 package SHA-256 values;
- the digest-pinned Node and llama.cpp base images;
- the exact published multi-platform Hub image and qualification run;
- the non-root, read-only, no-Docker-socket runtime boundary.

The Dockerfile consumes already built Kungfu packages. It does not clone or
compile Kungfu and does not copy a model, checkout, compiler toolchain, package
cache, Docker credential, or build secret into the final image.

To test a separately qualified candidate, set `KUNGFU_HUB_IMAGE` to an exact
`registry/path@sha256:<digest>` reference. Floating tags are rejected by the
source contract.

## Validation

```sh
npm ci --ignore-scripts
npm run check
bash -n scripts/smoke-image.sh scripts/smoke-browser.sh
```

The image smoke uses synthetic users and isolated named volumes to prove:
account isolation, migration/application role separation, Mock generation,
real Kungfu Evidence/review/decision/seal settlement, restart persistence,
non-root execution, a read-only root filesystem, and no added Linux
capabilities. `scripts/smoke-local-model.mjs` additionally qualifies
click-install, activation, real local inference output, and its subsequent
Kungfu settlement when a pinned seed model is supplied through
`scripts/smoke-local-image.sh`.

The former `course-business-reference/` entry remains as a compatibility path
for older automation, but it now launches this same unified first-party image;
it is no longer a second product or image.

See [`docs/MAP.md`](docs/MAP.md) for the repository map and
[`docs/DEVELOPMENT-CANDIDATE.md`](docs/DEVELOPMENT-CANDIDATE.md) for explicit
claims and non-claims.

## License

Apache-2.0. See [`LICENSE`](LICENSE). Project names and marks are addressed in
[`TRADEMARK.md`](TRADEMARK.md).
