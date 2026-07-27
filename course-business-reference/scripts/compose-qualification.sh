#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "${script_dir}/.." && pwd)
repo_dir=$(CDPATH= cd -- "${project_dir}/.." && pwd)
project_name=${COMPOSE_PROJECT_NAME:-kungfu-course-reference-qualification}

: "${COURSE_DB_MIGRATION_PASSWORD:=synthetic_migration_42}"
: "${COURSE_DB_APP_PASSWORD:=synthetic_runtime_42}"
: "${COURSE_PORT:=18090}"
: "${COURSE_PUBLIC_ORIGIN:=http://127.0.0.1:${COURSE_PORT}}"
export COURSE_DB_MIGRATION_PASSWORD COURSE_DB_APP_PASSWORD COURSE_PORT COURSE_PUBLIC_ORIGIN
export COMPOSE_PROJECT_NAME="${project_name}"
mkdir -p "${repo_dir}/.artifacts"

compose() {
  docker compose -f "${project_dir}/compose.yaml" "$@"
}

cleanup() {
  compose stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

compose up --build --detach
deadline=$((SECONDS + 180))
until curl --fail --silent "${COURSE_PUBLIC_ORIGIN}/readyz" >/dev/null; do
  if (( SECONDS >= deadline )); then
    compose ps
    compose logs app database
    exit 1
  fi
  sleep 2
done

COURSE_ORIGIN="${COURSE_PUBLIC_ORIGIN}" \
  COURSE_EVIDENCE_PATH="${COURSE_EVIDENCE_PATH:-${repo_dir}/.artifacts/course-reference-qualification.json}" \
  node "${project_dir}/scripts/qualification.mjs"

compose restart app
deadline=$((SECONDS + 90))
until curl --fail --silent "${COURSE_PUBLIC_ORIGIN}/readyz" >/dev/null; do
  if (( SECONDS >= deadline )); then
    compose logs app
    exit 1
  fi
  sleep 2
done
compose stop
trap - EXIT
echo "Course reference qualification passed; named volumes were preserved."
