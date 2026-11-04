#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/dlt645/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/dlt645/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'DLT645 base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed DLT645 base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/dlt645-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/dlt645" "$context/images/dlt645"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/dlt645/server.py workers/dlt645/client.py workers/dlt645/common.py workers/dlt645/meter.py "$context/workers/dlt645/"
install -m0644 images/dlt645/Dockerfile images/dlt645/dependencies.lock.json "$context/images/dlt645/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-dlt645 --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/dlt645/Dockerfile" "$context"
docker image inspect "$image" > dist/dlt645-image-inspect.json
