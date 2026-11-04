#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/iec104-assets}
image=$(python3 -c 'import json;print(json.load(open("images/iec104/dependencies.lock.json"))["image"])')
docker image inspect "$image" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.iec104-export.XXXXXX")
export_container=
trap 'if [[ -n $export_container ]]; then docker container remove "$export_container" >/dev/null 2>&1 || true; fi; rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/dependencies" "$stage/sources/build"
docker save --output "$stage/iec104-image.tar" "$image"
mkdir -p "$stage/sources/rebuilt-wheel"
export_container=$(docker create --network=none --label io.protocol-target-lab.task=iec104-asset-export --entrypoint /bin/true "$image")
docker cp "$export_container:/deps/." "$stage/sources/rebuilt-wheel/"
docker container remove "$export_container" >/dev/null
export_container=
cp -R -- third-party/iec104/. "$stage/sources/dependencies/"
install -m 0644 images/iec104/Dockerfile images/iec104/build.Dockerfile images/iec104/dependencies.lock.json images/iec104/requirements.lock images/iec104/build-requirements.lock "$stage/sources/build/"
install -m 0644 workers/iec104/server.py workers/iec104/client.py workers/iec104/iec104_wire.py workers/iec104/iec104_config.py LICENSE "$stage/sources/"
python3 - "$stage" "$image" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
manifest={'schema_version':1,'images':[{'file':'iec104-image.tar','image':sys.argv[2],'sha256':sha(root/'iec104-image.tar')}],'sources':[{'file':str(p.relative_to(root)),'sha256':sha(p)} for p in sorted((root/'sources').rglob('*')) if p.is_file()]}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
mv -- "$stage/iec104-image.tar" "$asset_dir/iec104-image.tar"
mv -- "$stage/manifest.json" "$asset_dir/manifest.json"
printf 'IEC104 runtime image and public source/license materials exported to %s\n' "$asset_dir"
