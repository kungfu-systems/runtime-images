#!/bin/bash
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

base_url="${1:-http://127.0.0.1:8080}"
artifact_dir="${2:-.artifacts/browser-smoke}"

if [[ -n "${CHROME_BIN:-}" && -x "${CHROME_BIN}" ]]; then
  chrome_bin="${CHROME_BIN}"
elif command -v google-chrome >/dev/null 2>&1; then
  chrome_bin="$(command -v google-chrome)"
elif command -v chromium >/dev/null 2>&1; then
  chrome_bin="$(command -v chromium)"
elif [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  chrome_bin="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
  echo "browser smoke requires Chrome or Chromium; set CHROME_BIN explicitly" >&2
  exit 69
fi

mkdir -p "${artifact_dir}"
profile_dir="$(mktemp -d "${TMPDIR:-/tmp}/kungfu-hub-browser.XXXXXX")"

render() {
  state="$1"
  expected="$2"
  html_path="${artifact_dir}/${state}.html"
  png_path="${artifact_dir}/${state}.png"
  "${chrome_bin}" \
    --headless=new \
    --disable-gpu \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="${profile_dir}" \
    --virtual-time-budget=8000 \
    --dump-dom \
    "${base_url}" >"${html_path}"
  grep -F "${expected}" "${html_path}" >/dev/null
  "${chrome_bin}" \
    --headless=new \
    --disable-gpu \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="${profile_dir}" \
    --virtual-time-budget=8000 \
    --window-size=1440,1100 \
    --screenshot="${png_path}" \
    "${base_url}" >/dev/null
  test -s "${png_path}"
}

render ready "Ready for the Agent"
curl --fail --silent --request POST "${base_url}/api/coursework/claim" \
  >"${artifact_dir}/claim.json"
node -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1])); if(v.coursework?.outcome?.state!=="needs-evidence"||v.coursework?.independentCheck?.verdict!=="insufficient"||v.settlement!==null) process.exit(1)' \
  "${artifact_dir}/claim.json"
render needs-evidence "Evidence needed"
curl --fail --silent --request POST "${base_url}/api/coursework/evidence" \
  >"${artifact_dir}/evidence.json"
node -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1])); if(v.coursework?.outcome?.state!=="accepted"||v.coursework?.independentCheck?.verdict!=="fit"||v.assignment?.phase!=="continuation-decided"||!v.settlement?.stateRoot?.startsWith("sha256:")) process.exit(1)' \
  "${artifact_dir}/evidence.json"
render accepted "Homework accepted"

node -e 'const fs=require("node:fs"); const path=require("node:path"); const root=process.argv[1]; const evidence=JSON.parse(fs.readFileSync(path.join(root,"evidence.json"))); process.stdout.write(`${JSON.stringify({schema:"kungfu.hub-starter.browser-smoke/v1",outcome:evidence.coursework.outcome.state,verdict:evidence.coursework.independentCheck.verdict,stateRoot:evidence.settlement.stateRoot,screenshots:["ready.png","needs-evidence.png","accepted.png"]},null,2)}\n`)' \
  "${artifact_dir}" >"${artifact_dir}/browser-smoke.json"
