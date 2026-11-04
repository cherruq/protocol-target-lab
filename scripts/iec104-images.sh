#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mapfile -t inputs < <(python3 -c 'import json;x=json.load(open("images/iec104/dependencies.lock.json"));print(x["base_image"]);print(x["build_image"]);print(x["image"])')
base_image=${inputs[0]};build_image=${inputs[1]};image=${inputs[2]}
[[ $# == 0 || ( $# == 1 && $1 == --prepare-only ) ]] || { printf '%s\n' 'Usage: iec104-images.sh [--prepare-only]' >&2; exit 2; }
python3 - <<'PY'
import hashlib,json,pathlib
lock=json.load(open('images/iec104/dependencies.lock.json'))
for item in lock['packages']+lock.get('patches',[]):
    if hashlib.sha256(pathlib.Path(item['file']).read_bytes()).hexdigest()!=item['sha256']:raise SystemExit('IEC104 package hash mismatch: '+item['file'])
PY
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing fixed IEC104 base; prepare dependencies online or import matching cache.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/iec104-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/iec104" "$context/images/iec104" "$context/third-party/iec104"
install -m 0644 LICENSE "$context/LICENSE"
for file in server.py client.py iec104_wire.py iec104_config.py; do install -m 0644 "workers/iec104/$file" "$context/workers/iec104/$file"; done
for file in Dockerfile build.Dockerfile dependencies.lock.json requirements.lock build-requirements.lock; do install -m 0644 "images/iec104/$file" "$context/images/iec104/$file"; done
cp -R -- third-party/iec104/. "$context/third-party/iec104/"
if [[ ${1:-} == --prepare-only ]]; then
    [[ ${OFFLINE:-0} != 1 ]] || { printf '%s\n' 'Preparing IEC104 compiler cache needs online apt; omit OFFLINE=1.' >&2; exit 2; }
    docker build --pull=false --build-arg "BASE_IMAGE=$base_image" -f "$context/images/iec104/build.Dockerfile" --tag "$build_image" "$context"
    docker image inspect "$build_image" > dist/iec104-build-image-inspect.json
    docker run --rm --network=none --entrypoint dpkg-query "$build_image" -W > dist/iec104-build-packages.txt
    exit 0
fi
docker image inspect "$build_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing IEC104 compiler cache; run scripts/iec104-fetch-deps.sh online or import matching cache.' >&2; exit 1; }
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --build-arg "BUILD_IMAGE=$build_image" \
  --label org.opencontainers.image.title=protocol-target-lab-iec104 --label org.opencontainers.image.version=0.1.1 \
  -f "$context/images/iec104/Dockerfile" --tag "$image" "$context"
docker image inspect "$image" > dist/iec104-image-inspect.json
