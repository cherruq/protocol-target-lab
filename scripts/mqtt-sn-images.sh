#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
[[ $# == 0 || ( $# == 1 && $1 == --prepare-only ) ]] || { printf '%s\n' 'Usage: mqtt-sn-images.sh [--prepare-only]' >&2; exit 2; }
mapfile -t inputs < <(python3 -c 'import json;x=json.load(open("images/mqtt-sn/dependencies.lock.json"));print(x["base_image"]);print(x["build_image"]);print(x["image"]);print(x["broker"]["image"])')
base_image=${inputs[0]};build_image=${inputs[1]};image=${inputs[2]}
python3 - <<'PY'
import hashlib,json,pathlib
x=json.load(open('images/mqtt-sn/dependencies.lock.json'))
for item in (x['paho'],x['mqtt_client_primitive']):
    if hashlib.sha256(pathlib.Path(item['file']).read_bytes()).hexdigest()!=item['sha256']:raise SystemExit('MQTT-SN locked input hash mismatch: '+item['file'])

PY
python3 scripts/mqtt-sn-broker-input.py >/dev/null
docker image inspect "$base_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing MQTT-SN fixed base; fetch dependencies online or import cache.' >&2; exit 1; }
mkdir -p build dist
context=$(mktemp -d "$project_root/build/mqtt-sn-image.XXXXXX")
broker_build_tag=
trap 'if [[ -n $broker_build_tag ]]; then docker image rm "$broker_build_tag" >/dev/null 2>&1 || true; fi; rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/mqtt-sn" "$context/workers/mqtt" "$context/images/mqtt-sn" "$context/third-party/paho-mqtt-sn" "$context/scripts"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 scripts/mqtt-sn-broker-input.py "$context/scripts/"
for file in server.py client.py mqttsn_wire.py; do install -m0644 "workers/mqtt-sn/$file" "$context/workers/mqtt-sn/$file"; done
install -m0644 workers/mqtt/mqtt_wire.py "$context/workers/mqtt/mqtt_wire.py"
for file in Dockerfile build.Dockerfile dependencies.lock.json; do install -m0644 "images/mqtt-sn/$file" "$context/images/mqtt-sn/$file"; done
cp -R -- third-party/paho-mqtt-sn/. "$context/third-party/paho-mqtt-sn/"
if [[ ${1:-} == --prepare-only ]]; then
    [[ ${OFFLINE:-0} != 1 ]] || { printf '%s\n' 'Preparing MQTT-SN compiler cache uses online apt.' >&2; exit 2; }
    docker build --pull=false --build-arg "BASE_IMAGE=$base_image" -f "$context/images/mqtt-sn/build.Dockerfile" --tag "$build_image" "$context"
    docker image inspect "$build_image" > dist/mqtt-sn-build-image-inspect.json
    docker run --rm --network=none --entrypoint dpkg-query "$build_image" -W > dist/mqtt-sn-build-packages.txt
    exit 0
fi
docker image inspect "$build_image" >/dev/null 2>&1 || { printf '%s\n' 'Missing MQTT-SN compiler cache; run scripts/mqtt-sn-fetch-deps.sh online.' >&2; exit 1; }
# BuildKit does not accept a bare local image ID as a FROM reference. Give the
# verified immutable input a task-owned temporary tag, never the public MQTT tag.
broker_id=$(python3 scripts/mqtt-sn-broker-input.py)
broker_build_tag="protocol-target-lab/mqtt-sn-broker-input:task-$$"
docker image tag "$broker_id" "$broker_build_tag"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --build-arg "BUILD_IMAGE=$build_image" --build-arg "BROKER_IMAGE=$broker_build_tag" \
    --label org.opencontainers.image.title=protocol-target-lab-mqtt-sn --label org.opencontainers.image.version=0.1.1 \
    -f "$context/images/mqtt-sn/Dockerfile" --tag "$image" "$context"
docker image inspect "$image" > dist/mqtt-sn-image-inspect.json
