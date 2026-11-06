# Public base identity is also recorded in images/http/base-image.lock.
ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.tls-scenarios="1"
LABEL io.protocol-target-lab.http-response-schema="2"
LABEL io.protocol-target-lab.http-client-schema="1"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/http/server.py workers/http/scenarios.py ./
COPY workers/tls/ ./tls/
COPY workers/http/client.py ./client.py
COPY public-tests/http_smoke.py ./http_smoke.py
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
