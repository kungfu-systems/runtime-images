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
last_reviewed: 2026-07-28
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
- `compose.yaml` — PostgreSQL plus one localhost-only, non-root, read-only Hub
  application service.
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
- `.github/workflows/image.yml` — trusted dual-package consumption,
  multi-platform development publication, and native amd64/arm64 evidence.
- `.github/workflows/package-stage.yml` — source/run/hash-bound transfer of the
  exact public Kungfu Actions outputs into an immutable runtime prerelease,
  without routing the large package bytes through a developer workstation.
- `docs/ARCHITECTURE.md`, `docs/EXTENDING.md`, and `docs/API.md` — authority,
  extension, and transport guides.
- `course-business-reference/` — compatibility launch and qualification path
  for the same unified first-party image, not a source tree or second product.
- `legacy/hub-starter/` — retained former demonstration implementation,
  available only through the explicit legacy npm entry.

The upstream semantic concept remains in Kungfu at
`framework/hub-starter/kungfu-hub-starter-docker.contract.json`. This
repository implements a bounded development slice; it does not replace the
upstream contract, KFD, Buildchain, or Kungfu Core authority.
