# Public base identity is also recorded in images/http/base-image.lock.
ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY workers/http/server.py ./server.py
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
