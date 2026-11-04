#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/bfd/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/bfd/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'BFD base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed BFD base. Fetch online or import matching cache first.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/bfd-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/bfd" "$context/images/bfd"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/bfd/server.py workers/bfd/client.py workers/bfd/bfd_wire.py workers/bfd/state.py "$context/workers/bfd/"
install -m0644 images/bfd/Dockerfile images/bfd/dependencies.lock.json "$context/images/bfd/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-bfd --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/bfd/Dockerfile" "$context"
docker image inspect "$image" > dist/bfd-image-inspect.json
