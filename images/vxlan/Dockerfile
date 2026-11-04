ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.vxlan-response-schema="1" \
      io.protocol-target-lab.vxlan-client-schema="1" \
      io.protocol-target-lab.vxlan-control-schema="1" \
      io.protocol-target-lab.vxlan-observer-schema="1" \
      org.opencontainers.image.licenses="MIT AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/vxlan/server.py workers/vxlan/client.py workers/vxlan/vxlan_wire.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-vxlan/LICENSE-wrapper
COPY images/vxlan/Dockerfile images/vxlan/dependencies.lock.json images/vxlan/NOTICE /usr/share/doc/protocol-target-lab-vxlan/build/
USER 0:0
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
