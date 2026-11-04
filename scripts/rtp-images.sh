#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/rtp/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/rtp/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'RTP base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed RTP base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/rtp-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/rtp" "$context/images/rtp"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/rtp/server.py workers/rtp/client.py workers/rtp/rtp_wire.py "$context/workers/rtp/"
install -m0644 images/rtp/Dockerfile images/rtp/dependencies.lock.json "$context/images/rtp/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-rtp --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/rtp/Dockerfile" "$context"
docker image inspect "$image" > dist/rtp-image-inspect.json
