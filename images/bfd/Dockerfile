ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.bfd-response-schema="1" \
      io.protocol-target-lab.bfd-client-schema="1" \
      io.protocol-target-lab.bfd-control-schema="1" \
      io.protocol-target-lab.bfd-observer-schema="1" \
      org.opencontainers.image.licenses="MIT AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/bfd/server.py workers/bfd/client.py workers/bfd/bfd_wire.py workers/bfd/state.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-bfd/LICENSE-wrapper
COPY images/bfd/Dockerfile images/bfd/dependencies.lock.json /usr/share/doc/protocol-target-lab-bfd/build/
USER 0:0
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
