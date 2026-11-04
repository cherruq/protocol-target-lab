#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(cat images/http/base-image.lock)
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'HTTP base image is not digest-locked.' >&2; exit 1; }
if ! docker image inspect "$base_image" > /dev/null 2>&1; then
    printf '%s\n' 'Locked HTTP base image missing. Run make fetch-deps while online, or import the matching image first.' >&2
    exit 1
fi
# A small allowlisted context excludes local references, credentials, and unrelated files.
mkdir -p build
context=$(mktemp -d "$project_root/build/http-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/http"
install -m 0644 workers/http/server.py "$context/workers/http/server.py"
install -m 0644 images/http/Dockerfile "$context/Dockerfile"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" \
    --label org.opencontainers.image.title=protocol-target-lab-http \
    --label org.opencontainers.image.version=0.1.0 \
    --label org.opencontainers.image.licenses=MIT \
    --tag protocol-target-lab/http:0.1.0 "$context"
mkdir -p dist
docker image inspect protocol-target-lab/http:0.1.0 > dist/http-image-inspect.json
