# Build-only tools for the supported native-package baseline.
FROM ubuntu:24.04@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gcc libc6-dev binutils dpkg-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
