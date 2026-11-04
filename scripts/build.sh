#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$project_root/target}"
npm_flags=(--cache "$project_root/.local/cache/npm" --no-audit --no-fund)
cargo_flags=(--release --locked)
if [[ ${OFFLINE:-0} == 1 ]]; then
    npm_flags+=(--offline)
    cargo_flags=(--release --frozen)
fi
(cd frontend && npm ci "${npm_flags[@]}" && npm run build)
# Compilation embeds frontend/dist. Do not reverse these steps.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$project_root=/build/protocol-target-lab"
cargo build "${cargo_flags[@]}"
