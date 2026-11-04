#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
test -s Cargo.lock
test -s frontend/package-lock.json
cargo metadata --locked --offline --format-version 1 > /dev/null
(cd frontend && npm cache verify --cache "$project_root/.local/cache/npm")
base_image=$(cat images/http/base-image.lock)
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'HTTP base image is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" > /dev/null
printf '%s\n' 'Cargo metadata resolves offline, npm cache is intact, locked base image is local.' 'This cache check does not replace a successful OFFLINE=1 build or a full offline-bundle acceptance.'
