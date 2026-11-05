#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/custom-ethernet-assets}
image=$(python3 -c 'import json;print(json.load(open("images/custom-ethernet/dependencies.lock.json"))["image"])')
docker image inspect "$image" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.custom-ethernet-export.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/workers/custom-ethernet" "$stage/sources/images/custom-ethernet" "$stage/sources/scripts" "$stage/sources/docs"
docker save --output "$stage/custom-ethernet-image.tar" "$image"
install -m0644 workers/custom-ethernet/*.py "$stage/sources/workers/custom-ethernet/"
cp -a images/custom-ethernet/. "$stage/sources/images/custom-ethernet/"
install -m0755 scripts/custom-ethernet-{fetch-deps,images,assets}.sh "$stage/sources/scripts/"
install -m0644 docs/custom-ethernet.md "$stage/sources/docs/"
install -m0644 LICENSE "$stage/sources/LICENSE"
mkdir -p "$stage/sources/build-provenance"
[[ -f dist/custom-ethernet-build-packages.txt && -f dist/custom-ethernet-build-image-inspect.json ]] || { printf '%s\n' 'Missing prepared compiler provenance; run explicit online preparation first.' >&2; exit 1; }
install -m0644 dist/custom-ethernet-build-packages.txt dist/custom-ethernet-build-image-inspect.json "$stage/sources/build-provenance/"
base_image=$(python3 -c 'import json;print(json.load(open("images/custom-ethernet/dependencies.lock.json"))["base_image"])')
docker image inspect "$base_image" > "$stage/sources/build-provenance/base-image-inspect.json"

python3 - "$stage" "$image" <<'PY'
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()
identity=json.loads(subprocess.check_output(['docker','image','inspect',sys.argv[2]]))[0]['Id']
manifest=dict(schema_version=1,images=[dict(file='custom-ethernet-image.tar',image=sys.argv[2],image_id=identity,sha256=sha(root/'custom-ethernet-image.tar'))],sources=[dict(file=str(p.relative_to(root)),sha256=sha(p)) for p in sorted((root/'sources').rglob('*')) if p.is_file()])
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
for file in custom-ethernet-image.tar manifest.json; do mv -- "$stage/$file" "$asset_dir/$file"; done
printf 'Custom Ethernet runtime and complete original source/build provenance exported to %s\n' "$asset_dir"
