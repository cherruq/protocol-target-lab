#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/arp-client/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/arp-client/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'ARP-client base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed ARP-client base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/arp-client-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/arp-client" "$context/images/arp-client"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/arp-client/server.py workers/arp-client/client.py workers/arp-client/arp_wire.py "$context/workers/arp-client/"
install -m0644 images/arp-client/Dockerfile images/arp-client/dependencies.lock.json images/arp-client/NOTICE "$context/images/arp-client/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-arp-client --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/arp-client/Dockerfile" "$context"
docker image inspect "$image" > dist/arp-client-image-inspect.json
