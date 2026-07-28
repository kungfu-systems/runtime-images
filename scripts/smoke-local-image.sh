#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

image_ref=${1:?usage: smoke-local-image.sh IMAGE_REF SEED_VOLUME EVIDENCE_PATH}
seed_volume=${2:?usage: smoke-local-image.sh IMAGE_REF SEED_VOLUME EVIDENCE_PATH}
evidence_path=${3:?usage: smoke-local-image.sh IMAGE_REF SEED_VOLUME EVIDENCE_PATH}
run_key=${GITHUB_RUN_ID:-local-model}-${GITHUB_RUN_ATTEMPT:-1}-$$
prefix="kungfu-course-hub-local-smoke-${run_key}"
network="${prefix}-network"
database="${prefix}-database"
hub="${prefix}-hub"
database_volume="${prefix}-postgres"
state_volume="${prefix}-state"
model_volume="${prefix}-models"
port=${COURSE_SMOKE_PORT:-18083}
migration_password=synthetic_local_migration_password_42
app_password=synthetic_local_application_password_42
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

cleanup() {
  docker rm -f "${hub}" "${database}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
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
  --mount "type=volume,src=${seed_volume},dst=/seed,readonly" \
  --publish "127.0.0.1:${port}:8080" \
  --env "PUBLIC_ORIGIN=http://127.0.0.1:${port}" \
  --env "DATABASE_URL=postgresql://course_migrator:${migration_password}@${database}:5432/course_reference" \
  --env "APP_DATABASE_URL=postgresql://course_app:${app_password}@${database}:5432/course_reference" \
  --env "COURSE_DB_APP_PASSWORD=${app_password}" \
  --env AGENT_WORK_BACKEND=mock \
  --env COURSE_LOCAL_MODEL_SEED_ROOT=/seed \
  "${image_ref}" >/dev/null

hub_deadline=$((SECONDS + 300))
until curl --fail --silent "http://127.0.0.1:${port}/readyz" >/dev/null; do
  if (( SECONDS >= hub_deadline )); then
    docker logs "${hub}" || true
    echo "Course Hub did not become ready within five minutes" >&2
    exit 1
  fi
  sleep 2
done

COURSE_ORIGIN="http://127.0.0.1:${port}" \
COURSE_SMOKE_RUN_KEY="${run_key}" \
  node "${script_dir}/smoke-local-model.mjs" >"${evidence_path}"

test "$(docker inspect --format '{{.Config.User}}' "${hub}")" = node
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "${hub}")" = true

echo "[smoke] explicit model install, local generation, provenance, and Kungfu settlement passed; named volumes retained"
