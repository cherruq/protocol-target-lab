ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
COPY third-party/telnetlib3/*.whl /deps/
COPY images/telnet/requirements.lock /deps/requirements.lock
RUN python3 -m pip install --no-cache-dir --no-index --no-deps --require-hashes --find-links=/deps --target=/opt/deps -r /deps/requirements.lock
