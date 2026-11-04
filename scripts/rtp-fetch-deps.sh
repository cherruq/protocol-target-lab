#!/usr/bin/env bash
set -euo pipefail
[[ ${OFFLINE:-0} != 1 ]] || { printf '%s\n' 'fetch-rtp-deps is explicitly online.' >&2; exit 2; }
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/rtp/dependencies.lock.json"))["base_image"])')
docker pull "$base_image"
