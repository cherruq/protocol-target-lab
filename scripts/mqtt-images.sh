#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mapfile -t inputs < <(python3 -c 'import json; x=json.load(open("images/mqtt/dependencies.lock.json")); print(x["base_image"]); print(x["build_image"]); print(x["image"]); print(x["mosquitto"]["file"]); print(x["mosquitto"]["sha256"])')
base_image=${inputs[0]}; build_image=${inputs[1]}; image=${inputs[2]}
for dependency in "$base_image" "$build_image"; do
    docker image inspect "$dependency" >/dev/null 2>&1 || { printf 'Missing MQTT dependency %s; prepare online using scripts/mqtt-fetch-deps.sh or import its saved cache.\n' "$dependency" >&2; exit 1; }
done
printf '%s  %s\n' "${inputs[4]}" "${inputs[3]}" | sha256sum -c -
python3 - <<'PY_CHECK'
import hashlib,json,pathlib
for patch in json.load(open('images/mqtt/dependencies.lock.json'))['mosquitto']['patches']:
    if hashlib.sha256(pathlib.Path(patch['file']).read_bytes()).hexdigest()!=patch['sha256']:
        raise SystemExit('MQTT locked patch hash mismatch: '+patch['file'])
PY_CHECK
mkdir -p build dist
context=$(mktemp -d "$project_root/build/mqtt-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/mqtt" "$context/images/mqtt" "$context/third-party/mosquitto"
install -m 0644 LICENSE "$context/LICENSE"
for file in server.py client.py mqtt_wire.py; do install -m 0644 "workers/mqtt/$file" "$context/workers/mqtt/$file"; done
for file in Dockerfile build.Dockerfile dependencies.lock.json; do install -m 0644 "images/mqtt/$file" "$context/images/mqtt/$file"; done
for file in mosquitto-2.0.18.tar.gz LICENSE.txt edl-v10 epl-v20 UTHASH-LICENSE.txt UTLIST-LICENSE.txt README.md; do install -m 0644 "third-party/mosquitto/$file" "$context/third-party/mosquitto/$file"; done
mkdir -p "$context/third-party/mosquitto/patches"
for file in 0001-full-packet-size.patch source.json apply.py README.md; do install -m 0644 "third-party/mosquitto/patches/$file" "$context/third-party/mosquitto/patches/$file"; done
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --build-arg "BUILD_IMAGE=$build_image" \
    --label org.opencontainers.image.title=protocol-target-lab-mqtt --label org.opencontainers.image.version=0.1.1 \
    -f "$context/images/mqtt/Dockerfile" --tag "$image" "$context"
docker image inspect "$image" > dist/mqtt-image-inspect.json
