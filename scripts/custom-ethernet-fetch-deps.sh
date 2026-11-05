#!/usr/bin/env bash
set -euo pipefail
[[ ${OFFLINE:-0} != 1 ]] || { echo 'fetch-custom-ethernet-deps is explicitly online.' >&2; exit 2; }
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mapfile -t inputs < <(python3 -c 'import json;x=json.load(open("images/custom-ethernet/dependencies.lock.json"));print(x["base_image"]);print(x["build_image"]);print(x["libpcap"]["file"]);print(x["libpcap"]["url"]);print(x["libpcap"]["sha256"])')
if [[ ! -f ${inputs[2]} ]]; then
    mkdir -p "$(dirname -- "${inputs[2]}")"
    download=$(mktemp "${inputs[2]}.download.XXXXXX")
    trap 'rm -f -- "$download"' EXIT
    curl --fail --location --proto '=https' --tlsv1.2 --output "$download" "${inputs[3]}"
    printf '%s  %s\n' "${inputs[4]}" "$download" | sha256sum -c -
    mv -- "$download" "${inputs[2]}"
fi
printf '%s  %s\n' "${inputs[4]}" "${inputs[2]}" | sha256sum -c -
docker image inspect "${inputs[0]}" >/dev/null 2>&1 || docker pull "${inputs[0]}"
docker build --pull=false --build-arg "BASE_IMAGE=${inputs[0]}" --tag "${inputs[1]}" - < images/custom-ethernet/build.Dockerfile
mkdir -p dist
docker image inspect "${inputs[1]}" > dist/custom-ethernet-build-image-inspect.json
docker run --rm --network=none --entrypoint dpkg-query "${inputs[1]}" -W > dist/custom-ethernet-build-packages.txt
