#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock_path="${repo_root}/release/runtime.lock.json"
repo="kungfu-systems/runtime-images"

required_env() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "${value}" ]; then
    echo "${name} is required" >&2
    exit 2
  fi
}

required_env GITHUB_TOKEN
required_env GITHUB_SHA

lock_value() {
  jq -er "$1 | strings | select(length > 0)" "${lock_path}"
}

build_run="$(lock_value '.kungfuBuildRun')"
build_head_sha="$(lock_value '.kungfuBuildHeadSha')"
source_sha="$(lock_value '.kungfuSourceSha')"
package_version="$(lock_value '.kungfuPackageVersion')"
qualification_run="$(lock_value '.packageQualificationRun')"
qualification_artifact="$(lock_value '.packageQualificationArtifact')"
package_release="$(lock_value '.packageRelease')"

case "${qualification_run}" in
  https://github.com/kungfu-systems/runtime-images/actions/runs/[1-9][0-9]*) ;;
  *) echo "invalid package qualification run: ${qualification_run}" >&2; exit 2 ;;
esac
qualification_run_id="${qualification_run##*/}"
expected_artifact="hub-package-input-qualification-${qualification_run_id}"
test "${qualification_artifact}" = "${expected_artifact}"

case "${package_release}" in
  https://github.com/kungfu-systems/runtime-images/releases/tag/*) ;;
  *) echo "invalid package release: ${package_release}" >&2; exit 2 ;;
esac
package_release_tag="${package_release##*/}"

stage_dir="$(mktemp -d)"
release_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${stage_dir}" "${release_dir}"
}
trap cleanup EXIT

GH_TOKEN="${GITHUB_TOKEN}" gh run download "${qualification_run_id}" \
  --repo "${repo}" \
  --pattern "${qualification_artifact}" \
  --dir "${stage_dir}"

one_file() {
  local pattern="$1"
  local matches
  matches="$(find "${stage_dir}" -type f -name "${pattern}" -print)"
  test "$(printf '%s\n' "${matches}" | grep -c .)" -eq 1
  printf '%s' "${matches}"
}

qualification_path="$(one_file qualification.json)"
amd64_path="$(one_file kungfu-episodes-cli-linux-x64.tar.gz)"
arm64_path="$(one_file kungfu-episodes-cli-linux-arm64.tar.gz)"

qualification_value() {
  jq -er "$1 | strings | select(length > 0)" "${qualification_path}"
}

test "$(qualification_value '.buildRun.url')" = "${build_run}"
test "$(qualification_value '.buildRun.headSha')" = "${build_head_sha}"
test "$(qualification_value '.buildRun.sourceSha')" = "${source_sha}"
test "$(qualification_value '.packageVersion')" = "${package_version}"

for platform in linux/amd64 linux/arm64; do
  lock_name="$(jq -er --arg platform "${platform}" '.kungfuPackages[$platform].name' "${lock_path}")"
  lock_sha="$(jq -er --arg platform "${platform}" '.kungfuPackages[$platform].sha256' "${lock_path}")"
  lock_root="$(jq -er --arg platform "${platform}" '.kungfuPackages[$platform].qualificationRoot' "${lock_path}")"
  test "$(jq -er --arg platform "${platform}" '.packages[$platform].name' "${qualification_path}")" = "${lock_name}"
  test "$(jq -er --arg platform "${platform}" '.packages[$platform].sha256' "${qualification_path}")" = "${lock_sha}"
  test "$(jq -er --arg platform "${platform}" '.packages[$platform].qualificationRoot' "${qualification_path}")" = "${lock_root}"
done

test "$(jq -Sc '.kungfuAdmission' "${lock_path}")" = "$(jq -Sc '.admission' "${qualification_path}")"

amd64_sha="$(lock_value '.kungfuPackages["linux/amd64"].sha256')"
arm64_sha="$(lock_value '.kungfuPackages["linux/arm64"].sha256')"
echo "${amd64_sha}  ${amd64_path}" | sha256sum -c -
echo "${arm64_sha}  ${arm64_path}" | sha256sum -c -

if GH_TOKEN="${GITHUB_TOKEN}" gh release view "${package_release_tag}" --repo "${repo}" >/dev/null 2>&1; then
  GH_TOKEN="${GITHUB_TOKEN}" gh release download "${package_release_tag}" \
    --repo "${repo}" \
    --dir "${release_dir}" \
    --clobber \
    --pattern kungfu-episodes-cli-linux-x64.tar.gz \
    --pattern kungfu-episodes-cli-linux-arm64.tar.gz
else
  GH_TOKEN="${GITHUB_TOKEN}" gh release create "${package_release_tag}" \
    --repo "${repo}" \
    --target "${GITHUB_SHA}" \
    --prerelease \
    --title "Kungfu runtime input ${source_sha:0:12} Build ${build_run##*/}" \
    --notes "Exact linux/amd64 and linux/arm64 Kungfu ${package_version} package inputs qualified from one successful Build run and its publication admission capsule." \
    "${amd64_path}" \
    "${arm64_path}"
  cp "${amd64_path}" "${release_dir}/kungfu-episodes-cli-linux-x64.tar.gz"
  cp "${arm64_path}" "${release_dir}/kungfu-episodes-cli-linux-arm64.tar.gz"
fi

echo "${amd64_sha}  ${release_dir}/kungfu-episodes-cli-linux-x64.tar.gz" | sha256sum -c -
echo "${arm64_sha}  ${release_dir}/kungfu-episodes-cli-linux-arm64.tar.gz" | sha256sum -c -
GH_TOKEN="${GITHUB_TOKEN}" gh release view "${package_release_tag}" --repo "${repo}" \
  --json isPrerelease,url \
  --jq 'select(.isPrerelease == true and .url == "'"${package_release}"'") | .url'
