#!/usr/bin/env bash
set -euo pipefail
if [[ ${OFFLINE:-0} == 1 ]]; then printf '%s\n' 'fetch-mqtt-sn-deps is an explicit online preparation step.' >&2; exit 2; fi
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
python3 - <<'PY'
import hashlib,json,pathlib,urllib.request
x=json.load(open('images/mqtt-sn/dependencies.lock.json'));item=x['paho'];path=pathlib.Path(item['file'])
if not path.is_file():
    data=urllib.request.urlopen(item['url'],timeout=30).read()
    if hashlib.sha256(data).hexdigest()!=item['sha256']:raise SystemExit('MQTT-SN source download hash mismatch')
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:raise SystemExit('MQTT-SN source hash mismatch')
PY
base_image=$(python3 -c 'import json;print(json.load(open("images/mqtt-sn/dependencies.lock.json"))["base_image"])')
docker pull "$base_image"
# Resolve only the complete locked content, including imported untagged images.
python3 scripts/mqtt-sn-broker-input.py >/dev/null
scripts/mqtt-sn-images.sh --prepare-only
