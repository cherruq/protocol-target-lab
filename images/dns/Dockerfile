ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG BUILD_IMAGE=protocol-target-lab/dns-build:2.90
FROM ${BUILD_IMAGE} AS build
WORKDIR /src
COPY third-party/dnsmasq/dnsmasq-2.90.tar.xz ./dnsmasq-2.90.tar.xz
RUN echo '8e50309bd837bfec9649a812e066c09b6988b73d749b7d293c06c57d46a109e4  dnsmasq-2.90.tar.xz' | sha256sum -c - \
    && python3 -c "import tarfile; tarfile.open('dnsmasq-2.90.tar.xz').extractall(filter='data')" \
    && make -C dnsmasq-2.90 COPTS='-DNO_DHCP -DNO_TFTP -DNO_SCRIPT -DNO_AUTH -DNO_IPSET -DNO_LOOP -DNO_DUMPFILE -DNO_INOTIFY' \
    && install -D -m 0755 dnsmasq-2.90/src/dnsmasq /out/dnsmasq
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.tls-scenarios="1"
LABEL io.protocol-target-lab.dns-response-schema="1" \
      io.protocol-target-lab.dns-client-schema="1" \
      io.protocol-target-lab.dnsmasq-version="2.90" \
      org.opencontainers.image.licenses="MIT AND (GPL-2.0-only OR GPL-3.0-only)"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY --from=build /out/dnsmasq /usr/local/sbin/dnsmasq
COPY workers/dns/*.py ./
COPY workers/dns/fixtures/ ./fixtures/
COPY workers/tls/ ./tls/
COPY third-party/dnsmasq/ /usr/share/doc/protocol-target-lab-dns/dnsmasq/
COPY images/dns/Dockerfile images/dns/build.Dockerfile images/dns/dependencies.lock.json /usr/share/doc/protocol-target-lab-dns/build/
COPY LICENSE /usr/share/doc/protocol-target-lab-dns/LICENSE-wrapper
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
