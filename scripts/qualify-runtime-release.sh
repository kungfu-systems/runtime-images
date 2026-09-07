#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Read-only qualification of an already published immutable OCI family.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
evidence_dir="${repo_root}/.artifacts/public-release"
node "${repo_root}/scripts/release-qualification.mjs" prepare
context="${evidence_dir}/context.json"
image_name="ghcr.io/kungfu-systems/runtime-images/hub-starter"
image_digest="$(jq -er .imageDigest "${context}")"
application_digest="$(jq -er .applicationDigest "${context}")"
image_ref="${image_name}@${image_digest}"
application_ref="${image_name}@${application_digest}"
preview_ref="${image_name}:compose-preview"
previous_preview_digest="$(jq -er .previousDigest "${context}")"
release_material_sha="$(jq -er .candidateSourceSha "${context}")"
kungfu_source_sha="$(jq -er .kungfuSourceSha "${context}")"
image_manifest_path="${evidence_dir}/hub-image-manifest.json"
application_config_path="${evidence_dir}/hub-application-config.yaml"
application_smoke_path="${evidence_dir}/hub-application-readiness.json"
application_fresh_state_path="${evidence_dir}/hub-application-fresh-install-state.json"
application_fresh_path="${evidence_dir}/hub-application-fresh-install.json"
application_upgrade_state_path="${evidence_dir}/hub-application-upgrade-state.json"
application_upgrade_path="${evidence_dir}/hub-application-upgrade.json"

verify_image_contract() {
  local image_coordinate="$1"
  local expected_architecture="$2"
  local observed_architecture
  local observed_revision
  local observed_kungfu_source

  docker pull "${image_coordinate}" >/dev/null
  observed_architecture="$(docker image inspect --format '{{.Architecture}}' "${image_coordinate}")"
  observed_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${image_coordinate}")"
  observed_kungfu_source="$(docker image inspect --format '{{index .Config.Labels "tech.kungfu.product.source"}}' "${image_coordinate}")"
  test "${observed_architecture}" = "${expected_architecture}"
  test "${observed_revision}" = "${release_material_sha}"
  test "${observed_kungfu_source}" = "${kungfu_source_sha}"
}

docker buildx imagetools inspect "${image_ref}" --format '{{json .Manifest}}' \
  >"${image_manifest_path}"
platform_digest() {
  local architecture="$1"
  jq -er \
    --arg architecture "${architecture}" \
    '[.manifests[]
      | select(.platform.os == "linux" and .platform.architecture == $architecture)
      | .digest]
     | if length == 1 then .[0] else error("expected one platform manifest") end' \
    "${image_manifest_path}"
}
image_digest_amd64="$(platform_digest amd64)"
image_digest_arm64="$(platform_digest arm64)"
verify_image_contract "${image_name}@${image_digest_amd64}" amd64
verify_image_contract "${image_name}@${image_digest_arm64}" arm64

COURSE_SMOKE_PORT=18081 \
  bash "${repo_root}/scripts/smoke-image.sh" \
    "${image_name}@${image_digest_amd64}" \
    "${evidence_dir}/hub-image-smoke-linux-amd64.json"

arm64_image="${image_name}@${image_digest_arm64}"
arm64_node_architecture="$(
  docker run --rm \
    --read-only \
    --user node \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
    --entrypoint node \
    "${arm64_image}" \
    -e 'process.stdout.write(process.arch)'
)"
test "${arm64_node_architecture}" = arm64
docker run --rm \
  --read-only \
  --user node \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
  --entrypoint /opt/kungfu/kungfu \
  "${arm64_image}" \
  agent verify --json \
  >"${evidence_dir}/hub-image-smoke-linux-arm64-agent.json"
jq -e '.ok == true' "${evidence_dir}/hub-image-smoke-linux-arm64-agent.json" >/dev/null
COURSE_SMOKE_PORT=18082 \
COURSE_SMOKE_MODE=platform \
  bash "${repo_root}/scripts/smoke-image.sh" \
    "${arm64_image}" \
    "${evidence_dir}/hub-image-smoke-linux-arm64.json"
jq \
  --arg architecture "${arm64_node_architecture}" \
  --arg agentEvidence 'hub-image-smoke-linux-arm64-agent.json' \
  '.platform = "linux/arm64"
    | .nodeArchitecture = $architecture
    | .kungfuAgentVerified = true
    | .policy = "qemu-platform-contract"
    | .agentEvidence = $agentEvidence' \
  "${evidence_dir}/hub-image-smoke-linux-arm64.json" \
  >"${evidence_dir}/hub-image-smoke-linux-arm64.json.tmp"
mv \
  "${evidence_dir}/hub-image-smoke-linux-arm64.json.tmp" \
  "${evidence_dir}/hub-image-smoke-linux-arm64.json"
jq -e '.freshInstall == true and .restartPersistence == true and .courseApiContract == true' \
  "${evidence_dir}/hub-image-smoke-linux-arm64.json" >/dev/null

compose_oci() {
  local reference="$1"
  shift
  set +o pipefail
  yes | docker compose -f "oci://${reference}" "$@"
  local status=${PIPESTATUS[1]}
  set -o pipefail
  return "${status}"
}

compose_config_has_exact_image() {
  local config_path="$1"
  local digest

  for digest in "${image_digest}" "${image_digest_amd64}" "${image_digest_arm64}"; do
    if grep -Fq "image: ${image_name}@${digest}" "${config_path}"; then
      return 0
    fi
  done

  return 1
}

compose_config_with_retry() {
  local reference="$1"
  local output_path="$2"
  local attempt=1
  local max_attempts=12
  local status=1

  while [ "${attempt}" -le "${max_attempts}" ]; do
    if compose_oci "${reference}" config >"${output_path}" \
      && compose_config_has_exact_image "${output_path}" \
      && grep -Fq 'host_ip: 127.0.0.1' "${output_path}"; then
      return 0
    else
      status=$?
    fi
    if [ "${attempt}" -eq "${max_attempts}" ]; then
      break
    fi
    echo "Compose application ${reference} is not readable yet; retrying (${attempt}/${max_attempts})" >&2
    sleep 5
    attempt=$((attempt + 1))
  done

  return "${status}"
}

compose_up_with_retry() {
  local reference="$1"
  local project="$2"
  local port="$3"
  local attempt=1
  local max_attempts=3
  local status=1

  while [ "${attempt}" -le "${max_attempts}" ]; do
    if COMPOSE_PROJECT_NAME="${project}" HUB_PORT="${port}" \
      compose_oci "${reference}" up --pull always --wait --wait-timeout 300; then
      return 0
    else
      status=$?
    fi
    if [ "${attempt}" -eq "${max_attempts}" ]; then
      break
    fi
    echo "Compose application ${reference} did not become ready; retrying (${attempt}/${max_attempts})" >&2
    sleep 10
    attempt=$((attempt + 1))
  done

  return "${status}"
}

compose_config_with_retry "${application_ref}" "${application_config_path}"
compose_config_has_exact_image "${application_config_path}"
grep -F 'host_ip: 127.0.0.1' "${application_config_path}"
if sed -n '/^  database:/,/^  hub:/p' "${application_config_path}" | grep -q '^    ports:'; then
  echo "published Compose application exposes PostgreSQL" >&2
  exit 1
fi

smoke_project="kungfu-course-hub-release-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup_application() {
  COMPOSE_PROJECT_NAME="${smoke_project}" HUB_PORT=18083 \
    compose_oci "${application_ref}" down >/dev/null 2>&1 || true
}
upgrade_project="${smoke_project}-upgrade"
cleanup_upgrade_application() {
  COMPOSE_PROJECT_NAME="${upgrade_project}" HUB_PORT=18084 \
    compose_oci "${application_ref}" down >/dev/null 2>&1 || true
  if [ "${previous_preview_digest}" != none ]; then
    COMPOSE_PROJECT_NAME="${upgrade_project}" HUB_PORT=18084 \
      compose_oci "${preview_ref}@${previous_preview_digest}" down >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_upgrade_application; cleanup_application' EXIT
compose_up_with_retry "${application_ref}" "${smoke_project}" 18083
curl --fail --silent http://127.0.0.1:18083/readyz >"${application_smoke_path}"
jq -e '.ready == true and .database == "ready" and .inference == "ready"' \
  "${application_smoke_path}" >/dev/null
COMPOSE_PROJECT_NAME="${smoke_project}" \
  compose_oci "${application_ref}" exec -T hub kungfu agent verify --json \
  | jq -e '.ok == true' >/dev/null
COURSE_ORIGIN=http://127.0.0.1:18083 \
COURSE_SMOKE_RUN_KEY="fresh-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}" \
IMAGE_REF="${application_ref}" \
  node "${repo_root}/scripts/smoke-course-api.mjs" \
    initial "${application_fresh_state_path}" "${application_fresh_path}"
jq -e '.freshInstall == true' "${application_fresh_path}" >/dev/null
database_id="$(COMPOSE_PROJECT_NAME="${smoke_project}" compose_oci "${application_ref}" ps -q database)"
test -n "${database_id}"
docker inspect "${database_id}" \
  | jq -e '.[0].NetworkSettings.Ports["5432/tcp"] == null' >/dev/null
cleanup_application

if [ "${previous_preview_digest}" != none ]; then
  previous_preview_exact="${preview_ref}@${previous_preview_digest}"
  compose_up_with_retry "${previous_preview_exact}" "${upgrade_project}" 18084
  upgrade_database_id_before="$(
    COMPOSE_PROJECT_NAME="${upgrade_project}" compose_oci "${previous_preview_exact}" ps -q database
  )"
  test -n "${upgrade_database_id_before}"
  COURSE_ORIGIN=http://127.0.0.1:18084 \
  COURSE_SMOKE_RUN_KEY="upgrade-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}" \
  IMAGE_REF="${previous_preview_exact}" \
    node "${repo_root}/scripts/smoke-course-api.mjs" \
      initial "${application_upgrade_state_path}" "${application_upgrade_path}"

  compose_up_with_retry "${application_ref}" "${upgrade_project}" 18084
  upgrade_database_id_after="$(
    COMPOSE_PROJECT_NAME="${upgrade_project}" compose_oci "${application_ref}" ps -q database
  )"
  test "${upgrade_database_id_after}" = "${upgrade_database_id_before}"
  COURSE_ORIGIN=http://127.0.0.1:18084 \
  COURSE_SMOKE_PHASE=upgrade \
  IMAGE_REF="${application_ref}" \
    node "${repo_root}/scripts/smoke-course-api.mjs" \
      verify "${application_upgrade_state_path}" "${application_upgrade_path}"
  jq -e '.upgradePersistence == true' "${application_upgrade_path}" >/dev/null

  compose_up_with_retry "${previous_preview_exact}" "${upgrade_project}" 18084
  rollback_database_id="$(
    COMPOSE_PROJECT_NAME="${upgrade_project}" compose_oci "${previous_preview_exact}" ps -q database
  )"
  test "${rollback_database_id}" = "${upgrade_database_id_before}"
  COURSE_ORIGIN=http://127.0.0.1:18084 \
  COURSE_SMOKE_PHASE=rollback \
  IMAGE_REF="${previous_preview_exact}" \
    node "${repo_root}/scripts/smoke-course-api.mjs" \
      verify "${application_upgrade_state_path}" "${application_upgrade_path}"
  jq -e '.upgradePersistence == true and .rollbackPersistence == true' \
    "${application_upgrade_path}" >/dev/null
  cleanup_upgrade_application
else
  echo "previous immutable preview is required for upgrade and rollback qualification" >&2
  exit 1
fi

node "${repo_root}/scripts/release-qualification.mjs" finish
