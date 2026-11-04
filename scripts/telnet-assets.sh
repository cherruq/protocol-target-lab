#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/telnet-assets}
image=$(python3 -c 'import json;print(json.load(open("images/telnet/dependencies.lock.json"))["image"])')
docker image inspect "$image" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.telnet-export.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/dependencies" "$stage/sources/build"
docker save --output "$stage/telnet-image.tar" "$image"
cp -R -- third-party/telnetlib3/. "$stage/sources/dependencies/"
install -m 0644 images/telnet/Dockerfile images/telnet/build.Dockerfile images/telnet/dependencies.lock.json images/telnet/requirements.lock "$stage/sources/build/"
install -m 0644 workers/telnet/server.py workers/telnet/client.py workers/telnet/telnet_wire.py LICENSE "$stage/sources/"
python3 - "$stage" "$image" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
manifest={'schema_version':1,'images':[{'file':'telnet-image.tar','image':sys.argv[2],'sha256':sha(root/'telnet-image.tar')}],'sources':[{'file':str(p.relative_to(root)),'sha256':sha(p)} for p in sorted((root/'sources').rglob('*')) if p.is_file()]}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
mv -- "$stage/telnet-image.tar" "$asset_dir/telnet-image.tar"
mv -- "$stage/manifest.json" "$asset_dir/manifest.json"
printf 'Telnet runtime image and public source/license materials exported to %s\n' "$asset_dir"
