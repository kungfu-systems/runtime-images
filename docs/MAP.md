---
status: draft
period: 2026-07-25
theme: kungfu-hub-starter
doc_type: analysis
source_level: local-files
confidence: high
sensitivity: public
evidence_grade: A
review_state: unreviewed
last_reviewed: 2026-07-25
ai_provenance:
  model_family: GPT-5
  product: Codex
  generated_at: 2026-07-25
  boundary: No access to hidden model checkpoint or build identifiers.
---

# Project map

- `Dockerfile` — architecture-selecting package verification and minimal
  multi-platform runtime assembly.
- `compose.yaml` — localhost-only, non-root, read-only default topology.
- `contracts/hub-starter-runtime.contract.json` — machine-readable claim and
  safety boundary.
- `release/runtime.lock.json` — exact package, source, image, and qualification
  identities.
- `src/runtime.mjs` — thin public-CLI coursework adapter; no native storage
  access and no private record construction.
- `src/server.mjs` and `web/` — bounded Web projection.
- `src/client.mjs` — minimal Node-facing extension seam.
- `scripts/verify.mjs` and `test/` — source and negative policy checks.
- `scripts/smoke-image.sh` — two-instance, restart, and semantic coursework
  smoke.
- `scripts/smoke-browser.sh` — real-browser three-state DOM assertions and
  retained screenshots for the guided coursework path.
- `.github/workflows/image.yml` — trusted dual-package consumption,
  multi-platform development publication, and native amd64/arm64 evidence.

The upstream semantic concept remains in Kungfu at
`framework/hub-starter/kungfu-hub-starter-docker.contract.json`. This
repository implements a bounded development slice; it does not replace the
upstream contract, KFD, Buildchain, or Kungfu Core authority.
