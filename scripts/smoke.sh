#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
[[ ${SCENARIO:-http-basic} == http-basic ]] || { printf '%s\n' 'Only http-basic is implemented in phase 1.' >&2; exit 2; }
args=(--host "${TARGET_ADDR:-127.0.0.1}" --port "${TARGET_PORT:-18090}")
if [[ ${RESPONSE_BODY+x} ]]; then
    args+=(--body="$RESPONSE_BODY")
else
    args+=(--response-length "${RESPONSE_LENGTH:-64}" --response-mode "${RESPONSE_MODE:-fixed}")
fi
exec python3 public-tests/http_smoke.py "${args[@]}"
