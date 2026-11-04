# DL/T645 workspace acceptance

Manager 0.13.0 provides an autonomous finite DL/T645-2007 software meter over a
TCP serial byte stream. It retains the reference's thirteen software function
classes with their individual permission/addressing rules. It does not claim
1997 compatibility, physical RS485/serial timing/parity, actual relays, energy
measurement, ESAM or cryptographic authentication.

## Configuration and state

Nine fields are required: literal `wire_profile:"dlt645-2007-tcp"`, binding,
port, twelve decimal meter-address digits, startup energy and period, simulated
programming key, connection capacity and tagged security mode. Reject mode has
no extra fields. Fixture mode requires the restricted request DI, fixed response
DI, four-byte operator, eight-byte request and twelve-byte response. Exact
fixture transmission always reports `crypto_verified=false`.

TCP reconnect preserves in-memory state; a fresh worker initializes it from
configuration. Wire address changes, clears and writes may make runtime values
differ from startup values. Health and read-only clients first discover the
actual current address. Programming key is a per-function simulation condition,
not a global read-only switch; public software test passwords start at three
zero bytes for each level. No host clock or physical device is changed.

## Wire and client verification

- Verify actual `68 A6 68 C L DATA CS 16` frames, BCD, little-endian DI, modular
  33H coding and exact checksum. Incremental length framing handles split and
  coalesced requests, FE/noise, data containing 16/68/FE and partial timeouts.
  Malformed or foreign-address frames cannot change software state.
- READ_ADDRESS, READ_DATA, STREAM and ERROR_RESPONSE run twice in ALL. These
  eight checks are read-only. Optional WRITE_PERIOD requires the applied
  programming key, uses the observed current period, and succeeds only after
  verified restoration. Optional SECURITY_FIXTURE requires fixture mode and
  verifies exact transport bytes. Neither optional case is included in ALL.
- Use separate disposable targets for the complete thirteen-function matrix:
  writes, address/password changes, clears, freeze, time guards, software baud,
  control/output and security rejection/fixture. Irreversible operations do not
  run against the shared manual environment or silently inside ALL.
- Software baud commits after the full reply is drained, with serialized state
  transactions. Automatic relay restoration uses real five-minute units; test
  actual elapsed time or explicitly limit the claim to scheduling. Complete
  validation precedes mutation; audit generation/state records are software
  evidence, not authentication or physical measurement.
- Connection capacity measures concurrent use. Repeated valid requests do not
  exhaust a lifetime counter. Bounded buffers, 500 ms partial-frame expiry,
  idle/write deadlines and logs isolate malformed or slow peers. Health and
  clients half-close and await EOF so capacity-one reuse releases its slot.
  Auth/password/fixture payloads and credential arrays are redacted from logs.

The optional python-dlt645 0.1.4 oracle covers only its supported READ/address/CS
subset, with a documented public `load_ctrl(bytes)` adapter. Its original
control-field, modular-byte and delimiter-framing defects are retained as
counterexamples; it is not a thirteen-function meter or runtime dependency.
Independent original byte vectors validate the complete software profile.

## Delivery and compatibility

Build and install the native manager/deb offline for Ubuntu 24.04 amd64. Verify
runtime/source hashes, embedded Web assets, installed CLI/docs, real separate-node
TCP replies, and manager restart adoption retaining the same container/process
and current software state despite pending drafts. Preserve all eight previous
workspaces, configurations, hashes and unrelated running/manual services.

The worker uses original standard-library code and the prepared locked Python
base. A complete OS/compiler source bundle, whole-host reboot, electrical serial
behavior and real security hardware are outside this acceptance phase.
