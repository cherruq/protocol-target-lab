#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mkdir -p build dist/http-assets
stage=$(mktemp -d "$project_root/build/http-assets.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
docker image inspect protocol-target-lab/http:0.3.0 > /dev/null
docker save --output "$stage/http-image.tar" protocol-target-lab/http:0.3.0
digest=$(sha256sum "$stage/http-image.tar")
digest=${digest%% *}
printf '{"schema_version":1,"images":[{"file":"http-image.tar","sha256":"%s","image":"protocol-target-lab/http:0.3.0"}]}\n' "$digest" > "$stage/manifest.json"
mv "$stage/http-image.tar" dist/http-assets/http-image.tar
mv "$stage/manifest.json" dist/http-assets/manifest.json
printf '%s\n' 'Exported dist/http-assets/; import with plabctl assets import <directory>.'
