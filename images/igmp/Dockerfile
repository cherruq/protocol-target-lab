ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.igmp-membership-schema="1" \
      io.protocol-target-lab.igmp-request-schema="1" \
      io.protocol-target-lab.igmp-response-schema="1" \
      io.protocol-target-lab.igmp-client-schema="1" \
      io.protocol-target-lab.igmp-control-schema="1" \
      io.protocol-target-lab.igmp-observer-schema="1" \
      org.opencontainers.image.licenses="MIT AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/igmp/server.py workers/igmp/client.py workers/igmp/igmp_wire.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-igmp/LICENSE-wrapper
COPY images/igmp/Dockerfile images/igmp/dependencies.lock.json images/igmp/NOTICE /usr/share/doc/protocol-target-lab-igmp/build/
USER 0:0
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
