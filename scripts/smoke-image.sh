#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

image_ref=${1:?usage: smoke-image.sh IMAGE_REF EVIDENCE_PATH}
evidence_path=${2:?usage: smoke-image.sh IMAGE_REF EVIDENCE_PATH}
run_key=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}
prefix="kungfu-hub-smoke-${run_key}"
network="${prefix}-network"
container_a="${prefix}-a"
container_b="${prefix}-b"
volume_a="${prefix}-a-state"
volume_b="${prefix}-b-state"
port_a=18081
port_b=18082

cleanup() {
  docker rm -f "${container_a}" "${container_b}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  docker volume rm "${volume_a}" "${volume_b}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal "${network}" >/dev/null
docker volume create "${volume_a}" >/dev/null
docker volume create "${volume_b}" >/dev/null

start_instance() {
  local name=$1
  local volume=$2
  local port=$3
  local label=$4
  docker run -d \
    --name "${name}" \
    --network "${network}" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
    --mount "type=volume,src=${volume},dst=/state" \
    --publish "127.0.0.1:${port}:8080" \
    --env "HUB_INSTANCE_LABEL=${label}" \
    "${image_ref}" >/dev/null
}

start_instance "${container_a}" "${volume_a}" "${port_a}" a
start_instance "${container_b}" "${volume_b}" "${port_b}" b

wait_ready() {
  local port=$1
  local deadline=$((SECONDS + 300))
  until curl --fail --silent "http://127.0.0.1:${port}/healthz" >/dev/null; do
    if (( SECONDS >= deadline )); then
      docker logs "${container_a}" || true
      docker logs "${container_b}" || true
      echo "Hub Starter did not become ready within five minutes" >&2
      return 1
    fi
    sleep 2
  done
}

wait_ready "${port_a}"
wait_ready "${port_b}"

state_a=$(curl --fail --silent "http://127.0.0.1:${port_a}/api/state")
state_b=$(curl --fail --silent "http://127.0.0.1:${port_b}/api/state")
identity_a=$(jq -r '.instance.instanceId' <<<"${state_a}")
identity_b=$(jq -r '.instance.instanceId' <<<"${state_b}")
assignment_a=$(jq -r '.assignment.assignment_id' <<<"${state_a}")
assignment_b=$(jq -r '.assignment.assignment_id' <<<"${state_b}")
test -n "${identity_a}"
test -n "${identity_b}"
test "${identity_a}" != "${identity_b}"
test "${assignment_a}" != "${assignment_b}"

settlement=$(curl --fail --silent --request POST "http://127.0.0.1:${port_a}/api/settle")
jq -e '.stateRoot | startswith("sha256:")' <<<"${settlement}" >/dev/null

docker restart "${container_a}" >/dev/null
wait_ready "${port_a}"
restarted_a=$(curl --fail --silent "http://127.0.0.1:${port_a}/api/state")
test "$(jq -r '.instance.instanceId' <<<"${restarted_a}")" = "${identity_a}"
jq -e '.settlement.stateRoot | startswith("sha256:")' <<<"${restarted_a}" >/dev/null

test "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${port_b}/api/tenants/${identity_a}")" = 404
test "$(docker inspect --format '{{.Config.User}}' "${container_a}")" = node
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "${container_a}")" = true
test "$(docker inspect --format '{{.HostConfig.Privileged}}' "${container_a}")" = false
test "$(docker inspect --format '{{json .HostConfig.CapAdd}}' "${container_a}")" = null

mkdir -p "$(dirname "${evidence_path}")"
jq -n \
  --arg schema 'kungfu.hub-starter.image-smoke/v1' \
  --arg image "${image_ref}" \
  --arg instanceA "${identity_a}" \
  --arg instanceB "${identity_b}" \
  --arg assignmentA "${assignment_a}" \
  --arg assignmentB "${assignment_b}" \
  --arg stateRoot "$(jq -r '.stateRoot' <<<"${settlement}")" \
  '{schema:$schema,image:$image,instances:[{id:$instanceA,assignment:$assignmentA},{id:$instanceB,assignment:$assignmentB}],restartIdentityStable:true,crossTenantReadRejected:true,security:{nonRoot:true,readOnlyRoot:true,privileged:false,capabilityAdditions:false},settlementStateRoot:$stateRoot}' \
  >"${evidence_path}"

echo "[smoke] two-instance isolation, restart persistence, settlement, and runtime security passed"
