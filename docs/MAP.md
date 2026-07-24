# Project map

- `Dockerfile` — two-stage package verification and minimal runtime assembly.
- `compose.yaml` — localhost-only, non-root, read-only default topology.
- `contracts/hub-starter-runtime.contract.json` — machine-readable claim and
  safety boundary.
- `release/runtime.lock.json` — exact package, source, image, and qualification
  identities.
- `src/runtime.mjs` — thin public-CLI adapter; no native storage access.
- `src/server.mjs` and `web/` — bounded Web projection.
- `src/client.mjs` — minimal Node-facing extension seam.
- `scripts/verify.mjs` and `test/` — source and negative policy checks.
- `scripts/smoke-image.sh` — GitHub-hosted two-instance/restart smoke.
- `.github/workflows/image.yml` — trusted manual package consumption,
  development publication, and retained evidence.

The upstream semantic concept remains in Kungfu at
`framework/hub-starter/kungfu-hub-starter-docker.contract.json`. This
repository implements a bounded development slice; it does not replace the
upstream contract, KFD, Buildchain, or Kungfu Core authority.
