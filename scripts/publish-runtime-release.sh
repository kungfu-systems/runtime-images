#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_env() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "${value}" ]; then
    echo "${name} is required" >&2
    exit 2
  fi
}

for name in \
  BUILDCHAIN_VERSION \
  BUILDCHAIN_CHANNEL \
  BUILDCHAIN_SOURCE_SHA \
  BUILDCHAIN_RELEASE_SHA \
  BUILDCHAIN_TARGET_REF \
  BUILDCHAIN_PUBLISH_EVIDENCE \
  BUILDCHAIN_REQUIRED_ARTIFACTS; do
  required_env "${name}"
done

case "${BUILDCHAIN_CHANNEL}" in
  alpha|release|stable) ;;
  *)
    echo "unsupported Buildchain publish channel: ${BUILDCHAIN_CHANNEL}" >&2
    exit 2
    ;;
esac

image_name="ghcr.io/kungfu-systems/runtime-images/hub-starter"
image_ref="${image_name}:v${BUILDCHAIN_VERSION}"
application_ref="${image_name}:compose-v${BUILDCHAIN_VERSION}"
preview_ref="${image_name}:compose-preview"
release_material_sha="${BUILDCHAIN_RELEASE_MATERIAL_SHA:-${BUILDCHAIN_RELEASE_SHA}}"
evidence_dir="${BUILDCHAIN_EVIDENCE_DIR:-$(dirname "${BUILDCHAIN_PUBLISH_EVIDENCE}")}"
input_dir="${evidence_dir}/runtime-inputs"
image_manifest_path="${evidence_dir}/hub-image-manifest.json"
application_config_path="${evidence_dir}/hub-application-config.yaml"
application_source_path="${evidence_dir}/hub-application-source.yaml"
application_smoke_path="${evidence_dir}/hub-application-readiness.json"

mkdir -p "${input_dir}"

lock_value() {
  node -e '
    const fs = require("node:fs");
    const value = process.argv[1].split(".").reduce((current, key) => current?.[key], JSON.parse(fs.readFileSync(process.argv[2])));
    if (typeof value !== "string" || !value) process.exit(1);
    process.stdout.write(value);
  ' "$1" "${repo_root}/release/runtime.lock.json"
}

package_release="$(lock_value packageRelease)"
package_sha_amd64="$(lock_value kungfuPackages.linux/amd64.sha256)"
package_sha_arm64="$(lock_value kungfuPackages.linux/arm64.sha256)"
package_version="$(lock_value kungfuPackageVersion)"
kungfu_source_sha="$(lock_value kungfuSourceSha)"
package_release_tag="${package_release##*/}"
package_amd64="kungfu-episodes-cli-linux-x64.tar.gz"
package_arm64="kungfu-episodes-cli-linux-arm64.tar.gz"

download_args=(
  release download "${package_release_tag}"
  --repo kungfu-systems/runtime-images
  --dir "${input_dir}"
  --clobber
  --pattern "${package_amd64}"
  --pattern "${package_arm64}"
)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  GH_TOKEN="${GITHUB_TOKEN}" gh "${download_args[@]}"
else
  gh "${download_args[@]}"
fi

echo "${package_sha_amd64}  ${input_dir}/${package_amd64}" | sha256sum -c -
echo "${package_sha_arm64}  ${input_dir}/${package_arm64}" | sha256sum -c -
cp "${input_dir}/${package_amd64}" "${repo_root}/${package_amd64}"
cp "${input_dir}/${package_arm64}" "${repo_root}/${package_arm64}"

cleanup_inputs() {
  rm -f "${repo_root}/${package_amd64}" "${repo_root}/${package_arm64}"
}
trap cleanup_inputs EXIT

manifest_digest() {
  docker buildx imagetools inspect "$1" --format '{{.Manifest.Digest}}'
}

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

if docker buildx imagetools inspect "${image_ref}" >/dev/null 2>&1; then
  echo "Reusing existing exact image ${image_ref}"
else
  docker buildx build \
    --file "${repo_root}/Dockerfile" \
    --platform linux/amd64,linux/arm64 \
    --push \
    --provenance mode=max \
    --sbom=true \
    --tag "${image_ref}" \
    --build-arg "KUNGFU_PACKAGE_SHA256_AMD64=${package_sha_amd64}" \
    --build-arg "KUNGFU_PACKAGE_SHA256_ARM64=${package_sha_arm64}" \
    --build-arg "KUNGFU_PACKAGE_VERSION=${package_version}" \
    --build-arg "KUNGFU_SOURCE_SHA=${kungfu_source_sha}" \
    --build-arg "SOURCE_REVISION=${release_material_sha}" \
    "${repo_root}"
fi

image_digest="$(manifest_digest "${image_ref}")"
[[ "${image_digest}" =~ ^sha256:[0-9a-f]{64}$ ]]
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
jq -n \
  --arg schema 'kungfu.course-hub.platform-smoke/v1' \
  --arg image "${arm64_image}" \
  --arg architecture "${arm64_node_architecture}" \
  --arg agentEvidence 'hub-image-smoke-linux-arm64-agent.json' \
  '{
    schema: $schema,
    image: $image,
    platform: "linux/arm64",
    nodeArchitecture: $architecture,
    kungfuAgentVerified: true,
    security: {
      nonRoot: true,
      readOnlyRoot: true,
      capabilityAdditions: false,
      noNewPrivileges: true
    },
    policy: "qemu-runtime-contract",
    evidence: $agentEvidence
  }' \
  >"${evidence_dir}/hub-image-smoke-linux-arm64.json"

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

if docker buildx imagetools inspect "${application_ref}" >/dev/null 2>&1; then
  echo "Reusing existing exact Compose application ${application_ref}"
  compose_config_with_retry "${application_ref}" "${application_config_path}"
else
  KUNGFU_HUB_IMAGE="${image_name}@${image_digest}" \
    docker compose -f "${repo_root}/compose.yaml" config >"${application_source_path}"
  compose_config_has_exact_image "${application_source_path}"
  grep -Fq 'host_ip: 127.0.0.1' "${application_source_path}"
  docker compose -f "${application_source_path}" publish -y "${application_ref}"
  compose_config_with_retry "${application_ref}" "${application_config_path}"
fi

compose_config_has_exact_image "${application_config_path}"
grep -F 'host_ip: 127.0.0.1' "${application_config_path}"
if sed -n '/^  database:/,/^  hub:/p' "${application_config_path}" | grep -q '^    ports:'; then
  echo "published Compose application exposes PostgreSQL" >&2
  exit 1
fi

application_digest="$(manifest_digest "${application_ref}")"
[[ "${application_digest}" =~ ^sha256:[0-9a-f]{64}$ ]]

smoke_project="kungfu-course-hub-release-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup_application() {
  COMPOSE_PROJECT_NAME="${smoke_project}" HUB_PORT=18083 \
    compose_oci "${application_ref}" down >/dev/null 2>&1 || true
}
trap 'cleanup_application; cleanup_inputs' EXIT
COMPOSE_PROJECT_NAME="${smoke_project}" HUB_PORT=18083 \
  compose_oci "${application_ref}" up --wait --wait-timeout 300
curl --fail --silent http://127.0.0.1:18083/readyz >"${application_smoke_path}"
jq -e '.ready == true and .database == "ready" and .inference == "ready"' \
  "${application_smoke_path}" >/dev/null
COMPOSE_PROJECT_NAME="${smoke_project}" \
  compose_oci "${application_ref}" exec -T hub kungfu agent verify --json \
  | jq -e '.ok == true' >/dev/null
database_id="$(COMPOSE_PROJECT_NAME="${smoke_project}" compose_oci "${application_ref}" ps -q database)"
test -n "${database_id}"
docker inspect "${database_id}" \
  | jq -e '.[0].NetworkSettings.Ports["5432/tcp"] == null' >/dev/null
cleanup_application

HUB_IMAGE_DIGEST="${image_digest}" \
HUB_APPLICATION_DIGEST="${application_digest}" \
  node "${repo_root}/scripts/write-runtime-publish-evidence.mjs"

previous_preview_digest=none
if observed="$(manifest_digest "${preview_ref}" 2>/dev/null)"; then
  previous_preview_digest="${observed}"
fi
docker buildx imagetools create \
  --prefer-index=false \
  --tag "${preview_ref}" \
  "${application_ref}"
promoted_preview_digest="$(manifest_digest "${preview_ref}")"
test "${promoted_preview_digest}" = "${application_digest}"

{
  echo "image=${image_ref}@${image_digest}"
  echo "application=${application_ref}@${application_digest}"
  echo "preview=${preview_ref}@${promoted_preview_digest}"
  echo "previous_preview_digest=${previous_preview_digest}"
  echo "publish_evidence=${BUILDCHAIN_PUBLISH_EVIDENCE}"
}
