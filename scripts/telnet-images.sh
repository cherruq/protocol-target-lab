#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mapfile -t inputs < <(python3 -c 'import json; x=json.load(open("images/telnet/dependencies.lock.json")); print(x["base_image"]);print(x["build_image"]);print(x["image"])')
base_image=${inputs[0]};build_image=${inputs[1]};image=${inputs[2]}
[[ $# == 0 || ( $# == 1 && $1 == --prepare-only ) ]] || { printf '%s\n' 'Usage: telnet-images.sh [--prepare-only]' >&2; exit 2; }
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed Telnet base; run scripts/telnet-fetch-deps.sh online or import the base cache.' >&2; exit 1; }
python3 - <<'PY'
import hashlib,json,pathlib
for item in json.load(open('images/telnet/dependencies.lock.json'))['packages']:
    if hashlib.sha256(pathlib.Path(item['file']).read_bytes()).hexdigest()!=item['sha256']:raise SystemExit('Telnet package hash mismatch: '+item['file'])
PY
mkdir -p build dist
context=$(mktemp -d "$project_root/build/telnet-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/telnet" "$context/images/telnet" "$context/third-party/telnetlib3"
install -m 0644 LICENSE "$context/LICENSE"
for file in server.py client.py telnet_wire.py; do install -m 0644 "workers/telnet/$file" "$context/workers/telnet/$file"; done
for file in Dockerfile build.Dockerfile dependencies.lock.json requirements.lock; do install -m 0644 "images/telnet/$file" "$context/images/telnet/$file"; done
# This directory contains only the public, checksum-locked dependency delivery materials.
cp -R -- third-party/telnetlib3/. "$context/third-party/telnetlib3/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" -f "$context/images/telnet/build.Dockerfile" --tag "$build_image" "$context"
docker image inspect "$build_image" > dist/telnet-build-image-inspect.json
if [[ ${1:-} == --prepare-only ]]; then exit 0; fi
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --build-arg "BUILD_IMAGE=$build_image" \
  --label org.opencontainers.image.title=protocol-target-lab-telnet --label org.opencontainers.image.version=0.1.0 \
  -f "$context/images/telnet/Dockerfile" --tag "$image" "$context"
docker image inspect "$image" > dist/telnet-image-inspect.json
