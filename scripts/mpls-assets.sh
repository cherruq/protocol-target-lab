#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/mpls-assets}
image=$(python3 -c 'import json;print(json.load(open("images/mpls/dependencies.lock.json"))["image"])')
docker image inspect "$image" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.mpls-export.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/workers/mpls" "$stage/sources/images/mpls" "$stage/sources/scripts" "$stage/sources/docs"
docker save --output "$stage/mpls-image.tar" "$image"
install -m0644 workers/mpls/*.py "$stage/sources/workers/mpls/"
install -m0644 images/mpls/Dockerfile images/mpls/dependencies.lock.json images/mpls/NOTICE "$stage/sources/images/mpls/"
install -m0755 scripts/mpls-{fetch-deps,images,assets}.sh "$stage/sources/scripts/"
install -m0644 docs/mpls*.md "$stage/sources/docs/"
install -m0644 LICENSE "$stage/sources/LICENSE"
python3 - "$stage" "$image" <<'PY'
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()
identity=json.loads(subprocess.check_output(['docker','image','inspect',sys.argv[2]]))[0]['Id']
manifest=dict(schema_version=1,images=[dict(file='mpls-image.tar',image=sys.argv[2],image_id=identity,sha256=sha(root/'mpls-image.tar'))],sources=[dict(file=str(p.relative_to(root)),sha256=sha(p)) for p in sorted((root/'sources').rglob('*')) if p.is_file()])
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
for file in mpls-image.tar manifest.json; do mv -- "$stage/$file" "$asset_dir/$file"; done
printf 'MPLS runtime and complete original source/build provenance exported to %s\n' "$asset_dir"
