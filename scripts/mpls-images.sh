#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/mpls/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/mpls/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'MPLS base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed MPLS base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/mpls-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/mpls" "$context/images/mpls"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/mpls/server.py workers/mpls/client.py workers/mpls/mpls_wire.py "$context/workers/mpls/"
install -m0644 images/mpls/Dockerfile images/mpls/dependencies.lock.json images/mpls/NOTICE "$context/images/mpls/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-mpls --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/mpls/Dockerfile" "$context"
docker image inspect "$image" > dist/mpls-image-inspect.json
