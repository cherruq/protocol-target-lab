ARG BUILD_IMAGE=protocol-target-lab/profinet-build-input:locked-34ff223687cc
ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BUILD_IMAGE} AS native-build
COPY third-party/profinet /input/
COPY native/profinet /native/
RUN python3 - <<'PY'
import hashlib,json,pathlib,tarfile
root=pathlib.Path('/source');root.mkdir()
for v in json.load(open('/input/sources.lock.json')):
 p=pathlib.Path('/input')/pathlib.Path(v['file']).name
 assert hashlib.sha256(p.read_bytes()).hexdigest()==v['sha256']
 with tarfile.open(p)as t:t.extractall(root,filter='data')
PY
RUN python3 /native/build.py /source /build && mkdir /out && cp /build/pn_dev /out/pn_native && /out/pn_native --abi > /out/native-abi.json
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.profinet-request-schema="1" io.protocol-target-lab.profinet-response-schema="1" io.protocol-target-lab.profinet-client-schema="1" io.protocol-target-lab.profinet-control-schema="1" io.protocol-target-lab.profinet-observer-schema="1" io.protocol-target-lab.profinet-native-schema="1" io.protocol-target-lab.profinet-native-abi="pnet-v0.2.0-linux-x86_64-v1" org.opencontainers.image.licenses="MIT AND GPL-3.0-only AND BSD-3-Clause AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/profinet/*.py workers/profinet/runtime-contract.json ./
COPY --from=native-build /out/ ./native/
COPY workers/profinet/set_network_parameters ./native/set_network_parameters
COPY third-party/profinet /usr/share/doc/protocol-target-lab-profinet/sources/
COPY native/profinet /usr/share/doc/protocol-target-lab-profinet/native/
COPY images/profinet /usr/share/doc/protocol-target-lab-profinet/build/
COPY LICENSE /usr/share/doc/protocol-target-lab-profinet/LICENSE-wrapper
RUN chmod 755 native/pn_native native/set_network_parameters
USER 0:0
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
