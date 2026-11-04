#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/rtcp/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/rtcp/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'RTCP base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed RTCP base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/rtcp-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/rtcp" "$context/images/rtcp"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/rtcp/server.py workers/rtcp/client.py workers/rtcp/rtcp_wire.py "$context/workers/rtcp/"
install -m0644 images/rtcp/Dockerfile images/rtcp/dependencies.lock.json "$context/images/rtcp/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-rtcp --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/rtcp/Dockerfile" "$context"
docker image inspect "$image" > dist/rtcp-image-inspect.json
