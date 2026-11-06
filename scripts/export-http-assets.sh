#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
mkdir -p build dist/http-assets
stage=$(mktemp -d "$project_root/build/http-assets.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
docker image inspect protocol-target-lab/http:0.4.0 > /dev/null
docker save --output "$stage/http-image.tar" protocol-target-lab/http:0.4.0
mkdir -p "$stage/sources/http" "$stage/sources/tls" "$stage/sources/build" "$stage/sources/public-tests"
install -m 0644 workers/http/server.py workers/http/client.py workers/http/scenarios.py "$stage/sources/http/"
install -m 0644 workers/tls/lab.crt workers/tls/lab.key workers/tls/README.md "$stage/sources/tls/"
install -m 0644 images/http/Dockerfile images/http/base-image.lock "$stage/sources/build/"
install -m 0644 public-tests/http_smoke.py "$stage/sources/public-tests/"
install -m 0644 LICENSE "$stage/sources/"
digest=$(sha256sum "$stage/http-image.tar")
digest=${digest%% *}
python3 - "$stage" "$digest" <<'PYMANIFEST'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1])
m={'schema_version':1,'images':[{'file':'http-image.tar','sha256':sys.argv[2],'image':'protocol-target-lab/http:0.4.0'}],'sources':[{'file':str(f.relative_to(p)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted((p/'sources').rglob('*')) if f.is_file()]}
(p/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
PYMANIFEST
rm -rf -- dist/http-assets/sources
mv "$stage/sources" dist/http-assets/sources
mv "$stage/http-image.tar" dist/http-assets/http-image.tar
mv "$stage/manifest.json" dist/http-assets/manifest.json
printf '%s\n' 'Exported dist/http-assets/; import with plabctl assets import <directory>.'
