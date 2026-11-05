#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/igmp-assets}
image=$(python3 -c 'import json;print(json.load(open("images/igmp/dependencies.lock.json"))["image"])')
docker image inspect "$image" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.igmp-export.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/workers/igmp" "$stage/sources/images/igmp" "$stage/sources/scripts" "$stage/sources/docs" "$stage/sources/client-tools"
docker save --output "$stage/igmp-image.tar" "$image"
install -m0644 workers/igmp/*.py "$stage/sources/workers/igmp/"
install -m0644 images/igmp/Dockerfile images/igmp/dependencies.lock.json images/igmp/NOTICE "$stage/sources/images/igmp/"
install -m0755 scripts/igmp-{fetch-deps,images,assets}.sh "$stage/sources/scripts/"
install -m0644 docs/igmp*.md "$stage/sources/docs/"
install -m0644 client-tools/igmp_link.py client-tools/test_igmp_link.py "$stage/sources/client-tools/"
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
manifest=dict(schema_version=1,images=[dict(file='igmp-image.tar',image=sys.argv[2],image_id=identity,sha256=sha(root/'igmp-image.tar'))],sources=[dict(file=str(p.relative_to(root)),sha256=sha(p)) for p in sorted((root/'sources').rglob('*')) if p.is_file()])
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
for file in igmp-image.tar manifest.json; do mv -- "$stage/$file" "$asset_dir/$file"; done
printf 'IGMP runtime and complete original source/build provenance exported to %s\n' "$asset_dir"
