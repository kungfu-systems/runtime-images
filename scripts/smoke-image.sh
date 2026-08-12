#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

image_ref=${1:?usage: smoke-image.sh IMAGE_REF EVIDENCE_PATH}
evidence_path=${2:?usage: smoke-image.sh IMAGE_REF EVIDENCE_PATH}
run_key=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$
prefix="kungfu-course-hub-smoke-${run_key}"
network="${prefix}-network"
database="${prefix}-database"
hub="${prefix}-hub"
database_volume="${prefix}-postgres"
state_volume="${prefix}-state"
model_volume="${prefix}-models"
port=${COURSE_SMOKE_PORT:-18081}
migration_password=synthetic_migration_password_42
app_password=synthetic_application_password_42
state_path="${evidence_path%.json}-state.json"
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

cleanup() {
  local exit_status=$?
  if [ "${exit_status}" -ne 0 ]; then
    echo "Course Hub smoke failed; capturing container logs before cleanup" >&2
    docker logs "${hub}" >&2 || true
    docker logs "${database}" >&2 || true
  fi
  docker rm -f "${hub}" "${database}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  return "${exit_status}"
}
trap cleanup EXIT

mkdir -p "$(dirname "${evidence_path}")"
docker network create "${network}" >/dev/null
docker volume create "${database_volume}" >/dev/null
docker volume create "${state_volume}" >/dev/null
docker volume create "${model_volume}" >/dev/null

docker run -d \
  --name "${database}" \
  --network "${network}" \
  --user postgres \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=volume,src=${database_volume},dst=/var/lib/postgresql/data" \
  --env POSTGRES_DB=course_reference \
  --env POSTGRES_USER=course_migrator \
  --env "POSTGRES_PASSWORD=${migration_password}" \
  postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3 \
  >/dev/null

database_deadline=$((SECONDS + 180))
database_ready_count=0
until (( database_ready_count >= 5 )); do
  if docker exec "${database}" pg_isready -h 127.0.0.1 -U course_migrator -d course_reference >/dev/null 2>&1; then
    database_ready_count=$((database_ready_count + 1))
  else
    database_ready_count=0
  fi
  if (( SECONDS >= database_deadline )); then
    docker logs "${database}" || true
    echo "PostgreSQL did not remain ready across initialization" >&2
    exit 1
  fi
  sleep 1
done

docker run -d \
  --name "${hub}" \
  --network "${network}" \
  --read-only \
  --user node \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
  --mount "type=volume,src=${state_volume},dst=/state" \
  --mount "type=volume,src=${model_volume},dst=/models" \
  --publish "127.0.0.1:${port}:8080" \
  --env "PUBLIC_ORIGIN=http://127.0.0.1:${port}" \
  --env "DATABASE_URL=postgresql://course_migrator:${migration_password}@${database}:5432/course_reference" \
  --env "APP_DATABASE_URL=postgresql://course_app:${app_password}@${database}:5432/course_reference" \
  --env "COURSE_DB_APP_PASSWORD=${app_password}" \
  --env AGENT_WORK_BACKEND=mock \
  "${image_ref}" >/dev/null

wait_ready() {
  local deadline=$((SECONDS + 300))
  until curl --fail --silent "http://127.0.0.1:${port}/readyz" >/dev/null; do
    if (( SECONDS >= deadline )); then
      docker logs "${hub}" || true
      echo "Course Hub did not become ready within five minutes" >&2
      return 1
    fi
    sleep 2
  done
}

wait_ready
COURSE_ORIGIN="http://127.0.0.1:${port}" \
COURSE_SMOKE_RUN_KEY="${run_key}" \
IMAGE_REF="${image_ref}" \
  node "${script_dir}/smoke-course-api.mjs" initial "${state_path}" "${evidence_path}"

docker restart "${hub}" >/dev/null
wait_ready
COURSE_ORIGIN="http://127.0.0.1:${port}" \
  node "${script_dir}/smoke-course-api.mjs" verify "${state_path}" "${evidence_path}"

test "$(docker inspect --format '{{.Config.User}}' "${hub}")" = node
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "${hub}")" = true
test "$(docker inspect --format '{{.HostConfig.Privileged}}' "${hub}")" = false
test "$(docker inspect --format '{{json .HostConfig.CapAdd}}' "${hub}")" = null
jq '.security={nonRoot:true,readOnlyRoot:true,privileged:false,capabilityAdditions:false}
    | .retainedVolumes=[$databaseVolume,$stateVolume,$modelVolume]' \
  --arg databaseVolume "${database_volume}" \
  --arg stateVolume "${state_volume}" \
  --arg modelVolume "${model_volume}" \
  "${evidence_path}" >"${evidence_path}.tmp"
mv "${evidence_path}.tmp" "${evidence_path}"

echo "[smoke] account isolation, PostgreSQL persistence, Kungfu Evidence/review/seal, restart, and runtime security passed; named volumes retained"
