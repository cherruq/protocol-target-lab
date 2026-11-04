ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG BUILD_IMAGE=protocol-target-lab/telnet-build:4.0.3
FROM ${BUILD_IMAGE} AS dependencies
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.telnet-response-schema="1" \
      io.protocol-target-lab.telnet-client-schema="1" \
      io.protocol-target-lab.telnetlib3-version="4.0.3" \
      org.opencontainers.image.licenses="MIT AND ISC AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/deps
WORKDIR /opt/protocol-target-lab
COPY --from=dependencies /opt/deps/ /opt/deps/
COPY workers/telnet/server.py workers/telnet/client.py workers/telnet/telnet_wire.py ./
COPY third-party/telnetlib3/ /usr/share/doc/protocol-target-lab-telnet/dependencies/
COPY images/telnet/Dockerfile images/telnet/build.Dockerfile images/telnet/dependencies.lock.json images/telnet/requirements.lock /usr/share/doc/protocol-target-lab-telnet/build/
COPY LICENSE /usr/share/doc/protocol-target-lab-telnet/LICENSE-wrapper
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
