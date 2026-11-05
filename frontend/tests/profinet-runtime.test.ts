import test from "node:test";
import assert from "node:assert/strict";
import {
  currentProfinetRuntime,
  profinetNativeText,
  profinetAllLocalReady,
  type ProfinetRuntime,
} from "../src/profinet-runtime.ts";
import { runtimeHeartbeatAge } from "../src/runtime-status.ts";
import { validProfinetInitialName } from "../src/profinet-config.ts";
const zero = { ip: "0.0.0.0", netmask: "0.0.0.0", gateway: "0.0.0.0" };
function fixture(): ProfinetRuntime {
  const iface = (name: string, ifindex: number, mac: string) => ({
    name,
    ifindex,
    mac,
    hardware_type: 1 as const,
    mtu: 1500,
    ipv4: [],
    iflink: 44,
    namespace: "net:[123]",
  });
  const ptcp = (f: boolean) => ({
    ready: true,
    mode: f ? "with-follow-up" : "without-follow-up",
    scenario: "good",
    packet_socket_inode: f ? 44 : 43,
    packet_filter: { ethertype: 34962, protocol: "ETH_P_PROFINET" },
    counters: {
      received: 0,
      accepted: 0,
      rejected: 0,
      ignored: 0,
      tx_submitted: 0,
      tx_errors: 0,
      pending_expired: 0,
    },
    pending: 0,
    last_request: null,
    last_output: null,
  });
  return {
    schema_version: 1,
    protocol: "profinet",
    boot_id: "0717b2ba-2f99-4361-a41d-d6b82906c07d",
    runtime_id: "a".repeat(32),
    config_sha256: "b".repeat(64),
    worker_ready_after_bind: true,
    event_loop_age_ms: 20,
    uptime_ms: 2000,
    interfaces: {
      management: iface("eth0", 2, "02:00:00:00:86:30"),
      data: iface("pn0", 3, "02:00:00:00:86:20"),
      ptcp_n: iface("pnptcpn", 4, "02:00:00:00:86:21"),
      ptcp_f: iface("pnptcpf", 5, "02:00:00:00:86:22"),
    },
    components: {
      dcp: {
        ready: true,
        pid: 12,
        start_ticks: 123,
        version: "0.2.0",
        tick_age_ms: 20,
        snapshot_stable: true,
        current: { station_name: "", ip_suite: { ...zero } },
        nonvolatile: { station_name: "native..odd.", ip_suite: { ...zero } },
      },
      ptcp_n: ptcp(false),
      ptcp_f: ptcp(true),
    },
    network_apply: null,
    storage: null,
    signal: {
      software_only: true,
      state: false,
      transitions: 0,
      last_transition_ms: null,
      history: [],
    },
    capture: {
      packet_socket_inode: 55,
      received: 0,
      outgoing: 0,
      errors: 0,
      native_packet_pid_attribution: false,
    },
    next_event_id: 1,
    cache_evictions: 0,
  };
}
test("runtime native current/NV empty and odd values remain visible, not initializer validated or filled from disk", () => {
  const r = fixture();
  assert.equal(
    currentProfinetRuntime(
      { available: true, source_container_id: "own", runtime: r },
      "own",
    ),
    r,
  );
  assert.equal(
    validProfinetInitialName(r.components.dcp!.current!.station_name),
    false,
  );
  assert.equal(
    validProfinetInitialName(r.components.dcp!.nonvolatile!.station_name),
    false,
  );
  assert.match(profinetNativeText(r.components.dcp!.current), /空名/);
  assert.match(
    profinetNativeText(r.components.dcp!.nonvolatile),
    /native\.\.odd\./,
  );
  assert.match(profinetNativeText(null), /未观察/);
  assert.equal(r.storage, null);
});
test("unobserved partial components/apply/storage stay null/unknown and cannot make all3ready", () => {
  const r = fixture();
  r.worker_ready_after_bind = false;
  r.components.dcp = { ready: false, current: null, nonvolatile: null };
  r.components.ptcp_n = null;
  r.components.ptcp_f = { ready: false, counters: null, pending: null };
  r.interfaces.ptcp_f = null;
  r.signal = null;
  r.capture = null;
  assert.equal(
    currentProfinetRuntime(
      { available: true, source_container_id: "c", runtime: r },
      "c",
    ),
    r,
  );
  assert.equal(profinetAllLocalReady(r, 0, 0), false);
  assert.equal(r.network_apply, null);
  assert.equal(r.storage, null);
});
test("foreign source/schema/malformed counters/nonnative PID attribution reject rather than stale green", () => {
  const r = fixture(),
    e = { available: true, source_container_id: "c", runtime: r };
  assert.equal(currentProfinetRuntime(e, "foreign"), null);
  assert.equal(currentProfinetRuntime({ ...e, available: false }, "c"), null);
  for (const runtime of [
    { ...r, schema_version: 2 },
    { ...r, protocol: "mpls" },
    { ...r, capture: { ...r.capture, native_packet_pid_attribution: true } },
    { ...r, signal: { ...r.signal, state: "false" } },
    {
      ...r,
      components: {
        ...r.components,
        ptcp_n: { ...r.components.ptcp_n!, scenario: "missing-follow-up" },
      },
    },
    {
      ...r,
      components: {
        ...r.components,
        dcp: { ...r.components.dcp!, version: { bad: true } },
      },
    },
    {
      ...r,
      interfaces: {
        ...r.interfaces,
        management: { ...r.interfaces.management!, hardware_type: 772 },
      },
    },
  ])
    assert.equal(
      currentProfinetRuntime(
        { ...e, runtime: runtime as ProfinetRuntime },
        "c",
      ),
      null,
    );
});
test("native ACK/current and failed actual apply or pending NV files remain separate from local process readiness", () => {
  const r = fixture();
  r.network_apply = {
    phase: "error",
    sequence: 4,
    requested: {
      ip_suite: {
        ip: "198.18.86.25",
        netmask: "255.255.255.0",
        gateway: "0.0.0.0",
      },
    },
    actual_ipv4: [],
    actual_routes: [],
    management_unchanged: true,
    confirmed: false,
    error: "callback rejected management overlap",
  };
  r.storage = {
    path: "/native-store",
    abi: "v1",
    owner_nonce: "c".repeat(32),
    writer_locked: true,
    initialized: true,
    validation: "pending",
    durability: "native-save-observed-not-fsync-certified",
    files: [],
    native_nonvolatile_matches_saved: false,
    error: null,
  };
  assert.equal(
    currentProfinetRuntime(
      { available: true, source_container_id: "c", runtime: r },
      "c",
    ),
    r,
  );
  assert.equal(profinetAllLocalReady(r, 100, 100), true);
  assert.equal(r.network_apply.confirmed, false);
  assert.equal(r.storage.native_nonvolatile_matches_saved, false);
  const age = runtimeHeartbeatAge(1900, 1000, 1100, 100);
  assert.equal(profinetAllLocalReady(r, 100, age), false);
  r.interfaces.data = null;
  assert.equal(profinetAllLocalReady(r, 0, 0), false);
});

test("native no-callback empty-name/allzero boot retains nullable sequence and actual OS readback without fabricating callback0", () => {
  const r = fixture();
  r.components.dcp!.current = { station_name: "", ip_suite: { ...zero } };
  r.components.dcp!.nonvolatile = { station_name: "", ip_suite: { ...zero } };
  r.network_apply = {
    phase: "observed_no_callback",
    sequence: null,
    requested: null,
    actual_ipv4: [],
    actual_routes: [],
    management_unchanged: true,
    confirmed: true,
    error: null,
  };
  const envelope = { available: true, source_container_id: "c", runtime: r };
  const accepted = currentProfinetRuntime(envelope, "c");
  assert.equal(accepted, r);
  assert.equal(accepted!.network_apply!.sequence, null);
  assert.equal(accepted!.components.dcp!.current!.station_name, "");
  assert.equal(accepted!.components.dcp!.current!.ip_suite.ip, "0.0.0.0");
  assert.equal(profinetAllLocalReady(r, 100, 100), true);
  for (const bad of [undefined, "0", false, {}, -1, NaN]) {
    const invalid = {
      ...r,
      network_apply: { ...r.network_apply, sequence: bad },
    } as ProfinetRuntime;
    assert.equal(
      currentProfinetRuntime({ ...envelope, runtime: invalid }, "c"),
      null,
    );
  }
});
