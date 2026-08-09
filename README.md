# Kungfu Course Hub

Kungfu Course Hub is a runnable, Apache-2.0 reference application for building
an account-based Agent product with PostgreSQL business state and Kungfu work
control.

It is intentionally concrete: a creator registers, describes a course, asks an
Agent to generate an outline, keeps immutable versions, and approves one
version. Every generated version then receives an independent Kungfu work
record with Evidence, review, a typed decision, and a portable seal.

The project is useful in two ways:

- run it to understand what a Kungfu-managed Agent product feels like;
- fork the complete vertical slice to explore a real workflow of your own.

> This is a pre-Alpha development reference, not a production SaaS template.
> It does not claim public-ingress security, account recovery, billing, SSO,
> high availability, backups, or operational SLOs.

## Understand it in one minute

Three systems have different jobs:

| Question | Authority |
| --- | --- |
| Who is the user, and which business records are theirs? | PostgreSQL |
| Which model produced this visible draft? | Mock, local Qwen, or a configured hosted provider |
| Was the work claimed, evidenced, reviewed, decided, and sealed? | Kungfu |

The Web application presents those facts, but does not become a second
authority.

```text
browser
  -> Course Hub API
  -> PostgreSQL transaction + durable outbox
       -> AgentWorkPort -> Mock / local Qwen / hosted provider
       -> Kungfu public CLI -> Assignment / Evidence / review / decision / seal
```

See [Architecture](docs/ARCHITECTURE.md) for the complete request and recovery
flow.

## Try it before reading the repository

Requirements:

- Docker Engine or Docker Desktop;
- Docker Compose 2.34 or later;
- `linux/amd64` or `linux/arm64`.

Start the complete local application directly from its public OCI artifact:

```sh
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview up --wait
```

On first use, Compose shows the remote application and interpolation variables
for confirmation. Then open <http://127.0.0.1:8080>, register, create a course,
and generate its first outline. No source checkout, `.env` file, database
password, or model download is required.

Choose another Web port with the same command:

```sh
HUB_PORT=9090 docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview up --wait
```

Then open <http://127.0.0.1:9090>. PostgreSQL is never published to a host port,
so it cannot collide with a PostgreSQL installation already using `5432`.
Course data, Kungfu state, optional model files, and generated database
credentials persist in isolated named volumes.

The initial backend is an explicitly labelled deterministic Mock, so the first
start adds no model-weight download. The single Hub image already contains
llama.cpp; Qwen weights are downloaded only after the user chooses a model in
the product.

Stop without deleting data:

```sh
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview stop
```

The project never automates `docker compose down -v`.

Upgrade the running application while preserving its named volumes:

```sh
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview up --pull always --wait
```

Reuse the same `HUB_PORT`, `HUB_PUBLIC_ORIGIN`, and `COMPOSE_PROJECT_NAME`
values from the original installation. Compose pulls the current qualified
Alpha image and recreates changed services without deleting PostgreSQL,
Kungfu, model, or generated-configuration volumes. See
[Upgrade and rollback](docs/UPGRADING.md) for verification, exact-version
pinning, and recovery guidance.

> `compose-preview` is the pre-Alpha convenience channel. Qualified releases
> also retain immutable application coordinates for reproducible evaluation.
> The channel moves only after that exact immutable artifact passes a fresh
> installation smoke; the promoted preview retains the same OCI digest.

## Recommended next step: ask an Agent

This repository is designed to be explained from its checked-in contracts and
the Kungfu runtime inside the Docker image. A capable coding Agent can connect
the product UI, source code, PostgreSQL model, and KFD-3 interface faster than a
file-by-file tour.

Give the Agent this prompt:

```text
Read AGENTS.md, docs/ARCHITECTURE.md, docs/EXTENDING.md, and docs/API.md.
If the Hub is running, execute:
  docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview exec -T hub kungfu agent brief
  docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview exec -T hub kungfu agent verify --json
Explain the product in terms of:
1. the user-visible workflow;
2. PostgreSQL, inference, and Kungfu authority;
3. the exact files I would change for my workflow;
4. the invariants I must preserve.
Do not modify code until you have proposed an extension map.
```

`kungfu agent brief` is the complete offline first read from the exact Kungfu
runtime shipped in the image. It exposes the value, constraints, modes, public
commands, and KFD-3 discovery path without initializing product state.
`kungfu agent verify --json` verifies that the installed `kungfu agent` command
tree closes against its declared KFD-3 registry.

## Inspect the running product

Inspect the Kungfu interface from the running image:

```sh
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview exec -T hub kungfu agent brief
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview exec -T hub kungfu agent verify --json
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview exec -T hub kungfu agent work-model --json
```

Ordinary restart preserves the PostgreSQL, Kungfu, and model named volumes.
Direct `docker run` is intentionally not the supported installation surface:
the reference needs a private PostgreSQL service and persistent generated
credentials, which the published Compose application supplies safely.

## Explore the source with a fast edit-build-run loop

The production Dockerfile consumes exact, prebuilt Kungfu packages. A Builder
should not need to reproduce that supply chain just to change a prompt, route,
domain rule, or page. Clone the repository only when ready to explore source;
ordinary product evaluation needs no checkout.

The developer overlay starts from the exact published Hub image and replaces
only the checked-in Course Hub application source:

```sh
COMPOSE_PROJECT_NAME=kungfu-course-hub-dev \
docker compose -f compose.yaml -f compose.dev.yaml up --build --detach
```

After editing `apps/course-hub/`, rerun the same command. The build reuses the
published Kungfu and llama.cpp runtime and does not download model weights.

Use a different `COMPOSE_PROJECT_NAME` for each experiment so its named volumes
remain isolated. The developer overlay is for source exploration; the root
`Dockerfile` and trusted workflow remain the reproducible publication path.

## Choose an exploration path

| Goal | Start here |
| --- | --- |
| Change course fields, prompt, output, or UI | [Customize the course workflow](docs/EXTENDING.md#customize-the-course-workflow) |
| Add a non-OpenAI inference provider | [Add an Agent backend](docs/EXTENDING.md#add-an-agent-backend) |
| Build a different business workflow | [Create another domain workflow](docs/EXTENDING.md#create-another-domain-workflow) |
| Understand the HTTP surface | [API guide](docs/API.md) |
| Understand the authority and recovery model | [Architecture](docs/ARCHITECTURE.md) |
| Upgrade or pin a running installation | [Upgrade and rollback](docs/UPGRADING.md) |
| Understand every directory | [Project map](docs/MAP.md) |

The narrowest extension is configuration: a hosted OpenAI-compatible provider
requires no source changes. A new course shape touches the domain and Web
layers. A new business workflow should retain the platform invariants while
replacing course-specific tables, commands, artifacts, and presentation.

## Product capabilities

- creator registration and login with opaque sessions;
- PostgreSQL-enforced per-account isolation using forced row-level security;
- private course collections and immutable generated versions;
- one approved-version pointer per course;
- durable, idempotent Agent command delivery and restart recovery;
- visible Mock, user-installed local Qwen, and optional hosted inference;
- no silent fallback to Mock after selecting local or hosted inference;
- one stable Kungfu binding per course;
- one native work lifecycle per generated version;
- retained Evidence, independent review, typed decision, and seal roots;
- non-root, read-only, capability-free container execution.

## One image, optional models

The first-party image includes:

- the Course Hub Web application and migrations;
- the exact architecture-matched Kungfu public CLI;
- the llama.cpp runtime;
- no model weights and no provider credential.

After signing in, open **AI: Mock** in the header. A local model is downloaded
only after **Download** is clicked. The runtime streams it into the named model
volume, validates its pinned byte count and SHA-256, and installs it atomically.

| Choice | Download | Intended use |
| --- | ---: | --- |
| Qwen3 0.6B Q4_K_M | 396,705,472 bytes | fastest end-to-end evaluation |
| Qwen3 1.7B Q8_0 | 1,834,426,016 bytes | balanced local drafting |
| Qwen3 4B Q4_K_M | 2,497,280,256 bytes | stronger course design |

A hosted OpenAI-compatible provider is an optional deployment overlay. Mount
its token as a local secret file and set
`COURSE_HOSTED_AGENT_BASE_URL`, `COURSE_HOSTED_AGENT_MODEL`,
`COURSE_HOSTED_AGENT_PROVIDER_LABEL`, and
`COURSE_HOSTED_AGENT_API_KEY_FILE`.

## Repository shape

```text
apps/course-hub/             canonical business application
  migrations/                PostgreSQL schemas, roles, RLS, and domain state
  src/                       domain, adapters, outbox, Kungfu work control
  web/                       browser product surface
  contracts/                 AgentWorkPort schemas
  test/                      domain and boundary tests
contracts/                   image/runtime claim boundary
release/                     exact source, package, image, and CI identities
buildchain.toml              Buildchain-owned verify and publish lifecycles
.buildchain/                 release impact and generated transaction evidence
.github/workflows/           verification, dry runs, and governed promotion
course-business-reference/   compatibility Compose entry only
legacy/hub-starter/          retained former demonstration implementation
docs/                        architecture, API, extension, and claim guides
scripts/                     source and image qualification
```

The canonical application is `apps/course-hub/`. `npm start`, the production
Dockerfile, and the test suite all point to it. The former demonstration remains
available as `npm run start:legacy`; it is not part of the published Course Hub
image.

## Validation

```sh
npm ci --ignore-scripts
npm run check
bash -n scripts/smoke-image.sh scripts/smoke-browser.sh
```

The full image smoke proves account isolation, database role separation, Mock
generation, real Kungfu settlement, restart persistence, non-root execution, a
read-only root filesystem, and no added Linux capabilities. Local-model smoke
also proves explicit installation, activation, visible model output,
provenance, and subsequent Kungfu settlement.

See [Development candidate boundary](docs/DEVELOPMENT-CANDIDATE.md) for exact
claims and non-claims.

## Reproducible delivery

[`contracts/hub-starter-runtime.contract.json`](contracts/hub-starter-runtime.contract.json)
and [`release/runtime.lock.json`](release/runtime.lock.json) bind the exact
Kungfu source, architecture packages, base images, published image, and
qualification run.

Buildchain owns version selection, exact alpha and release refs, the image and
OCI Compose publish transaction, durable evidence, finalization, and the
Release Passport. Repository code still owns the Dockerfile, Compose source,
registry inspection, multi-platform smoke, and evidence adapter.

The exact release artifacts use these coordinates:

```text
ghcr.io/kungfu-systems/runtime-images/hub-starter:v<VERSION>
ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-v<VERSION>
```

`compose-preview` remains the low-friction pre-Alpha channel. It moves only
after the exact versioned application passes a fresh installation smoke and
the repository has written complete transaction evidence. The GitHub Release
retains that evidence and the Buildchain Release Passport.

The manual Image candidate, Compose application, and Kungfu package input
workflows are qualification-only. Package intake consumes the x64 archive,
arm64 archive, and product admission capsule from one exact Kungfu `Build` run
and emits a fail-closed runtime lock/contract proposal. These workflows cannot
authenticate to GHCR, publish a release artifact, or move `compose-preview`. A
non-dry-run release starts only after a protected alpha or release merge
succeeds in `Verify`.

To test another qualified image from a source checkout, set
`KUNGFU_HUB_IMAGE` to an exact `registry/path@sha256:<digest>` reference.
Floating runtime tags are rejected.

## License

Apache-2.0. See [LICENSE](LICENSE). Project names and marks are addressed in
[TRADEMARK.md](TRADEMARK.md).
