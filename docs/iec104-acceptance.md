# IEC104 workspace acceptance

Manager 0.9.0 provides Web/CLI configuration, real Docker state, lifecycle,
logs, restart adoption and same-image disposable tests. IEC104 image0.1.1 runs
c1042.2.1 rebuilt from its complete public source with the project compatibility
patch described below. The workspace models three fixed in-memory roles, with
editable addresses and startup values. It provides plain TCP, rather than TLS,
physical actuation, reset services, selectable command families or SBO.

## Native TCP framing correction

The original upstream wheel's bundled lib60870 receiver disconnects if TCP
delivers only the start byte0x68 before the length byte. Independent raw sockets
with TCP_NODELAY and explicit50ms delays reproduce the failure. Complete frames,
splits after the length byte and coalesced frames pass the same control test.
The native library's newer C source has the same receiver path, so changing the
Python wrapper alone would not fix it. Image0.1.0 remains a failing fixture and
is not deployed as the workspace runtime.

The minimal project patch retains recvBufPos=1 when the nonblocking length read
returns zero, waiting for subsequent data. A negative read still closes the
connection. The Linux HAL maps EAGAIN to zero and EOF/error to negative. Other
APCI/ASDU, sequence, timing, command and confirmation logic stays native. This
is an original project correction, not an upstream backport or Python TCP proxy.

[Patch provenance and exact application](../third-party/iec104/patches/README.md)
include original/patch/result SHA-256 and an application script that rejects
source drift, context mismatch and repeat application. The runtime uses the
patched source-rebuilt wheel, with its generated hash-locked requirements and
build manifest. Startup and adoption require the incremental-v1 image capability;
existing HTTP/DNS/MQTT/Telnet fingerprints and compatibility remain separate.

## Protocol and state evidence

- CONNECT verifies native STARTDT, TESTFR and STOPDT confirmations. Independent
  checks exercise fragmented/coalesced U/I/S frames, sequence acknowledgements,
  connection limits and release, and bounded malformed traffic.
- GI covers every configured station, including a station containing only the
  command point. It requires COT7 confirmation, exactly the configured monitoring
  data with COT20, and COT10 termination; command points are not monitoring data.
- READ requires the actual typed/addressed monitoring object with COT5. This
  c104 version also sends a native C_RD_NA_1 COT7 confirmation. The client checks
  both independently, in either order, and never treats confirmation as a value.
- DIRECT C_SC_NA_1 COT6 receives native COT7. The callback changes only the mapped
  single point's simulated memory. COMMAND reads the prior current value, flips
  it, verifies READ/GI effects, and finally restores and verifies the prior value.
  Restoration has reserved time within the total deadline and failure makes the
  test fail. No command ACT_TERM is invented.
- Configuration contains startup values, not live telemetry. A legitimate
  command can change a single value without changing saved/applied configuration.
  Readiness checks a real ASDU/address/quality, and recovery adopts the existing
  runtime state without comparing it to the initial boolean.

## Management and delivery boundary

Configuration uses strict full/partial validation, unique(CA,IOA) addresses,
finite float32 measurements and bounded connections. The wire measurement is
rounded to float32; JSON boolean and integer types are checked separately.
Saved drafts apply only on explicit service operations. Adding the disabled
workspace preserves old IDs, deployment ownership, snapshots, hashes and running
containers, including a default-ID collision. Missing/incompatible images and
port conflicts must preserve recognized old services.

The binary/deb embed Web assets and use the Ubuntu24.04 amd64 baseline. Original
source archives, the unchanged public wheel for provenance, the explicit patch,
complete bundled dependency notices and offline source-build recipes accompany
the image and exported assets. Runtime compilation has no network. Preparing a
compiler cache is a separate online step; this export is not a complete clean
machine system/compiler bundle. Installed CLI/API and separate-node tests cover
deployment; manager restart is distinct from a whole-host reboot. Existing manual
services and host networking are preserved.
