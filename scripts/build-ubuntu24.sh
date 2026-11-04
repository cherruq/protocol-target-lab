#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
builder_image=${PLAB_BUILD_IMAGE:-protocol-target-lab/build-ubuntu24:phase1}
for tool in npm rustup docker; do command -v "$tool" > /dev/null; done
npm_flags=(--cache "$project_root/.local/cache/npm" --no-audit --no-fund)
if [[ ${OFFLINE:-0} == 1 ]]; then
    npm_flags+=(--offline)
fi
(cd frontend && npm ci "${npm_flags[@]}" && npm run build)
compiler=$(rustup which rustc)
task_toolchain=$(dirname -- "$(dirname -- "$(realpath "$compiler")")")
task_cargo_home=${CARGO_HOME:-$HOME/.cargo}
task_cargo_home=$(realpath "$task_cargo_home")
if ! docker image inspect "$builder_image" > /dev/null 2>&1; then
    if [[ ${OFFLINE:-0} == 1 ]]; then
        printf '%s\n' "Ubuntu 24.04 builder image missing: $builder_image. Prepare it online before OFFLINE=1." >&2
        exit 1
    fi
    # The stdin build context contains only this Dockerfile, never the workspace.
    docker build --pull=false --tag "$builder_image" - < packaging/build-ubuntu24.Dockerfile
fi
mkdir -p .local/build/ubuntu24/target
docker run --rm --network=none --user "$(id -u):$(id -g)" \
    --env PATH=/toolchain/bin:/usr/bin:/bin \
    --env CARGO_HOME=/cargo \
    --env CARGO_TARGET_DIR=/workspace/.local/build/ubuntu24/target \
    --env 'RUSTFLAGS=--remap-path-prefix=/workspace=/src/protocol-target-lab --remap-path-prefix=/cargo=/cargo-cache --remap-path-prefix=/toolchain=/rust-toolchain' \
    --mount "type=bind,src=$task_toolchain,dst=/toolchain,readonly" \
    --mount "type=bind,src=$task_cargo_home,dst=/cargo" \
    --mount "type=bind,src=$project_root,dst=/workspace" \
    --workdir /workspace "$builder_image" cargo build --release --frozen
printf '%s\n' "Ubuntu 24.04 manager: $project_root/.local/build/ubuntu24/target/release/protocol-target-lab"
