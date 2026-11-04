#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/mqtt-assets}
image=$(python3 -c 'import json; print(json.load(open("images/mqtt/dependencies.lock.json"))["image"])')
docker image inspect "$image" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.mqtt-export.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/mosquitto" "$stage/sources/build"
docker save --output "$stage/mqtt-image.tar" "$image"
install -m 0644 third-party/mosquitto/mosquitto-2.0.18.tar.gz third-party/mosquitto/LICENSE.txt third-party/mosquitto/edl-v10 third-party/mosquitto/epl-v20 third-party/mosquitto/UTHASH-LICENSE.txt third-party/mosquitto/UTLIST-LICENSE.txt third-party/mosquitto/README.md "$stage/sources/mosquitto/"
mkdir -p "$stage/sources/mosquitto/patches"
for file in 0001-full-packet-size.patch source.json apply.py README.md; do install -m 0644 "third-party/mosquitto/patches/$file" "$stage/sources/mosquitto/patches/$file"; done
install -m 0644 images/mqtt/Dockerfile images/mqtt/build.Dockerfile images/mqtt/dependencies.lock.json "$stage/sources/build/"
install -m 0644 workers/mqtt/server.py workers/mqtt/client.py workers/mqtt/mqtt_wire.py LICENSE "$stage/sources/"
python3 - "$stage" "$image" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
manifest={'schema_version':1,'images':[{'file':'mqtt-image.tar','image':sys.argv[2],'sha256':sha(root/'mqtt-image.tar')}], 'sources':[{'file':str(p.relative_to(root)),'sha256':sha(p)} for p in sorted((root/'sources').rglob('*')) if p.is_file()]}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
# Publish only this script's named outputs after export succeeds.
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
mv -- "$stage/mqtt-image.tar" "$asset_dir/mqtt-image.tar"
mv -- "$stage/manifest.json" "$asset_dir/manifest.json"
printf 'MQTT runtime image and complete corresponding source exported to %s\n' "$asset_dir"
