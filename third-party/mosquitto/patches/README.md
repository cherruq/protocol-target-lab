# full-packet-size-v1 backport

Mosquitto 2.0.18's inbound max_packet_size check adds only the command byte to
Remaining Length, omitting its encoded byte count. Its outbound MQTT 5 client
Maximum Packet Size check omits the command byte. This permits packets larger
than the advertised/configured complete MQTT packet limit.

These two expressions backport the corresponding upstream fixes by Roger A.
Light, credited upstream to Julian Graf:

- Incoming: https://github.com/eclipse-mosquitto/mosquitto/commit/7a1905006a629f264d3657abf335d09cb5555980 (closes #3515).
- Outgoing: https://github.com/eclipse-mosquitto/mosquitto/commit/3a0f46aa209c4b2d15b36f866b23e9a0df696810 (closes #3503).

The patch remains under upstream's EPL-2.0 OR BSD-3-Clause license. The original
2.0.18 archive is unchanged. The local adaptation uses 2.0.18's already parsed,
positive remaining_count for incoming packets, so it counts actual Remaining
Length wire bytes, including a nonminimal encoding if accepted by the parser.
For canonical packets this is equivalent to upstream's varint-byte helper.
Outgoing packets use the existing packet__varint_bytes function plus one
command byte. No fixed adjustment to the configured limit is made, and no
TLS/authentication or other broker feature is changed.

Run `python3 patches/apply.py mosquitto-2.0.18` after extracting the unchanged
archive, with paths adjusted to the source/build directory. The application
script checks the original source hash, patch hash, exact unified-diff context,
and final source hash, using source.json. The Dockerfile runs this before make.
The image and exported assets include this patch, metadata, application script,
complete original source, license texts, and build recipes.
