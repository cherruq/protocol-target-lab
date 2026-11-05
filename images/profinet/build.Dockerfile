# Online preparation recipe for public compiler tools. Release offline builds use
# the exact content-locked prepared input archived in sources/build-input.
ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
FROM ${BASE_IMAGE}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends g++ libc6-dev make cmake libssl-dev && rm -rf /var/lib/apt/lists/*
