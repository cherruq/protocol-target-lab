ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG BUILD_IMAGE=protocol-target-lab/mqtt-sn-build:1.5.1
ARG BROKER_IMAGE=protocol-target-lab/mqtt:0.1.1
FROM ${BUILD_IMAGE} AS native-build
COPY third-party/paho-mqtt-sn/paho-mqtt-sn-e1e1b733.tar.gz /src/paho.tar.gz
COPY third-party/paho-mqtt-sn/patches /src/patches
RUN echo '948df5e211017f02f56ceea934c00b7b11465f30b1fe9d46257ed9cc5411c472  /src/paho.tar.gz' | sha256sum -c - \
    && python3 -c "import tarfile; tarfile.open('/src/paho.tar.gz').extractall('/src',filter='data')" \
    && python3 /src/patches/apply.py /src/paho.mqtt-sn.embedded-c-e1e1b733e0fecef6bed92798d7f6d6440d9026f2 \
    && cmake -S /src/paho.mqtt-sn.embedded-c-e1e1b733e0fecef6bed92798d7f6d6440d9026f2 -B /build -DSENSORNET=udp -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /build --target MQTT-SNGateway -j2 \
    && install -D -m0755 /src/paho.mqtt-sn.embedded-c-e1e1b733e0fecef6bed92798d7f6d6440d9026f2/MQTTSNGateway/bin/MQTT-SNGateway /out/MQTT-SNGateway \
    && install -D -m0755 /build/MQTTSNPacket/src/libMQTTSNPacket.so /out/libMQTTSNPacket.so
FROM ${BROKER_IMAGE} AS broker
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.mqtt-sn-response-schema="1" \
      io.protocol-target-lab.mqtt-sn-client-schema="1" \
      io.protocol-target-lab.mqtt-sn-register-capacity="bounded-v1" \
      io.protocol-target-lab.paho-mqtt-sn-version="1.5.1" \
      io.protocol-target-lab.mqtt-sn-broker-packet-size="full-v1" \
      org.opencontainers.image.licenses="MIT AND (EPL-2.0 OR BSD-3-Clause) AND BSD-1-Clause AND Apache-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=native-build /out/MQTT-SNGateway /usr/local/sbin/MQTT-SNGateway
COPY --from=native-build /out/libMQTTSNPacket.so /usr/local/lib/libMQTTSNPacket.so
COPY --from=broker /usr/local/sbin/mosquitto /usr/local/sbin/mosquitto
COPY --from=broker /usr/share/doc/protocol-target-lab-mqtt/ /usr/share/doc/protocol-target-lab-mqtt-sn/broker/
WORKDIR /opt/protocol-target-lab
COPY workers/mqtt-sn/server.py workers/mqtt-sn/client.py workers/mqtt-sn/mqttsn_wire.py ./
COPY workers/mqtt/mqtt_wire.py ./mqtt_wire.py
COPY third-party/paho-mqtt-sn/ /usr/share/doc/protocol-target-lab-mqtt-sn/paho/
COPY images/mqtt-sn/Dockerfile images/mqtt-sn/build.Dockerfile images/mqtt-sn/dependencies.lock.json /usr/share/doc/protocol-target-lab-mqtt-sn/build/
COPY scripts/mqtt-sn-broker-input.py /usr/share/doc/protocol-target-lab-mqtt-sn/build/
COPY LICENSE /usr/share/doc/protocol-target-lab-mqtt-sn/LICENSE-wrapper
RUN mkdir -p /run/protocol-target-lab/mqtt-sn && chown -R 65532:65532 /run/protocol-target-lab \
    && ldconfig && test -x /usr/bin/stdbuf && ldd /usr/local/sbin/MQTT-SNGateway \
    && ! ldd /usr/local/sbin/MQTT-SNGateway | grep "not found"
USER 65532:65532
ENTRYPOINT ["python3", "-u", "/opt/protocol-target-lab/server.py"]
