#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/iec101/dependencies.lock.json"))["base_image"])')
image=$(python3 -c 'import json;print(json.load(open("images/iec101/dependencies.lock.json"))["image"])')
[[ $base_image == *@sha256:* ]] || { printf '%s\n' 'IEC101 base is not digest-locked.' >&2; exit 1; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed IEC101 base. Fetch online or import matching cache first.' >&2; exit 1; }
python3 - <<'PY_VERIFY'
import hashlib,json,pathlib
lock=json.load(open('images/iec101/dependencies.lock.json'))['lib60870']
if json.load(open('third-party/lib60870/source.json'))!=lock: raise SystemExit('IEC101 source metadata differs from lock')
if hashlib.sha256(pathlib.Path(lock['file']).read_bytes()).hexdigest()!=lock['sha256']: raise SystemExit('IEC101 source SHA mismatch')
PY_VERIFY
mkdir -p build dist
context=$(mktemp -d "$project_root/build/iec101-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/iec101" "$context/images/iec101" "$context/third-party/lib60870"
cp -R third-party/lib60870/. "$context/third-party/lib60870/"
build_image=$(python3 -c 'import json;print(json.load(open("images/iec101/dependencies.lock.json"))["build_image"])')
docker image inspect "$build_image" >/dev/null
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/iec101/server.py workers/iec101/client.py workers/iec101/common.py workers/iec101/native_slave.c "$context/workers/iec101/"
install -m0644 images/iec101/Dockerfile images/iec101/dependencies.lock.json images/iec101/build.Dockerfile "$context/images/iec101/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --build-arg "BUILD_IMAGE=$build_image" --tag "$image" \
    --label org.opencontainers.image.title=protocol-target-lab-iec101 --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/iec101/Dockerfile" "$context"
docker image inspect "$image" > dist/iec101-image-inspect.json
