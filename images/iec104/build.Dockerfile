ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends g++ libc6-dev make cmake ninja-build && rm -rf /var/lib/apt/lists/*
COPY third-party/iec104/setuptools-*.whl third-party/iec104/wheel-*.whl /deps/
COPY images/iec104/build-requirements.lock /deps/requirements.lock
RUN python3 -m pip install --no-cache-dir --no-index --no-deps --require-hashes --find-links=/deps -r /deps/requirements.lock
