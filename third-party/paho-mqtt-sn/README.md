# Eclipse Paho MQTT-SN gateway source

The complete, unmodified upstream archive is pinned to commit
`e1e1b733e0fecef6bed92798d7f6d6440d9026f2` of
[eclipse-paho/paho.mqtt-sn.embedded-c](https://github.com/eclipse-paho/paho.mqtt-sn.embedded-c/tree/e1e1b733e0fecef6bed92798d7f6d6440d9026f2).
The gateway identifies as 1.5.1; this is not the separate embedded-client version.
`images/mqtt-sn/dependencies.lock.json` records the archive URL and SHA-256.

LICENSE, NOTICE, epl-v20, edl-v10, about.html and notice.html are verbatim
upstream materials. Source-file copyright and older dual-license headers remain
inside the original archive. The upstream distribution declares EPL-2.0 or
Eclipse Distribution License 1.0 (BSD-3-Clause); redistribution retains the
complete archive and notices, including the BSD option applicable to older
EPL-1.0/EDL-1.0 headers.

`images/mqtt-sn/Dockerfile` builds the real UDP gateway and its shared
MQTTSNPacket library with `-DSENSORNET=udp -DCMAKE_BUILD_TYPE=Release`.
The independent Python image base and compiler preparation are locked separately.
The one original project native capacity patch is documented in `patches/`;
its applier verifies original/patch/result hashes before the offline build.
It is not an upstream backport. Native DEBUG_NW is not enabled. Native CSV parsing is retained; supported
predefined topic configuration is deliberately restricted to visible ASCII
without whitespace, commas or wildcard characters.

The independent runtime also contains the project's previously verified
Mosquitto 2.0.18/full-v1 binary, source, two upstream backports and complete
notices, copied from the content-locked input image recorded in the lock (complete RootFS/Config
fingerprint and known engine-specific IDs). Its sources
are available in the runtime under `broker/` alongside this directory, and in
exported MQTT-SN assets. No running MQTT workspace is required.
