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
- `compose.yaml` — PostgreSQL plus one localhost-only, non-root, read-only Hub
  application service.
- `contracts/hub-starter-runtime.contract.json` — machine-readable claim and
  safety boundary.
- `release/runtime.lock.json` — exact package, source, image, and qualification
  identities.
- `course-business-reference/src/domain.mjs` and `migrations/` — PostgreSQL
  identity, account isolation, course collection, versions, approvals, and
  outbox authority.
- `course-business-reference/src/agent-work-router.mjs` — stable inference port
  across explicit Mock, local, and hosted backends.
- `course-business-reference/src/local-model-manager.mjs` and
  `model-catalog.mjs` — pinned click-to-install Qwen choices, resumable
  streaming verification, activation, and private llama.cpp process control.
- `course-business-reference/src/kungfu-course-work-control.mjs` — public-CLI
  per-course/per-version Assignment, Evidence, review, decision, recovery, and
  seal adapter.
- `course-business-reference/src/server.mjs` and `web/` — authenticated
  customer-facing command and projection surface.
- `scripts/verify.mjs` and `test/` — source and negative policy checks.
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
- `course-business-reference/` — source and compatibility launch path for the
  same unified first-party image, not a second product.

The upstream semantic concept remains in Kungfu at
`framework/hub-starter/kungfu-hub-starter-docker.contract.json`. This
repository implements a bounded development slice; it does not replace the
upstream contract, KFD, Buildchain, or Kungfu Core authority.
