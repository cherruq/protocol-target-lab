#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
python3 - <<'PY'
import hashlib,json,pathlib,urllib.request
for v in json.load(open('third-party/profinet/sources.lock.json')):
 p=pathlib.Path(v['file'])
 if not p.exists():
  tmp=p.with_suffix('.download')
  try:
   with urllib.request.urlopen(v['url'],timeout=60)as r:tmp.write_bytes(r.read(4194305))
   if hashlib.sha256(tmp.read_bytes()).hexdigest()!=v['sha256']:raise ValueError('native source digest mismatch')
   tmp.replace(p)
  finally:tmp.unlink(missing_ok=True)
 if hashlib.sha256(p.read_bytes()).hexdigest()!=v['sha256']:raise ValueError('native source digest mismatch: '+str(p))
PY
readarray -t inputs < <(python3 -c 'import json;x=json.load(open("images/profinet/dependencies.lock.json"));print(x["base_image"]);print(x["build_image"])')
if [[ ${OFFLINE:-0} != 1 ]]; then docker pull "${inputs[0]}"; fi
docker image inspect "${inputs[0]}" >/dev/null
python3 images/profinet/resolve-input.py >/dev/null || { printf '%s\n' 'Missing fixed prepared compiler input. Explicitly load sources/build-input/compiler-image.tar from complete assets before source rebuilding.' >&2; exit 1; }
printf '%s\n' 'PROFINET public archives and fixed prepared base/compiler inputs verified; runtime build uses --network=none.'
