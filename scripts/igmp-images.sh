#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/igmp/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/igmp/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'IGMP base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed IGMP base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/igmp-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/igmp" "$context/images/igmp"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/igmp/server.py workers/igmp/client.py workers/igmp/igmp_wire.py "$context/workers/igmp/"
install -m0644 images/igmp/Dockerfile images/igmp/dependencies.lock.json images/igmp/NOTICE "$context/images/igmp/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-igmp --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/igmp/Dockerfile" "$context"
docker image inspect "$image" > dist/igmp-image-inspect.json
