#!/usr/bin/env bash
set -euo pipefail
[[ ${OFFLINE:-0} != 1 ]] || { printf '%s\n' 'fetch-iec101-deps is explicitly online.' >&2; exit 2; }
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
base_image=$(python3 -c 'import json;print(json.load(open("images/iec101/dependencies.lock.json"))["base_image"])')
docker pull "$base_image"

python3 - <<'PY_FETCH'
import hashlib,json,pathlib,urllib.request
x=json.load(open('images/iec101/dependencies.lock.json'))['lib60870']
p=pathlib.Path(x['file'])
if not p.is_file():
    with urllib.request.urlopen(x['url'],timeout=45) as r: data=r.read()
    if hashlib.sha256(data).hexdigest()!=x['sha256']: raise SystemExit('lib60870 source SHA mismatch')
    p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(data)
if hashlib.sha256(p.read_bytes()).hexdigest()!=x['sha256']: raise SystemExit('lib60870 source SHA mismatch')
PY_FETCH
build_image=$(python3 -c 'import json;print(json.load(open("images/iec101/dependencies.lock.json"))["build_image"])')
mkdir -p "$project_root/build"
context=$(mktemp -d "$project_root/build/iec101-builder.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
cp images/iec101/build.Dockerfile "$context/Dockerfile"
docker build --build-arg "BASE_IMAGE=$base_image" -t "$build_image" "$context"
