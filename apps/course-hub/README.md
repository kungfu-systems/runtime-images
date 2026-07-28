# Course Hub application

This directory is the canonical source of the product application copied into
the unified Docker image.

## Layers

- `migrations/` owns PostgreSQL roles, row-level security, business records,
  outbox state, inference provenance, and retained Kungfu roots.
- `src/domain.mjs` implements account and course use cases.
- `src/agent-work-port.mjs` and adapters isolate inference providers.
- `src/outbox.mjs` makes provider delivery idempotent and restart-safe.
- `src/kungfu-course-work-control.mjs` settles generated versions through the
  packaged public Kungfu CLI.
- `src/server.mjs` composes dependencies and exposes the HTTP API.
- `web/` is a non-authoritative presentation and command surface.
- `contracts/` and `test/` define the expected port and behavior.

The dependency direction is:

```text
Web/API -> domain -> PostgreSQL/outbox -> inference + Kungfu work control
```

Start with the repository [Architecture](../../docs/ARCHITECTURE.md) and
[Extension guide](../../docs/EXTENDING.md). Run `npm start` from the repository
root only after supplying the database and runtime environment described by
`compose.yaml`; the normal first-run path is Docker Compose.
