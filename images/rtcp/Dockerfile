ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.rtcp-response-schema="1" \
      io.protocol-target-lab.rtcp-client-schema="1" \
      io.protocol-target-lab.rtcp-observer-schema="1" \
      org.opencontainers.image.licenses="MIT AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/rtcp/server.py workers/rtcp/client.py workers/rtcp/rtcp_wire.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-rtcp/LICENSE-wrapper
COPY images/rtcp/Dockerfile images/rtcp/dependencies.lock.json /usr/share/doc/protocol-target-lab-rtcp/build/
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
