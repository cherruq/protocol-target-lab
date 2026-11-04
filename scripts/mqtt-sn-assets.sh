#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
asset_dir=${1:-dist/mqtt-sn-assets}
mapfile -t inputs < <(python3 -c 'import json;x=json.load(open("images/mqtt-sn/dependencies.lock.json"));print(x["image"]);print(x["broker"]["image"]);print(x["broker"]["image_id"])')
image=${inputs[0]};broker_id=$(python3 scripts/mqtt-sn-broker-input.py)
docker image inspect "$image" >/dev/null

mkdir -p "$asset_dir"
stage=$(mktemp -d "$asset_dir/.mqtt-sn-export.XXXXXX")
export_container=
trap 'if [[ -n $export_container ]]; then docker container remove "$export_container" >/dev/null 2>&1 || true; fi; rm -rf -- "$stage"' EXIT
mkdir -p "$stage/sources/third-party/paho-mqtt-sn" "$stage/sources/images/mqtt-sn" "$stage/sources/workers/mqtt-sn" "$stage/sources/workers/mqtt" "$stage/sources/scripts" "$stage/sources/broker" "$stage/sources/build-input"
docker save --output "$stage/mqtt-sn-image.tar" "$image"
# The exact copied binary/source input can be restored for an offline rebuild.
docker save --output "$stage/sources/build-input/broker-input-image.tar" "$broker_id"
for record in mqtt-sn-build-image-inspect.json mqtt-sn-build-packages.txt; do
    if [[ -f dist/$record ]]; then install -m0644 "dist/$record" "$stage/sources/build-input/$record"; fi
done
export_container=$(docker create --network=none --label io.protocol-target-lab.task=mqtt-sn-asset-export --entrypoint /bin/true "$image")
docker cp "$export_container:/usr/share/doc/protocol-target-lab-mqtt-sn/broker/." "$stage/sources/broker/"
docker container remove "$export_container" >/dev/null
export_container=
cp -R -- third-party/paho-mqtt-sn/. "$stage/sources/third-party/paho-mqtt-sn/"
install -m0644 images/mqtt-sn/Dockerfile images/mqtt-sn/build.Dockerfile images/mqtt-sn/dependencies.lock.json "$stage/sources/images/mqtt-sn/"
install -m0644 workers/mqtt-sn/server.py workers/mqtt-sn/client.py workers/mqtt-sn/mqttsn_wire.py workers/mqtt-sn/test_mqttsn.py workers/mqtt-sn/test_broker_input.py "$stage/sources/workers/mqtt-sn/"
install -m0644 workers/mqtt/mqtt_wire.py "$stage/sources/workers/mqtt/"
install -m0755 scripts/mqtt-sn-fetch-deps.sh scripts/mqtt-sn-images.sh scripts/mqtt-sn-assets.sh scripts/mqtt-sn-broker-input.py "$stage/sources/scripts/"
install -m0644 LICENSE "$stage/sources/LICENSE"
mkdir -p "$stage/sources/docs"
install -m0644 docs/mqtt-sn.md "$stage/sources/docs/"
python3 - "$stage" "$image" "$broker_id" <<'PY'
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
images=[]
for file,tag in [('mqtt-sn-image.tar',sys.argv[2])]:
    ident=subprocess.check_output(['docker','image','inspect',tag,'--format','{{.Id}}'],text=True).strip()
    images.append(dict(file=file,image=tag,image_id=ident,sha256=sha(root/file)))
manifest=dict(schema_version=1,images=images,broker_input_image_id=sys.argv[3],sources=[dict(file=str(p.relative_to(root)),sha256=sha(p)) for p in sorted((root/'sources').rglob('*')) if p.is_file()])
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
rm -rf -- "$asset_dir/sources"
mv -- "$stage/sources" "$asset_dir/sources"
for file in mqtt-sn-image.tar manifest.json; do mv -- "$stage/$file" "$asset_dir/$file"; done
printf 'MQTT-SN runtime, exact broker input and complete source/license materials exported to %s\n' "$asset_dir"
