#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
if [[ ${OFFLINE:-0} == 1 ]]; then
    printf '%s\n' 'fetch-deps is an explicit online preparation step; omit OFFLINE=1.' >&2
    exit 2
fi
cargo fetch --locked
(cd frontend && npm ci --cache "$project_root/.local/cache/npm" --no-audit --no-fund)
base_image=$(cat images/http/base-image.lock)
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'HTTP base image is not digest-locked.' >&2; exit 1; }
docker pull "$base_image"
printf '%s\n' 'Phase-1 Cargo/npm/base-image dependencies prepared. Full offline distribution is a later milestone.'
