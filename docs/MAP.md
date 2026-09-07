---
status: draft
period: 2026-07-28
theme: kungfu-hub-starter
doc_type: analysis
source_level: local-files
confidence: high
sensitivity: public
evidence_grade: A
review_state: unreviewed
last_reviewed: 2026-09-07
ai_provenance:
  model_family: GPT-5
  product: Codex
  generated_at: 2026-07-28
  boundary: No access to hidden model checkpoint or build identifiers.
---

# Project map

- `Dockerfile` — architecture-selecting package verification and minimal
  multi-platform runtime assembly.
- `Dockerfile.dev` and `compose.dev.yaml` — source-only developer rebuild over
  the exact published runtime.
- `compose.yaml` — network-free credential bootstrap, private PostgreSQL, and
  one localhost-only, non-root, read-only Hub application service.
- `contracts/hub-starter-runtime.contract.json` — machine-readable claim and
  safety boundary.
- `release/runtime.lock.json` — exact package, source, image, and qualification
  identities.
- `apps/course-hub/src/domain.mjs` and `migrations/` — PostgreSQL
  identity, account isolation, course collection, versions, approvals, and
  outbox authority.
- `apps/course-hub/src/agent-work-router.mjs` — stable inference port
  across explicit Mock, local, and hosted backends.
- `apps/course-hub/src/local-model-manager.mjs` and
  `model-catalog.mjs` — pinned click-to-install Qwen choices, resumable
  streaming verification, activation, and private llama.cpp process control.
- `apps/course-hub/src/bootstrap-secrets.mjs` — atomic, reusable installation
  credentials without user-authored passwords.
- `apps/course-hub/src/kungfu-course-work-control.mjs` — public-CLI
  per-course/per-version Assignment, Evidence, review, decision, recovery, and
  seal adapter.
- `apps/course-hub/src/server.mjs` and `web/` — authenticated
  customer-facing command and projection surface.
- `apps/course-hub/contracts/` and `test/` — inference-port contracts and
  application behavior tests.
- `scripts/verify.mjs` and root `test/` — source, packaging, documentation, and
  negative policy checks.
- `scripts/smoke-image.sh` and `smoke-course-api.mjs` — account isolation,
  PostgreSQL persistence, real Kungfu settlement, and hardened-runtime smoke.
- `scripts/smoke-local-image.sh` and `smoke-local-model.mjs` — explicit local
  model install, activation, real generated content, provenance, and Kungfu
  settlement smoke.
- `scripts/smoke-browser.sh` — real-browser authenticated product-entry smoke.
- `.github/workflows/build.yml` — Buildchain v4 sealed dual-platform OCI candidate.
- `.github/workflows/image.yml` and `application.yml` — manual read-only contract checks.
- `.github/workflows/qualify-release.yml` — exact published-tag image and Compose qualification.
- `.github/workflows/compose-preview.yml` — thin public v4 qualification callback.
- `docs/RELEASING.md` — immutable publication, public qualification, and preview evidence.
- `.github/workflows/package-stage.yml` and
  `scripts/prepare-kungfu-build-candidate.mjs` — one-run intake of the Linux
  x64 package, Linux arm64 package, and product admission capsule from the same
  exact Kungfu `Build` candidate. The retained qualification artifact contains
  a fail-closed runtime lock/contract proposal but has no publication authority.
- `scripts/stage-kungfu-package-release.sh` — retained package-staging adapter; the v4 runtime
  candidate consumes the already published, accepted package release.
- `docs/ARCHITECTURE.md`, `docs/EXTENDING.md`, `docs/API.md`, and
  `docs/UPGRADING.md` — authority, extension, transport, and installation
  lifecycle guides.
- `course-business-reference/` — compatibility launch and qualification path
  for the same unified first-party image, not a source tree or second product.
- `legacy/hub-starter/` — retained former demonstration implementation,
  available only through the explicit legacy npm entry.

The upstream semantic concept remains in Kungfu at
`framework/hub-starter/kungfu-hub-starter-docker.contract.json`. This
repository implements a bounded development slice; it does not replace the
upstream contract, KFD, Buildchain, or Kungfu Core authority.
