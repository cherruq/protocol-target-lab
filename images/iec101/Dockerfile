ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG BUILD_IMAGE=protocol-target-lab/iec101-build:2.4.1
FROM ${BUILD_IMAGE} AS native-build
COPY third-party/lib60870 /source/dependencies
COPY workers/iec101/native_slave.c /source/native_slave.c
RUN python3 -c 'import json,hashlib,pathlib; x=json.load(open("/source/dependencies/source.json")); p=pathlib.Path("/source/dependencies")/pathlib.Path(x["file"]).name; assert hashlib.sha256(p.read_bytes()).hexdigest()==x["sha256"]' \
    && mkdir /source/upstream \
    && tar -xzf /source/dependencies/lib60870-*.tar.gz --strip-components=1 -C /source/upstream \
    && cd /source/upstream/lib60870-C && make -j2 lib \
    && gcc -std=gnu99 -O2 -Wall -Wextra -Werror -I src/inc/api -I src/hal/inc -I src/common/inc -I config /source/native_slave.c build/liblib60870.a -lpthread -o /source/native_slave
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.iec101-response-schema="1" \
      io.protocol-target-lab.iec101-client-schema="1" \
      io.protocol-target-lab.iec101-dual-schema="1" \
      org.opencontainers.image.licenses="MIT AND GPL-3.0-or-later AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY --from=native-build /source/native_slave ./native_slave
COPY workers/iec101/server.py workers/iec101/common.py workers/iec101/client.py ./
COPY workers/iec101/native_slave.c /usr/share/doc/protocol-target-lab-iec101/source/native_slave.c
COPY third-party/lib60870 /usr/share/doc/protocol-target-lab-iec101/source/dependencies/
COPY LICENSE /usr/share/doc/protocol-target-lab-iec101/LICENSE-python
COPY images/iec101 /usr/share/doc/protocol-target-lab-iec101/build/
USER 65532:65532
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
