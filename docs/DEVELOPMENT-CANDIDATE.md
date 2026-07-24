# Development candidate boundary

Hub Starter is intentionally pre-Alpha. Its retained image smoke proves one
Linux/amd64, Docker-hosted, localhost-only development topology: two isolated
instances become semantically ready, preserve their identities across a clean
container restart, cannot select each other's Assignment through the HTTP
surface, and produce a real Kungfu completion/review/decision/seal sequence.

It does not prove production security, authentication, authorization, SSO,
multi-user tenancy, public ingress, high availability, backup/restore,
upgrade/rollback, operational SLOs, platform parity, or customer-data safety.
The browser label and OCI metadata repeat that boundary.

## Official Alpha substitution

The only runtime-image substitution seam is `KUNGFU_HUB_IMAGE`. It must remain
an exact `registry/path@sha256:<digest>` reference. A future official Alpha may
replace the development digest only after its own source/package/image identity
and independent qualification are recorded. No source, Compose, state, or
authority rewrite is implied by that substitution.

State migration is not automatic. Unknown contract/state combinations fail
closed and require a separately reviewed migration or a fresh development
volume.
