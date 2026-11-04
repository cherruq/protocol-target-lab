# IEC101 dual-channel acceptance scope

Manager0.14.0 and IEC101 image0.1.0 provide one fixed workspace containing two
simultaneous, independent unbalanced IEC101 software serial channels. This
scope requires actual native lib60870-C2.4.1 through raw PTY/TCP byte streams;
Python must not synthesize link responses or substitute an IEC104 server.
The criteria below distinguish worker proof from manager, package, test-host
helper and separate-node acceptance. They are not a whole-host reboot or physical
serial certification claim.

## Profiles and native interaction

The single channel uses link/COT/CA/IOA widths1/1/1/1 with default link1, CA1,
OA absent on wire. The double channel uses2/2/2/3 with default link4660, CA513,
OA7. Both must run at once, have independently editable finite addresses/points
and different published TCP ports, and remain in one saved/applied snapshot.
The software serial request is fixed9600/8N1; point values are strict booleans.
Older workspace shapes/fingerprints must remain unchanged.

Native Reset, Status, shared FCB state, class1/class2 queue polls and configured
M_SP_NA_1 data must pass on both channels. Legal E5 and fixed replies are
interpreted according to configuration and actual ACD/DFC, not treated as
application success. GI requires native Type100/COT7, configured M_SP/COT20
and Type100/COT10, including correct address widths, CA/OA/IOA and quality.
The startup spontaneous COT3 sample cannot stand in for GI COT20 data.

The same-image independent master runs RESET_STATUS, CLASS2, GI and STREAM twice
per selected channel. ALL/dual gives16 checks and concurrent independent
sessions. Include maximal finite addresses/IOA, false points, E5 enabled/disabled,
FCB duplicate cached replay, byte fragmentation inside the native deadline,
coalesced frames and cross-channel isolation. Each phase has an absolute3s
budget, full client30s and report512KiB, with bounded raw traces.

The pinned native parser's tested tolerance for changed inner/end marker bytes
and its finite character-read budget are documented in the protocol guide.
Preserve original raw counterexamples; do not hide these behaviors using bridge
filters, fabricated negative replies or an unreported native patch. Software
rejection/timing results must describe what the actual native stack did.

## Lifecycle and resource ownership

One owned container exposes only the two configured TCP publications and retains
all private PTYs/native children internally. Each channel admits one master;
second clients are rejected promptly. Normal close/half-close drains bounded
responses, reaps only its own native child, closes PTY FDs and releases the slot
before EOF; an active opposite channel remains usable. Unexpected native or
critical supervisor failure stops/reaps the entire group with nonzero exit.
SIGTERM must finish with all children reaped and no stale listeners.

Verify native-ready startup barriers, finite64KiB directional queues,3s drains,
256-entry logs,4096-byte native lines, repeated connection FD stability and no
lifetime request/session quota. Manager restart must adopt the same source CID
and both live sessions/children rather than replacing them. Full applied identity,
both mappings and required image capabilities must be checked before/after tests.
Second-port conflicts and incompatible images must preserve the old dual target.
Restart/crash recovery restores the applied pair rather than a pending draft.

Worker-level validation completed for the frozen image includes14 Python unit
tests, default16 checks, two boundary configurations with16 checks each, five
consecutive ALL runs with80 checks, native crash exit1 and clean SIGTERM exit0.
Twenty short sessions returned the supervisor to its original FD count; a
22-session lifecycle run reaped all22 children. These worker facts alone do not
claim that package installation, a remote byte path or a test program's device
namespace has been verified.

## Test-host PTY helper

Run the installed optional `plabctl serial` helper on the host of the application
that opens serial devices. Both stable root-owned paths must coexist:
`/run/protocol-target-lab/serial/iec101-a` and `iec101-b`. Check root-owned0755
parent directories, root-owned exact-identity symlinks (symlink modes do not govern
access), PTY root:dialout0660, private state/control socket, process identity
and exact ownership guards. Do not follow user-controlled/tmp links, weaken
protected-symlink policy, kill unrelated PIDs or assume host stat proves visibility
inside a private devpts namespace.

Acceptance requires a real root consumer opening both stable paths and exchanging
native frames over both published TCP endpoints. Verify disconnect affects only
one channel; offline bytes are dropped and never replayed; same-config explicit
start reconnects only disconnected channels; target changes require stop/start.
Stop removes only owned links/state/socket and reaps its helper. Coordination
lock files intentionally remain. Distinguish successful local root access from
an unexecuted claim about a particular external product service's namespace.

## Delivery and independent evidence

Verify offline Ubuntu24.04 amd64 manager/deb build, installed CLI/docs/helper,
Python3 package dependency, root-owned0644 helper invocation through Python -I,
real separate-node byte exchange, manager adoption and applied restoration while
preserving all nine previous workspaces and unrelated manual services.

The runtime and asset manifest must match the frozen image and full source
hashes. Keep the original public GPL lib60870 archive, complete COPYING, GPL
native wrapper, compiler/build recipe and MIT Python sources together with the
redistributed image. No TLS/secure-auth stack is required for this profile.
Prepared compiler/base caches enable offline rebuilding; a complete OS/compiler
source distribution is outside this phase.

An independent raw-wire master must not import the product decoder. An optional
official CS101_Master peer provides additional native interoperation, with the
same-library limitation stated. Actual PTY/TCP and termios calls do not establish
RS232/RS485 voltage, physical line rate/parity, half-duplex direction control,
multidrop bus arbitration, interference tolerance, field devices or real outputs.
