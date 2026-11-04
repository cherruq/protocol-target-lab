ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG BUILD_IMAGE=protocol-target-lab/iec104-build:2.2.1
FROM ${BUILD_IMAGE} AS source-build
COPY third-party/iec104/c104-2.2.1.tar.gz /src/c104-2.2.1.tar.gz
COPY third-party/iec104/patches/ /src/patches/
ENV CMAKE_GENERATOR="Unix Makefiles" CMAKE_BUILD_PARALLEL_LEVEL=2
RUN echo 'd1b427f94cd0eeef376020a250ea0e7deb97ac33df5ee4908c7b20452cc8bb23  /src/c104-2.2.1.tar.gz' | sha256sum -c - \
    && python3 -c "import tarfile; tarfile.open('/src/c104-2.2.1.tar.gz').extractall('/src',filter='data')" \
    && python3 /src/patches/apply.py /src/c104-2.2.1 \
    && python3 -m pip wheel --no-index --no-deps --no-build-isolation --wheel-dir=/out /src/c104-2.2.1 \
    && python3 -c "import hashlib,json,pathlib; p=next(pathlib.Path('/out').glob('*.whl')); h=hashlib.sha256(p.read_bytes()).hexdigest(); pathlib.Path('/out/source-build.json').write_text(json.dumps({'file':p.name,'sha256':h,'network':'none','patch':'cs104-incremental-length-read-v1','runtime':'this patched source-rebuilt wheel'})+'\n'); pathlib.Path('/out/runtime-requirements.lock').write_text('c104==2.2.1 --hash=sha256:'+h+'\n')"
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.iec104-response-schema="1" \
      io.protocol-target-lab.iec104-client-schema="1" \
      io.protocol-target-lab.iec104-stream-framing="incremental-v1" \
      io.protocol-target-lab.c104-patches="cs104-incremental-length-read-v1" \
      io.protocol-target-lab.c104-version="2.2.1" \
      org.opencontainers.image.licenses="MIT AND GPL-3.0-only AND Apache-2.0 AND BSD-3-Clause"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/deps
COPY --from=source-build /out/ /deps/
RUN python3 -m pip install --no-cache-dir --no-index --no-deps --require-hashes --find-links=/deps --target=/opt/deps -r /deps/runtime-requirements.lock
WORKDIR /opt/protocol-target-lab
COPY workers/iec104/server.py workers/iec104/client.py workers/iec104/iec104_wire.py workers/iec104/iec104_config.py ./
COPY third-party/iec104/ /usr/share/doc/protocol-target-lab-iec104/dependencies/
COPY images/iec104/Dockerfile images/iec104/build.Dockerfile images/iec104/dependencies.lock.json images/iec104/requirements.lock images/iec104/build-requirements.lock /usr/share/doc/protocol-target-lab-iec104/build/
COPY --from=source-build /out/source-build.json /out/runtime-requirements.lock /usr/share/doc/protocol-target-lab-iec104/build/
COPY LICENSE /usr/share/doc/protocol-target-lab-iec104/LICENSE-wrapper
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
