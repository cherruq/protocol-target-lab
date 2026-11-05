ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.arp-client-request-schema="1" \
      io.protocol-target-lab.arp-client-response-schema="1" \
      io.protocol-target-lab.arp-client-client-schema="1" \
      io.protocol-target-lab.arp-client-control-schema="1" \
      io.protocol-target-lab.arp-client-observer-schema="1" \
      org.opencontainers.image.licenses="MIT AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/arp-client/server.py workers/arp-client/client.py workers/arp-client/arp_wire.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-arp-client/LICENSE-wrapper
COPY images/arp-client/Dockerfile images/arp-client/dependencies.lock.json images/arp-client/NOTICE /usr/share/doc/protocol-target-lab-arp-client/build/
USER 0:0
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
