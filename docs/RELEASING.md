---
status: draft
period: ongoing
theme: runtime-images-buildchain-v4
doc_type: process-rule
source_level: local-files
confidence: high
sensitivity: public
evidence_grade: B
review_state: unreviewed
last_reviewed: 2026-09-07
ai_provenance:
  model_family: GPT-6
  product: Codex
  generated_at: 2026-09-07
  boundary: Source and test inspection; public execution is qualified separately for each release.
---

# Release and preview qualification

Runtime Images uses the public Buildchain v4 workflow contract, with durable
`@v4-alpha` callers and both alpha and stable contract locks. Development changes
enter `dev/v1/v1.0` through a reviewed PR. A PR from that branch into
`alpha/v1/v1.0` requests a new alpha. The package and release-impact versions
must agree with the next available public v1.0 alpha version.

If prior alpha release preparation diverges from development, reconcile that
alpha ancestry through a reviewed development PR before requesting a candidate.
Retain the intended next version in both version files and verify the merge
tree against the reviewed development tree. Do not resolve an alpha PR by
reverting its version or force-pushing either protected branch.

The `Build` workflow produces one sealed `kungfu-buildchain-oci-family/v2`
candidate containing the complete `linux/amd64` and `linux/arm64` image index,
SBOM/provenance, and an OCI 1.1 Compose manifest. Package archives and base
images retain their accepted digests. Build does not write registry tags.
Local image execution and Compose configuration checks qualify the candidate;
they do not claim an installation from the public registry.

After the protected alpha Verify push succeeds, Buildchain's OCI provider
publishes `hub-starter:v<VERSION>` and `hub-starter:compose-v<VERSION>` under
`ghcr.io/kungfu-systems/runtime-images`. Exact bytes, anonymous registry
readback, the Release Passport, and publication settlement are retained.
The old shell publisher refuses execution. There is no branch-protection
bypass or consumer shell publication fallback.

The image labels retain the original built candidate SHA. A protected merge
may have a different SHA with the same source tree: qualification binds the
family to the Passport's `builtSourceSha` and `builtSourceTreeSha`, while the
public tag, readback, and workflow run bind to the protected publication SHA.
Do not rewrite an already published tag to repair its qualification tooling;
publish and qualify the next alpha instead.

Once those immutable artifacts and settlement are public, dispatch
`qualify-release.yml` on the exact `v<VERSION>` tag. This read-only workflow
pulls the published image members and Compose digest and exercises fresh
installation, account isolation, restart persistence, and the same named
volumes through previous preview, new release, and previous preview again.
The PostgreSQL container identity must survive upgrade and rollback.
The amd64 evidence covers the full native Kungfu lifecycle; arm64 on the
hosted amd64 runner uses the explicitly labelled QEMU platform contract and
installed `kungfu agent verify`. It is not native arm64 lifecycle evidence.

The successful qualification emits only bounded JSON evidence and the
`kungfu-buildchain-compose-qualification/v1` receipt. Installation credentials
and test session-state files are not uploaded. The thin `compose-preview.yml`
callback invokes Buildchain's public Compose preview workflow, which verifies
the complete publication settlement, exact tag/run/source, both platforms,
evidence hashes, and the previous preview digest sealed in the candidate.
Only then does it copy the immutable Compose manifest bytes to `compose-preview`
and append a public preview receipt. A failed qualification leaves the existing
preview intact. A competing preview change requires a newly qualified candidate.

This release tooling does not migrate business data, change package identity,
or qualify arbitrary older database schemas. Never use `docker compose down -v`
to clean up qualification runs. Accept the resulting exact release coordinates
into `release/runtime.lock.json` and the runtime contract through a follow-up
reviewed PR after all public evidence agrees.
