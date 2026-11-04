#!/usr/bin/env bash
set -euo pipefail
if [[ ${OFFLINE:-0} == 1 ]]; then printf '%s\n' 'fetch-iec104-deps is online preparation; omit OFFLINE=1.' >&2; exit 2; fi
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
python3 - <<'PY'
import hashlib,json,pathlib,urllib.request
for item in json.load(open('images/iec104/dependencies.lock.json'))['packages']:
    path=pathlib.Path(item['file']);path.parent.mkdir(parents=True,exist_ok=True)
    if not path.is_file():
        raw=urllib.request.urlopen(item['url'],timeout=30).read()
        if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise SystemExit('IEC104 download hash mismatch')
        path.write_bytes(raw)
    if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:raise SystemExit('IEC104 package hash mismatch: '+str(path))
PY
base_image=$(python3 -c 'import json;print(json.load(open("images/iec104/dependencies.lock.json"))["base_image"])')
docker pull "$base_image"
scripts/iec104-images.sh --prepare-only
