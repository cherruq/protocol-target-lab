# DNS phase verification

Manager 0.6.0 adds a fixed DNS workspace beside HTTP. DNS image 0.1.0 contains
real dnsmasq 2.90 and a separate read-only client. Source review and actual
Docker/API/CLI/browser validation were performed independently of implementation.

## Verified behavior

- Saved and applied configurations remain separate. Web and CLI operate on the
  same workspace; switching protocols preserves unsaved Web drafts.
- UDP and TCP return configured A/AAAA RRsets with correct transaction IDs,
  questions and TTLs. Unknown names return NXDOMAIN, and missing types at known
  names return NODATA. TCP uses its two-byte length prefix.
- Both transport switches affect host port publication. Opposite-transport port
  conflicts and missing/incompatible assets are detected before stopping the
  recognized existing worker. Invalid configurations leave persisted bytes intact.
- Clients run as disposable containers from the same image, retain bounded
  structured pass/fail reports and clean up their containers. Tests use the
  applied snapshot and detect target replacement. Web reports a result replaced
  by a subsequent CLI test without leaving its controls locked.
- Maximum-length names, 16-address AAAA RRsets, TTL 0/86400 and 32 distinct
  maximum-length names were exercised using actual dnsmasq. Both the A and AAAA
  maximum configurations passed 260 client checks within the 512 KiB report cap.
  Large UDP checks use EDNS0; a classic 512-byte query can receive truncation.
- Unexpected manager termination preserves and adopts existing container ID,
  startup time and PID without applying a saved draft. Disabled targets stay
  disabled. Old-session cleanup was tested with an explicitly injected owned
  test-container fixture, not presented as a real in-flight client interruption.
- A real 0.5.1 HTTP deployment was upgraded with a legacy body/custom ID, including
  a deliberate collision with the default DNS workspace ID. The original HTTP
  JSON, fingerprint, deployment marker and running container were preserved.
  Corrupt, duplicate and mismatched-ownership documents remain diagnostic-only.

The independent management/fault runs passed 38 assertions, including 13 HTTP
migration assertions. DNS additionally received 18 independently encoded/decoded
wire queries, alongside the product client's regular, large-RRset and maximum
configuration tests. These counts refer to different validation layers.

## Delivery boundary

The native binary and deb are built offline on Ubuntu 24.04 amd64 with embedded
Web assets. The DNS runtime asset export includes the full unmodified dnsmasq
source, GPL license texts and build recipes; it is not a complete nine-protocol
offline source/compiler distribution. HTTP image 0.3.0 remains unchanged.

Built-in client tests run on the management host. A separate cross-node client
run is required to establish reachability from another machine. Existing manual
protocol services, the host resolver and unrelated containers are preserved.
Other protocol families, IEC101 dual-channel implementation and whole-host reboot
acceptance remain later milestones.
