# Telnet workspace acceptance

Manager 0.8.0 adds a fixed Telnet workspace with Web/CLI configuration,
lifecycle, logs, actual runtime state, restart adoption and same-image
disposable client tests. Image 0.1.0 uses unmodified telnetlib3 4.0.3 and
wcwidth 0.6.0. Its finite ECHO/INFO/CLOSE application provides no system
login, shell, command execution, authentication or encryption.

## Protocol and resource coverage

- An independent byte-oriented client verifies welcome/CLOSE, exact binary
  ECHO, native TTYPE/NAWS/TSPEED/XDISPLOC/NEW_ENVIRON callbacks and rejection
  of unknown WILL/DO options. INFO contains actual session values. AYT is
  explicitly unsupported; no artificial reply is added.
- Literal IAC bytes, fragmented commands and subnegotiation, dynamic window
  changes and native terminal-type loop termination are exercised. Exact
  64/65536 decoded application bytes pass and 65/65537 bytes fail at the
  corresponding limits. A 65536-byte command containing 65531 literal IAC
  bytes also passes when its escaped wire representation arrives in 511-byte
  fragments.
- Empty, unfinished and oversized subnegotiation is isolated to its own
  connection. Negotiation and cumulative environment guards run before native
  buffers/metadata grow beyond their budgets. Sixteen distinct environment
  names are accepted; the seventeenth is rejected. Repeated updates to an
  existing name do not impose a lifetime traffic limit.
- A one-connection service rejects an extra connection and releases the slot
  after CLOSE, including the manager's readiness check. Repeated ALL tests
  pass with one connection, a 64-byte line limit and a 256-byte UTF-8 banner.
  Bounded transport output and client deadlines prevent unbounded output.

## Management and compatibility

- Full and partial configuration reject wrong types, unknown/null fields,
  invalid endpoints, control characters and encoded banner lengths above
  256 bytes. CLI values such as a literal `--help` banner remain values.
- Saving a draft preserves the applied service and test snapshot. Killing
  and restarting the manager adopts the same container, PID and start time;
  only an explicit service restart applies a saved draft.
- Adding Telnet preserves existing HTTP/DNS/MQTT configuration, IDs, hashes
  and containers, including an existing `telnet-demo` ID collision. Disabled
  workspaces remain disabled. Missing/wrong images and port conflicts preserve
  the recognized running service.
- Independent management/wire validation covers 53 assertions with 98 passing
  product-client checks and two expected connection-saturation failures. Web
  validation covers 44 passing client checks across all four protocols,
  including 34 Telnet checks, real logs, drafts and report/session isolation.
  Rust, Web and Python suites pass 32, 28 and 15 tests respectively.

## Delivery boundary

The native binary/deb are compiled offline for Ubuntu 24.04 amd64 and embed the
Web assets. The Telnet runtime/source export contains fixed public wheel and
sdist archives, build recipes and ISC/MIT/CPython license texts and provenance.
The binary's Rust/Web license inventory and the worker's Python materials are
maintained separately. This export is not a complete system/compiler bundle.
Deployment checks use installed CLI/API tests and a separate client node;
existing manual services are preserved. Manager restart recovery is verified;
no whole-host reboot or Docker daemon reconfiguration is claimed.
