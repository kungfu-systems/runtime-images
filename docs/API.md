# Course Hub API

The browser and external clients use the same HTTP surface. This document is a
navigation guide; server behavior and tests remain authoritative.

## Transport rules

- JSON request bodies are limited to 16 KiB.
- State-changing requests require the exact configured `Origin`.
- Authenticated state changes require `x-csrf-token`.
- Agent and backend-switch commands accept an `idempotency-key`.
- Session cookies are opaque, `HttpOnly`, and `SameSite=Lax`.
- Error bodies intentionally avoid account and internal-state disclosure.

## Health and runtime

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | process liveness |
| GET | `/readyz` | database, migrations, and default inference readiness |
| GET | `/api/runtime` | available inference backends and local model catalog |
| GET | `/api/session` | current session and backend label |

## Account

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/register` | create an account and session |
| POST | `/api/login` | create a session |
| POST | `/api/logout` | revoke the current session |

Registration and login are rate-limited. Password hashes use scrypt; only a
session-token hash is persisted.

## Local models

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/runtime/local-models/:modelId/install` | start or resume an authenticated pinned download |
| POST | `/api/runtime/local-models/:modelId/activate` | activate an installed model through private llama.cpp |

Installation returns `202`; progress is read through `/api/runtime`.

## Courses

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/courses` | list the current account's courses |
| POST | `/api/courses` | create a course and provision its selected backend |
| GET | `/api/courses/:courseId` | read one course, versions, provenance, and work control |
| POST | `/api/courses/:courseId/backend` | switch the course's explicit backend |
| POST | `/api/courses/:courseId/actions/generate` | generate another immutable version |
| POST | `/api/courses/:courseId/actions/revise` | revise from the current version and feedback |
| POST | `/api/courses/:courseId/versions/:versionId/approve` | select one saved version |

Ownership is enforced both in queries and PostgreSQL RLS. A foreign identifier
projects as not found.

## Compatibility homework routes

The earlier guided-work projection remains available for compatibility:

| Method | Path |
| --- | --- |
| GET | `/api/homeworks` |
| GET | `/api/homeworks/:homeworkId` |
| POST | `/api/homeworks/:homeworkId/actions/first-submission` |
| POST | `/api/homeworks/:homeworkId/actions/evidence` |
| POST | `/api/homeworks/:homeworkId/actions/review` |
| POST | `/api/homeworks/:homeworkId/actions/seal` |

New product work should use course routes and the native work-control projection
attached to each version.

## Typical authenticated call

1. Call `/api/session` or register/login.
2. Retain the `course_session` cookie and returned `csrfToken`.
3. For a state change, send the exact Origin and `x-csrf-token`.
4. For an Agent action, also send a stable `idempotency-key`.
5. Read the returned course or poll its detail after a recoverable interruption.

Provider failure is visible. The server never retries a selected local or
hosted provider as Mock.
