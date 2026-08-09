---
status: draft
period: 2026-08-09
theme: kungfu-hub-starter
doc_type: analysis
source_level: local-files
confidence: high
sensitivity: public
evidence_grade: A
review_state: unreviewed
last_reviewed: 2026-08-09
---

# Upgrade and rollback

Hub Starter has one supported installation surface: its published OCI Compose
application. You do not need a source checkout to update it.

## Before you update

Keep the installation identity the same as the first start:

- reuse `COMPOSE_PROJECT_NAME` if you set one;
- reuse `HUB_PORT` if you chose a port other than `8080`;
- reuse `HUB_PUBLIC_ORIGIN` if you configured one.

For example, an installation originally started with
`COMPOSE_PROJECT_NAME=my-hub HUB_PORT=9090` must use both values again during
the update. A different project name creates a separate set of named volumes
instead of updating the existing installation.

Inspect the current services without changing them:

```sh
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview ps
```

Add the same environment values to this and every command below when they were
used for the original installation.

## Update the floating Alpha

```sh
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview up --pull always --wait
```

This fetches the current `compose-preview` application, pulls its qualified Hub
image, and recreates changed services. PostgreSQL data, Kungfu state, downloaded
models, and generated installation credentials remain in named volumes.

Do not use `docker compose down -v`. The `-v` option deletes the named volumes
that contain the local installation state.

## Verify the update

```sh
curl --fail "http://127.0.0.1:${HUB_PORT:-8080}/readyz"
docker compose -f oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-preview ps
```

Then open the Hub and confirm that registration or login, the course collection,
and one generation workflow behave as expected.

## Pin or roll back to an exact release

`compose-preview` is a moving pre-Alpha channel. Every qualified release also
retains an immutable Compose coordinate. Set `VERSION` to a version from the
[release list](https://github.com/kungfu-systems/runtime-images/releases):

```sh
VERSION=v1.0.0-alpha.8
docker compose -f "oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-${VERSION}" up --pull always --wait
```

Use the same exact-version command to pin an installation or return to a
previous application version. Read the selected release notes before rolling
back across a database migration; older application code may not understand a
newer schema.

Before `compose-preview` moves, the release transaction exercises the same
project name and named volumes through the previous exact preview, the new
exact candidate, and the previous exact preview again. It requires the same
PostgreSQL container identity and retained Course Hub/Kungfu state after both
the upgrade and rollback. This bounded release test does not override the
forward-only migration warning for arbitrary older versions.

If a distributor supplied an offline Hub image, load it and override only the
image while retaining the published Compose application:

```sh
VERSION=v1.0.0-alpha.8
LOADED_IMAGE_REFERENCE=hub-starter-local:v1.0.0-alpha.8
docker load --input "hub-starter-${VERSION}.tar"
KUNGFU_HUB_IMAGE="${LOADED_IMAGE_REFERENCE}" \
  docker compose -f "oci://ghcr.io/kungfu-systems/runtime-images/hub-starter:compose-${VERSION}" up --wait
```

The Compose application remains responsible for the private PostgreSQL service,
generated credentials, health checks, and persistent volumes. Direct
`docker run` is not an equivalent upgrade surface.
