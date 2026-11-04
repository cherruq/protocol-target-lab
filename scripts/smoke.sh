#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
case ${SCENARIO:-http-basic} in
    dns-basic)
        [[ -n ${DNS_CONFIG_FILE:-} ]] || { printf '%s\n' 'Set DNS_CONFIG_FILE to the applied DNS JSON configuration.' >&2; exit 2; }
        exec python3 workers/dns/client.py --host "${TARGET_ADDR:-127.0.0.1}" --port "${TARGET_PORT:-15353}" --method "${DNS_TRANSPORT:-ALL}" --path "${DNS_NAME:-ALL}" --config-json "$(cat -- "$DNS_CONFIG_FILE")"
        ;;
    http-basic) ;;
    *) printf '%s\n' 'Supported scenarios: http-basic, dns-basic.' >&2; exit 2 ;;
esac
args=(--host "${TARGET_ADDR:-127.0.0.1}" --port "${TARGET_PORT:-18090}")
if [[ ${RESPONSE_BODY+x} ]]; then
    args+=(--body="$RESPONSE_BODY")
else
    args+=(--response-length "${RESPONSE_LENGTH:-64}" --response-mode "${RESPONSE_MODE:-fixed}")
fi
exec python3 public-tests/http_smoke.py "${args[@]}"
