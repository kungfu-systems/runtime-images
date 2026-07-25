# Kungfu runtime images

This repository publishes source-bound development images for running Kungfu
products. Its first deliverable is **Kungfu Hub Starter**, a Docker-first,
localhost-only way to see real Kungfu-managed work in a browser.

> This is a pre-Alpha development candidate. It is not production-ready,
> authenticated, multi-user, highly available, or an official Kungfu Alpha or
> stable release.

## Start the course demo

Requirements: Docker with Compose v2. This path is native on Apple Silicon Macs
(`linux/arm64`) and Intel Macs or Linux x86-64 hosts (`linux/amd64`). Windows is
not qualified in this candidate. Its intended compatibility path is Docker
Desktop's Linux-container mode, not a native Windows container, and remains a
non-claim until an actual Windows smoke is retained. The checked-in Compose file
pins the qualified development candidate by digest. Run:

```sh
docker compose up
```

Open <http://127.0.0.1:8080>. You arrive at a single-user course backend for
**Agent/Kungfu Course**, not an infrastructure dashboard. The first assignment
is already selected. Use the two actions in order:

1. **Agent claims homework is done** — the independent reviewer rejects the
   claim because no Evidence Episode is attached, so Kungfu requests evidence
   and does not settle the Assignment.
2. **Produce evidence and request review** — a deterministic script creates the
   homework artifact, publishes its exact bytes, attaches the payload reference
   to one Episode, and submits a new claim. The reviewer accepts it and Kungfu
   closes and seals the Assignment.

The page keeps Episode details, payload hashes, receipts, and the final state
root collapsed until you ask for them. This makes the human workflow primary
while preserving the native audit trail underneath. Pull time is excluded from
the five-minute semantic-readiness target. The container does not mount the
Docker socket, your Home directory, `~/.kungfu`, credentials, or host paths.

To test a separately qualified candidate, set `KUNGFU_HUB_IMAGE` to another
exact digest. Tags and floating references are rejected by the source contract.

`docker compose down` stops the project while retaining its named state
volume. This project never runs `docker compose down -v` automatically. Remove
development state only as a deliberate, separately reviewed action.

## What is real

On an empty named volume, the container uses the architecture-matched packaged
public Kungfu CLI to:

1. capture and admit the course as a native Initiative and Assignment;
2. claim a bounded execution lease and enter the executing phase;
3. reject an unproved completion claim through independent review and emit the
   follow-up decision `request-evidence`;
4. publish deterministic homework bytes and attach their payload reference to
   a native Evidence Episode;
5. accept the evidence-backed claim, close the Assignment, and create a portable
   content-addressed state seal.

The Web process does not read private storage records and does not own a second
database. It invokes public JSON CLI commands and projects their receipts. The
optional Node client is similarly bounded:

```js
import { HubStarterClient } from '@kungfu-tech/hub-starter-runtime/client';

const hub = new HubStarterClient();
console.log(await hub.state());
```

For a second isolated course, create another disposable project with a
different course name and port:

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
- the SHA-256 of both x86-64 and ARM64 Linux CLI packages;
- the digest-pinned multi-platform Node runtime base;
- the exact published runtime image digest and its source revision;
- the retained native amd64 and arm64 GitHub Actions qualification run.

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

## License

Apache-2.0. See [`LICENSE`](LICENSE). Project names and marks are addressed in
[`TRADEMARK.md`](TRADEMARK.md).
