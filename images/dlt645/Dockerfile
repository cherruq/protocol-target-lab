ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.dlt645-response-schema="1" \
      io.protocol-target-lab.dlt645-client-schema="1" \
      org.opencontainers.image.licenses="MIT AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/dlt645/server.py workers/dlt645/client.py workers/dlt645/common.py workers/dlt645/meter.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-dlt645/LICENSE-wrapper
COPY images/dlt645/Dockerfile images/dlt645/dependencies.lock.json /usr/share/doc/protocol-target-lab-dlt645/build/
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
