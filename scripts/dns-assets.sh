#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/dns-assets}
image=$(python3 -c 'import json; print(json.load(open("images/dns/dependencies.lock.json"))["image"])')
docker image inspect "$image" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.dns-export.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/dnsmasq" "$stage/sources/build"
docker save --output "$stage/dns-image.tar" "$image"
install -m 0644 third-party/dnsmasq/dnsmasq-2.90.tar.xz third-party/dnsmasq/COPYING third-party/dnsmasq/COPYING-v3 third-party/dnsmasq/README.md "$stage/sources/dnsmasq/"
install -m 0644 images/dns/Dockerfile images/dns/build.Dockerfile images/dns/dependencies.lock.json "$stage/sources/build/"
mkdir -p "$stage/sources/worker"
install -m 0644 workers/dns/*.py "$stage/sources/worker/"
cp -R workers/dns/fixtures "$stage/sources/worker/fixtures"
cp -R workers/tls "$stage/sources/tls"
install -m 0644 LICENSE "$stage/sources/"
python3 - "$stage" "$image" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
manifest={'schema_version':1,'images':[{'file':'dns-image.tar','image':sys.argv[2],'sha256':sha(root/'dns-image.tar')}], 'sources':[{'file':str(p.relative_to(root)),'sha256':sha(p)} for p in sorted((root/'sources').rglob('*')) if p.is_file()]}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
# Publish only this script's named outputs after export succeeds.
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
mv -- "$stage/dns-image.tar" "$asset_dir/dns-image.tar"
mv -- "$stage/manifest.json" "$asset_dir/manifest.json"
printf 'DNS runtime image and complete corresponding source exported to %s\n' "$asset_dir"
