#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mapfile -t inputs < <(python3 -c 'import json;x=json.load(open("images/custom-ethernet/dependencies.lock.json"));print(x["base_image"]);print(x["build_image"]);print(x["image"]);print(x["libpcap"]["file"]);print(x["libpcap"]["sha256"])')
printf '%s  %s\n' "${inputs[4]}" "${inputs[3]}" | sha256sum -c -
for img in "${inputs[0]}" "${inputs[1]}"; do docker image inspect "$img" >/dev/null || { echo 'Prepare locked base/compiler cache online first.' >&2; exit 1; }; done
mkdir -p build dist
context=$(mktemp -d "$project_root/build/custom-ethernet-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/custom-ethernet" "$context/images/custom-ethernet"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/custom-ethernet/{server,client,compile,ethernet_wire}.py "$context/workers/custom-ethernet/"
cp -a images/custom-ethernet/. "$context/images/custom-ethernet/"
docker build --network=none --pull=false --build-arg "BASE_IMAGE=${inputs[0]}" --build-arg "BUILD_IMAGE=${inputs[1]}" --tag "${inputs[2]}" -f "$context/images/custom-ethernet/Dockerfile" "$context"
docker image inspect "${inputs[2]}" > dist/custom-ethernet-image-inspect.json
