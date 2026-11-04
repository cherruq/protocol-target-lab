#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mapfile -t inputs < <(python3 -c 'import json; x=json.load(open("images/dns/dependencies.lock.json")); print(x["base_image"]); print(x["build_image"]); print(x["image"]); print(x["dnsmasq"]["file"]); print(x["dnsmasq"]["sha256"])')
base_image=${inputs[0]}; build_image=${inputs[1]}; image=${inputs[2]}
for dependency in "$base_image" "$build_image"; do
    docker image inspect "$dependency" >/dev/null 2>&1 || { printf 'Missing DNS dependency %s; prepare online using scripts/dns-fetch-deps.sh or import its saved cache.\n' "$dependency" >&2; exit 1; }
done
printf '%s  %s\n' "${inputs[4]}" "${inputs[3]}" | sha256sum -c -
mkdir -p build dist
context=$(mktemp -d "$project_root/build/dns-image.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/dns" "$context/images/dns" "$context/third-party/dnsmasq"
install -m 0644 LICENSE "$context/LICENSE"
for file in server.py client.py dns_wire.py; do install -m 0644 "workers/dns/$file" "$context/workers/dns/$file"; done
for file in Dockerfile build.Dockerfile dependencies.lock.json; do install -m 0644 "images/dns/$file" "$context/images/dns/$file"; done
for file in dnsmasq-2.90.tar.xz COPYING COPYING-v3 README.md; do install -m 0644 "third-party/dnsmasq/$file" "$context/third-party/dnsmasq/$file"; done
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base_image" --build-arg "BUILD_IMAGE=$build_image" \
    --label org.opencontainers.image.title=protocol-target-lab-dns --label org.opencontainers.image.version=0.1.0 \
    -f "$context/images/dns/Dockerfile" --tag "$image" "$context"
docker image inspect "$image" > dist/dns-image-inspect.json
