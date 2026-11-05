import test from "node:test";
import assert from "node:assert/strict";
import {
  currentMplsRuntime,
  mplsRuntimeScenario,
  type MplsRuntime,
} from "../src/mpls-runtime.ts";
import { runtimeHeartbeatAge } from "../src/runtime-status.ts";
const fixture = (): MplsRuntime => ({
  schema_version: 1,
  protocol: "mpls",
  boot_id: "0717b2ba-2f99-4361-a41d-d6b82906c07d",
  runtime_id: "a".repeat(32),
  config_sha256: "b".repeat(64),
  worker_ready_after_bind: true,
  event_loop_age_ms: 40,
  uptime_ms: 500,
  interface: {
    name: "eth0",
    ifindex: 2,
    hardware_type: 1,
    mac: "02:00:00:00:58:20",
    mtu: 1500,
  },
  link_mode: "docker-bridge",
  scenario: "normal",
  label: 58,
  reply_ttl: 64,
  packet_auxdata: true,
  filter: {
    name: "mpls-unicast-ethertype-v1",
    attached: true,
    instructions: [
      [40, 0, 0, 12],
      [6, 0, 0, 65535],
    ],
    sha256: "c".repeat(64),
    packet_socket_inode: "1212",
  },
  counters: {
    rx_frames: 0,
    accepted: 0,
    rejected: 0,
    expired: 0,
    tx_submitted: 0,
    suppressed: 0,
    tx_error: 0,
    ignored: 0,
    log_dropped: 0,
  },
  last_request: null,
  last_output: null,
  next_event_id: 1,
});
test("MPLS runtime exact source identity/schema/actual raw filter and AUXDATA required", () => {
  const runtime = fixture();
  const env = { available: true, source_container_id: "ownCID", runtime };
  assert.equal(currentMplsRuntime(env, "ownCID"), runtime);
  assert.equal(currentMplsRuntime(env, "foreign"), null);
  assert.equal(
    currentMplsRuntime({ ...env, available: false }, "ownCID"),
    null,
  );
  for (const r of [
    { ...runtime, protocol: "rtp" },
    { ...runtime, schema_version: 2 },
    { ...runtime, packet_auxdata: false },
    { ...runtime, interface: { ...runtime.interface, hardware_type: 772 } },
    { ...runtime, filter: { ...runtime.filter, instructions: [] } },
    { ...runtime, scenario: ["normal"] },
    { ...runtime, counters: { ...runtime.counters, tx_error: -1 } },
    { ...runtime, config_sha256: "bad" },
  ])
    assert.equal(
      currentMplsRuntime({ ...env, runtime: r as MplsRuntime }, "ownCID"),
      null,
    );
});
test("short13 TXerror can coexist with actual source readiness, never silently interpreted as silent", () => {
  const r = fixture();
  r.scenario = "short-ethernet";
  r.counters.accepted = 1;
  r.counters.tx_error = 1;
  r.last_output = { kind: "tx_error", errno: 22, wire_length: 13 };
  assert.equal(
    currentMplsRuntime(
      { available: true, source_container_id: "c", runtime: r },
      "c",
    ),
    r,
  );
  assert.equal(mplsRuntimeScenario(r.scenario), "short-ethernet");
  assert.equal(r.counters.suppressed, 0);
  assert.equal(r.counters.tx_submitted, 0);
});
test("MPLS runtime uses monotonic elapsed plus server sample age and does not renew cached readiness", () => {
  const age = runtimeHeartbeatAge(1900, 1000, 1100, 50);
  assert.equal(age, 2050);
  assert.ok(age > 2000);
  assert.equal(runtimeHeartbeatAge(0, 1000, 999), Infinity);
  for (const v of [
    true,
    ["normal"],
    { mode: "normal" },
    { mode: true },
    { mode: ["normal"] },
    {},
  ])
    assert.equal(mplsRuntimeScenario(v), null);
});
