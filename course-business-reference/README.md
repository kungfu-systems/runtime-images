# Course business reference compatibility path

This directory retains compatibility Compose files and qualification scripts
for older automation. It is no longer a source tree, separate image, or
Mock-only product.

The root [`Dockerfile`](../Dockerfile) assembles this application together with
the architecture-matched Kungfu public CLI and llama.cpp runtime. The root
[`compose.yaml`](../compose.yaml) is the canonical installation surface. This
directory's Compose file remains for existing development automation and
launches the same `KUNGFU_HUB_IMAGE`.

The canonical application source is [`apps/course-hub/`](../apps/course-hub/).
New development should start from the root
[`README.md`](../README.md) and [`docs/EXTENDING.md`](../docs/EXTENDING.md).

## What the reference proves

- creator registration, login, opaque sessions, Origin/CSRF controls;
- private per-account course collections enforced in PostgreSQL;
- immutable generated outline versions and one approved-version pointer;
- a durable, idempotent command outbox and backend-switch history;
- explicit Mock, local Qwen, and optional hosted inference;
- one stable Kungfu binding per course and one real native work lifecycle per
  generated version;
- retained Evidence, independent review, typed decision, and seal roots.

The business database and Kungfu have different jobs. PostgreSQL owns customer
identity and business records. The selected Agent backend produces visible
course content. Kungfu governs the work claim and its evidence/review/decision
history. The Web page projects those authorities without treating any one of
them as the whole product.

## Compatibility launch

Use the root launch for new installations. Existing scripts may still run:

```sh
cd course-business-reference
COURSE_DB_MIGRATION_PASSWORD=synthetic_migration_42 \
COURSE_DB_APP_PASSWORD=synthetic_runtime_42 \
docker compose up --detach
```

Open <http://127.0.0.1:8090>. Set `KUNGFU_HUB_IMAGE` to a separately qualified
exact image digest when testing a candidate.

The default backend is the visibly labelled deterministic Mock. The header
model menu exposes three pinned Qwen choices. Authenticated users explicitly
start a download; model bytes go to the named model volume, not the image.
Exact size and SHA-256 verification precede activation, and an interrupted
download can resume. The application does not silently relabel or retry failed
local/hosted inference as Mock.

## Authority boundary

| Fact | Authority |
| --- | --- |
| user, credential, session | PostgreSQL |
| course brief, collection ownership, versions, approval | PostgreSQL |
| Agent input/output and binding provenance | PostgreSQL plus selected Agent backend |
| Assignment, Episode, review, typed decision, seal | Kungfu native state through public CLI |
| commands and presentation | non-authoritative Web surface |

`course.course_outline_versions` is append-only for generated content.
Approval changes only version status and
`course.course_projects.current_outline_version_id`. Mock execution state is
separate in `mock_agent_work`; OpenAI-compatible idempotency state is separate
in `agent_work`. The Web/domain layers depend on `AgentWorkPort/v2`.

## Security boundary

- Passwords use Node scrypt with random salts.
- Session cookies are random opaque values; PostgreSQL stores only their
  SHA-256 hashes.
- State changes require an exact configured Origin and a session CSRF token.
- PostgreSQL uses a migration owner and an application role marked
  `NOBYPASSRLS`; user-owned tables have forced row-level security.
- The container runs as `node`, with a read-only root filesystem, no added
  Linux capabilities, no Docker socket, and only named volumes.

This remains a synthetic development reference, not a production
authentication or public-ingress certification.

## Validation

From the repository root:

```sh
npm ci --ignore-scripts
npm run check
bash -n scripts/smoke-image.sh scripts/smoke-browser.sh
```

`scripts/smoke-image.sh` validates account isolation, PostgreSQL restart
persistence, real Kungfu settlement, and runtime hardening. With a trusted
pinned seed model mounted read-only,
`scripts/smoke-local-image.sh` and `scripts/smoke-local-model.mjs` validate the
explicit install, activation, real local generation, provenance, and subsequent
Kungfu seal.

Migrations are ordered and forward-only. Never edit an applied migration;
append a new numbered file and qualify both an empty database and restart
recovery.
