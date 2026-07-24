# Agent entry point

Runtime Images publishes source-bound development images. Read `docs/MAP.md`
before changing the project.

Keep the runtime localhost-only, non-root, read-only, capability-free, and
without Docker socket, host network, host paths, real Kungfu homes, credentials,
or a second semantic authority. Kungfu state changes must go through packaged
public CLI commands. Never add floating source refs or floating runtime image
tags. Never automate `docker compose down -v`.

Run `npm run check` and `bash -n scripts/smoke-image.sh`. Image and daemon smoke
belongs on an ephemeral GitHub-hosted runner through the trusted manual
workflow, not on a developer or self-hosted Docker daemon by default.
