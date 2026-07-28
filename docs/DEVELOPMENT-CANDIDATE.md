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

# Development candidate boundary

Course Hub is intentionally pre-Alpha. Its retained image smoke proves the same
Docker-hosted, localhost-only development topology natively on `linux/amd64`
and `linux/arm64`: creators can register, retain private PostgreSQL course
collections, generate immutable Mock-backed versions, preserve them across a
container restart, and settle each generated version through a real Kungfu
Assignment, Evidence Episode, independent review, typed close decision, and
state seal.

The first-party application image also contains the pinned llama.cpp runtime
but no model weights. A separate seeded qualification proves that an
authenticated explicit install verifies a pinned Qwen file, activates local
inference, produces visible model-attributed content, and then passes that
version through the same Kungfu lifecycle. Hosted provider behavior and public
Internet downloads are configuration paths, not implied production claims.

Apple Silicon Macs pull the `linux/arm64` image member and Intel Macs pull the
`linux/amd64` member through Docker Desktop. Linux hosts use the matching member
directly. This qualification set contains no Windows execution evidence.
Docker Desktop running Linux containers is the intended future compatibility
path, but Windows remains an explicit non-claim until that exact Compose path
passes and retains an actual smoke. No Windows-native container, Windows-native
Kungfu package, or Windows service installation is claimed.

It does not prove production security, account recovery, email verification,
MFA, organizations/roles, billing, SSO, public ingress, high availability,
operational SLOs, native host platform parity, or customer-data safety.
The browser label and OCI metadata repeat that boundary.

## Official Alpha substitution

The only runtime-image substitution seam is `KUNGFU_HUB_IMAGE`. It must remain
an exact `registry/path@sha256:<digest>` reference. A future official Alpha may
replace the development digest only after its own source/package/image identity
and independent qualification are recorded. No source, Compose, state, or
authority rewrite is implied by that substitution.

PostgreSQL migrations are forward-only. Kungfu and model state migration is not
automatic. Unknown contract/state combinations fail closed and require a
separately reviewed migration or a fresh development volume.
