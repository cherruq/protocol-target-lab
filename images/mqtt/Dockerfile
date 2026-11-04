ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG BUILD_IMAGE=protocol-target-lab/mqtt-build:2.0.18
FROM ${BUILD_IMAGE} AS build
WORKDIR /src
COPY third-party/mosquitto/mosquitto-2.0.18.tar.gz ./mosquitto-2.0.18.tar.gz
COPY third-party/mosquitto/patches/ ./patches/
RUN echo 'd665fe7d0032881b1371a47f34169ee4edab67903b2cd2b4c083822823f4448a  mosquitto-2.0.18.tar.gz' | sha256sum -c - \
    && python3 -c "import tarfile; tarfile.open('mosquitto-2.0.18.tar.gz').extractall(filter='data')" \
    && python3 patches/apply.py mosquitto-2.0.18 \
    && make -C mosquitto-2.0.18/src WITH_TLS=no WITH_TLS_PSK=no WITH_CJSON=no WITH_WEBSOCKETS=no WITH_SYSTEMD=no WITH_BRIDGE=no WITH_PERSISTENCE=no WITH_CONTROL=no WITH_DOCS=no \
    && install -D -m 0755 mosquitto-2.0.18/src/mosquitto /out/mosquitto
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.mqtt-response-schema="1" \
      io.protocol-target-lab.mqtt-packet-size="full-v1" \
      io.protocol-target-lab.mosquitto-patches="full-packet-size-v1" \
      io.protocol-target-lab.mqtt-client-schema="1" \
      io.protocol-target-lab.mosquitto-version="2.0.18" \
      org.opencontainers.image.licenses="MIT AND (EPL-2.0 OR BSD-3-Clause) AND BSD-1-Clause"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY --from=build /out/mosquitto /usr/local/sbin/mosquitto
COPY workers/mqtt/server.py workers/mqtt/client.py workers/mqtt/mqtt_wire.py ./
COPY third-party/mosquitto/ /usr/share/doc/protocol-target-lab-mqtt/mosquitto/
COPY images/mqtt/Dockerfile images/mqtt/build.Dockerfile images/mqtt/dependencies.lock.json /usr/share/doc/protocol-target-lab-mqtt/build/
COPY LICENSE /usr/share/doc/protocol-target-lab-mqtt/LICENSE-wrapper
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
