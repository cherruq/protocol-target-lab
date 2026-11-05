#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
readarray -t inputs < <(python3 -c 'import json;x=json.load(open("images/profinet/dependencies.lock.json"));print(x["base_image"]);print(x["build_image"]);print(x["image"])')
base=${inputs[0]};builder=$(python3 images/profinet/resolve-input.py);image=${inputs[2]}
docker image inspect "$base" "$builder" >/dev/null
[[ $(docker image inspect "$base" --format '{{.Architecture}}') == amd64 && $(docker image inspect "$builder" --format '{{.Architecture}}') == amd64 ]] || { printf '%s\n' 'This fixed native ABI requires amd64 base/compiler inputs.' >&2; exit 1; }
builder_ref="protocol-target-lab/profinet-build-input:locked-34ff223687cc"
docker tag "$builder" "$builder_ref"
mkdir -p build dist
context=$(mktemp -d "$project_root/build/profinet-image.XXXXXX")
trap 'docker image rm "$builder_ref" >/dev/null 2>&1 || true; rm -rf -- "$context"' EXIT
mkdir -p "$context/workers/profinet" "$context/native/profinet" "$context/images/profinet" "$context/third-party/profinet"
install -m0644 LICENSE "$context/LICENSE"
install -m0644 workers/profinet/*.py workers/profinet/runtime-contract.json "$context/workers/profinet/"
install -m0755 workers/profinet/set_network_parameters "$context/workers/profinet/"
install -m0644 native/profinet/* "$context/native/profinet/"
install -m0644 images/profinet/* "$context/images/profinet/"
install -m0644 third-party/profinet/* "$context/third-party/profinet/"
# Compile first, then bind the actual freshly built native ELF hash in the runtime label.
docker build --network=none --pull=false --target native-build --build-arg "BASE_IMAGE=$base" --build-arg "BUILD_IMAGE=$builder_ref" -t protocol-target-lab/profinet-build:0.1.0 -f "$context/images/profinet/Dockerfile" "$context"
extract=$(docker create protocol-target-lab/profinet-build:0.1.0)
trap 'if [[ -n $extract ]]; then docker rm -f "$extract" >/dev/null 2>&1 || true; fi; docker image rm "$builder_ref" >/dev/null 2>&1 || true; rm -rf -- "$context"' EXIT
docker cp "$extract:/out/pn_native" "$context/native-elf"
docker cp "$extract:/out/native-abi.json" dist/profinet-native-abi.json
docker rm "$extract" >/dev/null
native_hash=$(sha256sum "$context/native-elf" | cut -d' ' -f1)
rm -- "$context/native-elf"
extract=''
docker build --network=none --pull=false --build-arg "BASE_IMAGE=$base" --build-arg "BUILD_IMAGE=$builder_ref" --label "io.protocol-target-lab.profinet-native-binary-sha256=$native_hash" --label org.opencontainers.image.title=protocol-target-lab-profinet --label org.opencontainers.image.version=0.1.0 -t "$image" -f "$context/images/profinet/Dockerfile" "$context"
docker image inspect "$image" > dist/profinet-image-inspect.json
