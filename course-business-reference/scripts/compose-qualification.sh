#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH='' cd -- "${script_dir}/.." && pwd)
repo_dir=$(CDPATH='' cd -- "${project_dir}/.." && pwd)
project_name=${COMPOSE_PROJECT_NAME:-kungfu-course-reference-qualification}

: "${COURSE_DB_MIGRATION_PASSWORD:=synthetic_migration_42}"
: "${COURSE_DB_APP_PASSWORD:=synthetic_runtime_42}"
: "${COURSE_PORT:=18090}"
: "${COURSE_PUBLIC_ORIGIN:=http://127.0.0.1:${COURSE_PORT}}"
: "${COURSE_QUALIFICATION_RUN_ID:=q$(date -u +%Y%m%dT%H%M%SZ)-$$}"
: "${COURSE_SESSION_HOURS:=0.01}"
: "${COURSE_EXPIRY_WAIT_MS:=38000}"
: "${COURSE_OUTBOX_PROCESSING_STALE_SECONDS:=1}"
: "${COURSE_QUALIFICATION_TIMEOUT_ONCE:=run_first_submission}"
: "${COURSE_QUALIFICATION_CRASH_AFTER_ADAPTER_ONCE:=true}"
: "${COURSE_EVIDENCE_PATH:=${repo_dir}/.artifacts/course-reference-qualification.json}"
export COURSE_DB_MIGRATION_PASSWORD COURSE_DB_APP_PASSWORD COURSE_PORT COURSE_PUBLIC_ORIGIN
export COURSE_QUALIFICATION_RUN_ID COURSE_SESSION_HOURS COURSE_EXPIRY_WAIT_MS
export COURSE_OUTBOX_PROCESSING_STALE_SECONDS COURSE_QUALIFICATION_TIMEOUT_ONCE
export COURSE_QUALIFICATION_CRASH_AFTER_ADAPTER_ONCE COURSE_EVIDENCE_PATH
export COMPOSE_PROJECT_NAME="${project_name}"
mkdir -p "${repo_dir}/.artifacts"
restore_database=course_reference_restore

compose() {
  docker compose -f "${project_dir}/compose.yaml" "$@"
}

cleanup() {
  compose exec -T database dropdb -U course_migrator --if-exists "${restore_database}" >/dev/null 2>&1 || true
  compose stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_ready() {
  local timeout_seconds deadline
  timeout_seconds=${1:-180}
  deadline=$((SECONDS + timeout_seconds))
  until curl --fail --silent "${COURSE_PUBLIC_ORIGIN}/readyz" >/dev/null; do
    if (( SECONDS >= deadline )); then
      compose ps
      compose logs app database
      return 1
    fi
    sleep 2
  done
}

compose up --build --detach
wait_ready 180

COURSE_ORIGIN="${COURSE_PUBLIC_ORIGIN}" \
  COURSE_EXPIRY_WAIT_MS="${COURSE_EXPIRY_WAIT_MS}" \
  COURSE_EVIDENCE_PATH="${COURSE_EVIDENCE_PATH}" \
  node "${project_dir}/scripts/qualification.mjs"

app_psql() {
  compose exec -T -e PGPASSWORD="${COURSE_DB_APP_PASSWORD}" database \
    psql -X -qAt -U course_app -d course_reference "$@"
}

COURSE_RLS_UNSCOPED=$(app_psql -c 'SELECT count(*) FROM course.learner_homeworks')
COURSE_RLS_VISIBLE=$(app_psql -c \
  "SELECT set_config('app.user_id', (SELECT id::text FROM course.users ORDER BY created_at LIMIT 1), false);
   SELECT count(*) FROM course.learner_homeworks;" | tail -1)
COURSE_RLS_CROSS_ACCOUNT=$(app_psql -c \
  "SELECT set_config('app.user_id', (SELECT id::text FROM course.users ORDER BY created_at LIMIT 1), false);
   SELECT count(*) FROM course.learner_homeworks
   WHERE user_id = (SELECT id FROM course.users ORDER BY created_at OFFSET 1 LIMIT 1);" | tail -1)
test "${COURSE_RLS_UNSCOPED}" = "0"
test "${COURSE_RLS_VISIBLE}" = "1"
test "${COURSE_RLS_CROSS_ACCOUNT}" = "0"
COURSE_CRASH_ATTEMPTS=$(compose exec -T database psql -X -qAt -U course_migrator \
  -d course_reference -c \
  "SELECT max(attempts) FROM course.command_outbox WHERE command_type = 'provision';")
COURSE_TIMEOUT_ATTEMPTS=$(compose exec -T database psql -X -qAt -U course_migrator \
  -d course_reference -c \
  "SELECT max(attempts) FROM course.command_outbox WHERE command_type = 'run_first_submission';")
test "${COURSE_CRASH_ATTEMPTS}" -ge 2
test "${COURSE_TIMEOUT_ATTEMPTS}" -ge 2

backup_path="${repo_dir}/.artifacts/course-reference-${COURSE_QUALIFICATION_RUN_ID}.dump"
compose exec -T database pg_dump -U course_migrator -d course_reference --format=custom > "${backup_path}"
compose exec -T database dropdb -U course_migrator --if-exists "${restore_database}"
compose exec -T database createdb -U course_migrator "${restore_database}"
compose exec -T database pg_restore -U course_migrator -d "${restore_database}" \
  --no-owner --no-privileges < "${backup_path}"
COURSE_PRIMARY_COUNTS=$(compose exec -T database psql -X -qAt -U course_migrator \
  -d course_reference -c \
  "SELECT concat((SELECT count(*) FROM course.users), ':',
                 (SELECT count(*) FROM course.learner_homeworks), ':',
                 (SELECT count(*) FROM mock_agent_work.works), ':',
                 (SELECT count(*) FROM mock_agent_work.deliveries));")
COURSE_RESTORED_COUNTS=$(compose exec -T database psql -X -qAt -U course_migrator \
  -d "${restore_database}" -c \
  "SELECT concat((SELECT count(*) FROM course.users), ':',
                 (SELECT count(*) FROM course.learner_homeworks), ':',
                 (SELECT count(*) FROM mock_agent_work.works), ':',
                 (SELECT count(*) FROM mock_agent_work.deliveries));")
test "${COURSE_PRIMARY_COUNTS}" = "${COURSE_RESTORED_COUNTS}"
compose exec -T database dropdb -U course_migrator "${restore_database}"

compose restart database
wait_ready 90
compose restart app
wait_ready 90

export COURSE_RLS_UNSCOPED COURSE_RLS_VISIBLE COURSE_RLS_CROSS_ACCOUNT
export COURSE_PRIMARY_COUNTS COURSE_RESTORED_COUNTS
export COURSE_CRASH_ATTEMPTS COURSE_TIMEOUT_ATTEMPTS
node "${project_dir}/scripts/record-infrastructure-qualification.mjs"

compose stop
trap - EXIT
echo "Course reference qualification passed; named volumes were preserved."
