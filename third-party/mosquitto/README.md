# Eclipse Mosquitto 2.0.18 source and notices

The unmodified official archive comes from
https://mosquitto.org/files/source/mosquitto-2.0.18.tar.gz ; SHA-256:
`d665fe7d0032881b1371a47f34169ee4edab67903b2cd2b4c083822823f4448a`.

Mosquitto is Copyright (c) Roger Light and other upstream contributors, as
identified in the complete source archive. LICENSE.txt describes the upstream
dual license: Eclipse Public License 2.0 or Eclipse Distribution License 1.0
(the latter corresponds to BSD-3-Clause). Both texts, edl-v10 and epl-v20, are
included unchanged. The broker uses bundled uthash and utlist; their BSD-style notices are
reproduced in UTHASH-LICENSE.txt and UTLIST-LICENSE.txt. The full upstream archive also contains all
other upstream headers, notices, and documentation. The original archive is unchanged; the image applies the explicit
full-packet-size-v1 backport in patches/, with two upstream commit references,
exact diff, original/patch/result hashes, and application script.

images/mqtt/Dockerfile records the exact broker-only build, patch application, and feature flags.
images/mqtt/build.Dockerfile prepares gcc/libc6-dev/make on the same fixed
Debian bookworm Python base. No TLS, websockets, authentication plugin, bridge,
control topic, or persistence feature is enabled in this lab image. The
runtime image embeds this directory and build materials under
/usr/share/doc/protocol-target-lab-mqtt/. scripts/mqtt-assets.sh also exports
these complete materials alongside the saved image. Preserve upstream notices
and license conditions when redistributing. Project Python wrappers and client
are MIT licensed; base-image components retain their respective licenses.
