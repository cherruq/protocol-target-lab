#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/vxlan/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/vxlan/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'VXLAN base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed VXLAN base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/vxlan-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/vxlan" "$context/images/vxlan"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/vxlan/server.py workers/vxlan/client.py workers/vxlan/vxlan_wire.py "$context/workers/vxlan/"
install -m0644 images/vxlan/Dockerfile images/vxlan/dependencies.lock.json images/vxlan/NOTICE "$context/images/vxlan/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-vxlan --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/vxlan/Dockerfile" "$context"
docker image inspect "$image" > dist/vxlan-image-inspect.json
