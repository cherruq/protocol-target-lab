ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.mpls-request-schema="1" \
      io.protocol-target-lab.mpls-response-schema="1" \
      io.protocol-target-lab.mpls-client-schema="1" \
      io.protocol-target-lab.mpls-control-schema="1" \
      io.protocol-target-lab.mpls-observer-schema="1" \
      org.opencontainers.image.licenses="MIT AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/mpls/server.py workers/mpls/client.py workers/mpls/mpls_wire.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-mpls/LICENSE-wrapper
COPY images/mpls/Dockerfile images/mpls/dependencies.lock.json images/mpls/NOTICE /usr/share/doc/protocol-target-lab-mpls/build/
USER 0:0
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
