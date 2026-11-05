ARG BASE_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG BUILD_IMAGE=protocol-target-lab/custom-ethernet-build:1.10.5
FROM ${BUILD_IMAGE} AS native
COPY images/custom-ethernet/vendor/libpcap-1.10.5.tar.xz /build/source.tar.xz
RUN echo '84fa89ac6d303028c1c5b754abff77224f45eca0a94eb1a34ff0aa9ceece3925  /build/source.tar.xz' | sha256sum -c - \
 && cd /build && python3 -m tarfile -e source.tar.xz . && cd libpcap-1.10.5 \
 && ./configure --prefix=/usr/local --disable-dbus --disable-bluetooth --disable-usb --disable-rdma --without-libnl --disable-remote --enable-shared \
 && make -j2 && make DESTDIR=/out install
FROM ${BASE_IMAGE}
LABEL io.protocol-target-lab.custom-ethernet-request-schema="1" \
      io.protocol-target-lab.custom-ethernet-response-schema="1" \
      io.protocol-target-lab.custom-ethernet-client-schema="1" \
      io.protocol-target-lab.custom-ethernet-control-schema="1" \
      io.protocol-target-lab.custom-ethernet-observer-schema="1" \
      io.protocol-target-lab.custom-ethernet-compiler-schema="1" \
      org.opencontainers.image.licenses="MIT AND BSD-3-Clause AND Python-2.0"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/protocol-target-lab
COPY --from=native /out/usr/local/lib/libpcap.so.1.10.5 /usr/local/lib/libpcap.so.1.10.5
COPY workers/custom-ethernet/*.py ./
COPY LICENSE /usr/share/doc/protocol-target-lab-custom-ethernet/LICENSE-wrapper
COPY images/custom-ethernet/ /usr/share/doc/protocol-target-lab-custom-ethernet/build/
USER 0:0
ENTRYPOINT ["python3","-u","/opt/protocol-target-lab/server.py"]
