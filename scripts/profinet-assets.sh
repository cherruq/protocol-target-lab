#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/profinet-assets}
readarray -t inputs < <(python3 -c 'import json;x=json.load(open("images/profinet/dependencies.lock.json"));print(x["image"]);print(x["build_image"])')
image=${inputs[0]};builder=$(python3 images/profinet/resolve-input.py)
docker image inspect "$image" "$builder" >/dev/null
mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.profinet-export.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/workers/profinet" "$stage/sources/images/profinet" "$stage/sources/native/profinet" "$stage/sources/third-party/profinet" "$stage/sources/scripts" "$stage/sources/docs" "$stage/sources/build-input"
docker save --output "$stage/profinet-image.tar" "$image"
# This is source-build input only, deliberately not in manifest.images/runtime imports.
docker save --output "$stage/sources/build-input/compiler-image.tar" "$builder"
install -m0644 workers/profinet/*.py workers/profinet/runtime-contract.json workers/profinet/set_network_parameters "$stage/sources/workers/profinet/"
install -m0644 images/profinet/* "$stage/sources/images/profinet/"
install -m0644 native/profinet/* "$stage/sources/native/profinet/"
install -m0644 third-party/profinet/* "$stage/sources/third-party/profinet/"
install -m0755 scripts/profinet-{fetch-deps,images,assets}.sh "$stage/sources/scripts/"
install -m0644 docs/profinet.md "$stage/sources/docs/"
install -m0644 LICENSE "$stage/sources/LICENSE"
python3 - "$stage" "$image" "$builder" <<'PY'
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
identity=json.loads(subprocess.check_output(['docker','image','inspect',sys.argv[2]]))[0]['Id']
input_inspect=json.loads(subprocess.check_output(['docker','image','inspect',sys.argv[3]]))[0]
(root/'sources/build-input/compiler-image-inspect.json').write_text(json.dumps(input_inspect,indent=2)+'\n')
manifest={'schema_version':1,'images':[{'file':'profinet-image.tar','image':sys.argv[2],'image_id':identity,'sha256':sha(root/'profinet-image.tar')}],'sources':[{'file':str(p.relative_to(root)),'sha256':sha(p)}for p in sorted((root/'sources').rglob('*'))if p.is_file()]}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
for file in profinet-image.tar manifest.json; do mv -- "$stage/$file" "$asset_dir/$file"; done
printf 'PROFINET runtime and complete native/wrapper/build-input provenance exported to %s\n' "$asset_dir"
