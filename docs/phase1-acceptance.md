# HTTP phase acceptance

Date: 2026-11-04. Scope: the native Rust manager with embedded Web UI, one Docker HTTP target, and Ubuntu 24.04 amd64 deb installation. Other protocol adapters remain future work.

## Delivered behavior

- The Web UI creates and edits HTTP instances, separates saved drafts from applied configuration, starts/stops/restarts workers, shows connection examples, and follows bounded instance logs through SSE.
- The worker implements fixed-length `/ok`, chunked `/chunked`, connection-close `/close`, correct HEAD, and binary POST echo. All three normal endpoints use the configured response body.
- Persistent deployment identity, instance labels and configuration fingerprints allow the manager to adopt its existing containers after an unexpected process restart. Container names alone never authorize removal.
- Startup intent is durable before Docker changes. A successful applied snapshot is persisted separately; an unapplied draft is not used during automatic recovery. Failed first starts require an explicit retry.
- Workers use host networking, immutable local image IDs, `restart=no`, and bounded Docker logs. Startup never pulls an image. The manager owns recovery and remains available when Docker is unavailable.
- The package starts/enables the manager through systemd. Upgrade restarts only the manager. Explicit `plabctl stop-all` stops the manager before removing this deployment's workers and preserves enabled intent. Remove and purge have separate cleanup scopes.

## Verification

Independent agents reviewed implementation and exercised real Docker/API behavior and the real Web UI. Evidence is retained outside public source history in the project's ignored local verification directory.

The independent lifecycle checks cover real HTTP traffic and SSE, process SIGKILL and adoption with unchanged container ID/start time/PID, draft isolation, explicit application, same-configuration restart, repeated start/stop, listener release, disabled recovery, first-start failure, missing images, malformed configuration, and validation failures preserving an existing worker. Additional checks cover wildcard bind transitions, conflicting listeners on another IP, independent instances, persistence errors, a second manager lock, Docker unavailability, and repeated configuration saves.

The public HTTP client performs 24 checks across all three response delimiters, HEAD, POST and repeated requests. The worker also passed local real-socket checks with empty and Unicode responses, bounded byte previews, malformed requests and SIGTERM during an incomplete request.

The actual deb was built in Ubuntu 24.04 with Rust 1.92.0, after building the embedded Web. `dpkg-shlibdeps` resolved `libc6 (>= 2.39)` and `libgcc-s1 (>= 4.2)`; the selected Docker provider is Ubuntu `docker.io`. The Ubuntu 24.04 build container compiled with networking disabled from prepared dependencies. The deb was installed on a separate Ubuntu 24.04 Linux node and exercised from another Linux node using the public HTTP client.

On that Ubuntu 24.04 node, systemd automatically restarted a SIGKILLed manager while the worker's ID/start time/PID and applied response remained unchanged. Two complete public HTTP rounds passed. Explicit restart applied the saved draft; stop released the listener and remained disabled after manager restart. `stop-all`/`start` restored enabled intent. An actual deb upgrade kept the original worker running. Remove preserved configuration, reinstallation restored its enabled instance, and purge followed by a fresh installation yielded a disabled default instance. `systemd-analyze verify` and dynamic-link checks passed after installation.

Independent verification recorded 24 lifecycle checks with 24 HTTP subchecks, 10 additional edge checks and 8 final regression checks. The real browser exercise covered configuration, lifecycle actions, request/response logs, draft preservation, applying a new endpoint, copying and deleting an instance, and stopping it.

## Reproduction

```sh
make fetch-deps
make build-ubuntu24 OFFLINE=1
make images OFFLINE=1
make deb PLAB_BINARY="$PWD/.local/build/ubuntu24/target/release/protocol-target-lab"
# Transfer the deb and the exported HTTP image to the target, then install/load.
sudo apt install ./dist/protocol-target-lab_0.1.0_amd64.deb
# Configure and explicitly start HTTP using the Web UI.
make smoke SCENARIO=http-basic TARGET_ADDR=<target-ip> TARGET_PORT=<configured-port>
```

## Boundaries

This phase does not claim a complete clean-machine offline distribution or the nine-protocol release. Whole-host power/reboot recovery has not been tested; the shared validation host was not rebooted. Manager/systemd process recovery is tested separately. The UI download action was exercised, but browser-tool evidence does not independently confirm the downloaded file on disk. TLS, malformed response generation, VM profiles and physical serial/electrical behavior are outside this phase.
