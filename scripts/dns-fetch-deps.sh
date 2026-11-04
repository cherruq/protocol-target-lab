#!/usr/bin/env bash
set -euo pipefail
if [[ ${OFFLINE:-0} == 1 ]]; then
    printf '%s\n' 'fetch-dns-deps is an explicit online preparation step; omit OFFLINE=1.' >&2
    exit 2
fi
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mapfile -t inputs < <(python3 -c 'import json; x=json.load(open("images/dns/dependencies.lock.json")); print(x["base_image"]); print(x["build_image"]); print(x["dnsmasq"]["file"]); print(x["dnsmasq"]["url"]); print(x["dnsmasq"]["sha256"])')
base_image=${inputs[0]}; build_image=${inputs[1]}; source_file=${inputs[2]}
if [[ ! -f $source_file ]]; then
    mkdir -p "$(dirname -- "$source_file")"
    source_tmp=$(mktemp "$source_file.download.XXXXXX")
    trap 'rm -f -- "$source_tmp"' EXIT
    curl --fail --location --proto '=https' --tlsv1.2 --output "$source_tmp" "${inputs[3]}"
    printf '%s  %s\n' "${inputs[4]}" "$source_tmp" | sha256sum -c -
    mv -- "$source_tmp" "$source_file"
fi
printf '%s  %s\n' "${inputs[4]}" "$source_file" | sha256sum -c -
docker pull "$base_image"
docker build --pull=false --build-arg "BASE_IMAGE=$base_image" --tag "$build_image" - < images/dns/build.Dockerfile
mkdir -p dist
docker image inspect "$build_image" > dist/dns-build-image-inspect.json
docker run --rm --network=none --entrypoint dpkg-query "$build_image" -W > dist/dns-build-packages.txt
printf '%s\n' 'DNS source/base/compiler cache prepared. Run scripts/dns-images.sh for an offline image build.'
