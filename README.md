# Kungfu runtime images

This repository publishes source-bound development images for running Kungfu
products. Its first deliverable is **Kungfu Hub Starter**, a Docker-first,
localhost-only way to see real Kungfu-managed work in a browser.

> This is a pre-Alpha development candidate. It is not production-ready,
> authenticated, multi-user, highly available, or an official Kungfu Alpha or
> stable release.

## Start the Hub

Requirements: Docker Engine with Compose v2. The checked-in Compose file already
pins the qualified development candidate by digest. Run:

```sh
docker compose up
```

Open <http://127.0.0.1:8080>. Pull time is excluded from the five-minute
semantic-readiness target. The container does not mount the Docker socket,
your Home directory, `~/.kungfu`, credentials, or host paths.

To test a separately qualified candidate, set `KUNGFU_HUB_IMAGE` to another
exact digest. Tags and floating references are rejected by the source contract.

`docker compose down` stops the project while retaining its named state
volume. This project never runs `docker compose down -v` automatically. Remove
development state only as a deliberate, separately reviewed action.

## What is real

On an empty named volume, the container uses the packaged public Kungfu CLI to:

1. capture and admit a native Initiative and Assignment;
2. claim a bounded execution lease and enter the executing phase;
3. expose proof-bound Assignment and Episode state through a thin Web adapter;
4. on request, append a completion claim, independent review, continuation
   decision, and portable content-addressed state seal.

The Web process does not read private storage records and does not own a second
database. It invokes public JSON CLI commands and projects their receipts. The
optional Node client is similarly bounded:

```js
import { HubStarterClient } from '@kungfu-tech/hub-starter-runtime/client';

const hub = new HubStarterClient();
console.log(await hub.state());
```

For one bounded course-domain extension, create a second disposable project
with a different course name and port:

```sh
COMPOSE_PROJECT_NAME=my-course HUB_PORT=8081 \
  HUB_COURSE_NAME="Responsible AI Workshop" docker compose up
```

On its fresh named volume, the adapter admits that course name through the
public Assignment request. It changes the example's domain behavior without
modifying Kungfu Core or constructing internal storage records.

## Reproducible identity

[`contracts/hub-starter-runtime.contract.json`](contracts/hub-starter-runtime.contract.json)
and [`release/runtime.lock.json`](release/runtime.lock.json) bind:

- the exact Kungfu source commit;
- the SHA-256 of `kungfu-episodes-cli-linux-x64.tar.gz`;
- the immutable build-images consumer commit and build-image digest;
- the exact published runtime image digest and its source revision;
- the retained GitHub Actions qualification run.

The Dockerfile consumes the already source-built package. It does not clone or
compile Kungfu. The final stage copies only that package plus the small runtime
adapter into a digest-pinned Node runtime; it contains no Kungfu checkout,
compiler toolchain, package cache, Docker credentials, or build secret.

## Isolation and persistence

Compose binds the service to loopback, drops every Linux capability, enables
`no-new-privileges`, runs as the non-root `node` user, and makes the root
filesystem read-only. Each Compose project gets one explicitly named state
volume and one writer. A fresh volume mints one instance identity; restart
preserves the identity and native state. Use a different
`COMPOSE_PROJECT_NAME`, `HUB_PORT`, and `HUB_INSTANCE_LABEL` for a second
isolated instance.

See [`docs/MAP.md`](docs/MAP.md) for review routes and
[`docs/DEVELOPMENT-CANDIDATE.md`](docs/DEVELOPMENT-CANDIDATE.md) for the claim
boundary and official-Alpha substitution seam.

## Course business reference

[`course-business-reference/`](course-business-reference/) is a separate,
mock-backed PostgreSQL example for commercial Builders. It adds creator
registration and login, a private per-account course collection, immutable
course-outline versions, a durable command outbox, and a versioned Agent-work
port without coupling the business schema or primary Web experience to one
inference engine. The small core image defaults to an explicit deterministic
simulation. An OpenAI-compatible adapter can instead use a hosted endpoint or
the optional local llama.cpp delivery pack without changing the course schema.
It runs as its own loopback-only Compose project and does not replace or share
the Hub's state.

## License

Apache-2.0. See [`LICENSE`](LICENSE). Project names and marks are addressed in
[`TRADEMARK.md`](TRADEMARK.md).
