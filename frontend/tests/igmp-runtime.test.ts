import test from "node:test";
import assert from "node:assert/strict";
import {
  currentIgmpRuntime,
  igmpForceDescription,
  igmpNativeReportDescription,
  type IgmpRuntime,
} from "../src/igmp-runtime.ts";
const params = {
  sysctl_qrv: 2,
  interface_force: 2,
  all_force: 0,
  v2_unsolicited_interval_ms: 10000,
  v3_unsolicited_interval_ms: 1000,
};
const sample: IgmpRuntime = {
  schema_version: 1,
  protocol: "igmp",
  boot_id: "boot",
  runtime_id: "runtime",
  config_sha256: "a".repeat(64),
  worker_ready_after_bind: true,
  event_loop_age_ms: 10,
  uptime_ms: 1000,
  link_mode: "docker-bridge",
  kernel: {
    origin: "Linux kernel; wrapper holds membership and observes only",
    release: "test-host-kernel",
    network_namespace: { device: 5, inode: 4026532000 },
  },
  interface: {
    name: "eth0",
    ifindex: 2,
    hardware_type: 1,
    mac: "02:00:00:00:19:20",
    primary_ipv4: "172.20.0.2",
    prefixlen: 16,
    mtu: 1500,
  },
  membership: {
    udp_socket_inode: 123,
    udp_local_address: ["0.0.0.0", 55000],
    groups: [
      {
        group: "239.192.19.1",
        joined_age_ms: 1000,
        preexisting_other_refs: 0,
        current_kernel_refs: 1,
        other_refs: 0,
      },
    ],
    other_refs_detected: false,
  },
  parameters: {
    at_join: params,
    current: params,
    detected_parameter_changes: false,
    sysctl_qrv_at_join: 2,
    qrv_upper_bound_at_join: 2,
    qrv_upper_bound_reason: "forced-v2-compatible sysctl count",
    startup_upper_ms: 13000,
  },
  testability: {
    available: true,
    remaining_warmup_upper_ms: 12000,
    reason: null,
  },
  packet_socket_inode: 124,
  counters: {
    queries_in: 0,
    reports_out: 1,
    reports_v1_out: 0,
    reports_v2_out: 1,
    reports_v3_out: 0,
    reports_in: 0,
    ignored: 0,
    rejected_capture: 0,
    log_dropped: 0,
  },
  last_query: null,
  last_report: {
    decoded: { igmp_version: 2, igmp_type: 22 },
    metadata: { packet_type: 4 },
  },
  next_event_id: 1,
  cache_evictions: 0,
};
test("native runtime requires exact current CID/schema/finite kernel membership evidence", () => {
  const env = { available: true, source_container_id: "own", runtime: sample };
  assert.equal(currentIgmpRuntime(env, "own"), sample);
  assert.equal(currentIgmpRuntime(env, "other"), null);
  assert.equal(currentIgmpRuntime({ ...env, available: false }, "own"), null);
  for (const modify of [
    (r: IgmpRuntime) => (r.protocol = "arp-client" as never),
    (r: IgmpRuntime) => (r.kernel.network_namespace.inode = NaN),
    (r: IgmpRuntime) => (r.membership.udp_socket_inode = null as never),
    (r: IgmpRuntime) => (r.counters.reports_out = NaN),
    (r: IgmpRuntime) => (r.parameters.detected_parameter_changes = [] as never),
  ]) {
    const r = structuredClone(sample);
    modify(r);
    assert.equal(currentIgmpRuntime({ ...env, runtime: r }, "own"), null);
  }
});
test("parameter/other-ref query unavailability preserves own native runtime instead of pretending member service failed", () => {
  const r = structuredClone(sample);
  r.parameters.detected_parameter_changes = true;
  r.membership.other_refs_detected = true;
  r.membership.groups[0].current_kernel_refs = 2;
  r.membership.groups[0].other_refs = 1;
  r.testability = {
    available: false,
    remaining_warmup_upper_ms: 100,
    reason: "shared references",
  };
  assert.equal(
    currentIgmpRuntime(
      { available: true, source_container_id: "own", runtime: r },
      "own",
    ),
    r,
  );
  assert.match(igmpForceDescription(0), /自动.*非强制v2/);
  assert.match(igmpForceDescription(2), /v1/);
  r.parameters.qrv_upper_bound_at_join = 7;
  r.parameters.qrv_upper_bound_reason =
    "conservative, learned mr_qrv not exported";
  assert.equal(r.parameters.sysctl_qrv_at_join, 2);
});
test("actual v1/v2/v3 report version is not inferred from v2 query expectation or coerced unknown fields", () => {
  for (const [v, t] of [
    [1, 0x12],
    [2, 0x16],
    [3, 0x22],
  ])
    assert.match(
      igmpNativeReportDescription({
        decoded: { igmp_version: v, igmp_type: t },
        metadata: {},
      }),
      new RegExp(`v${v}.*0x${t.toString(16)}`),
    );
  assert.match(igmpNativeReportDescription(null), /尚无/);
  for (const value of ["2", [2], true, null])
    assert.match(
      igmpNativeReportDescription({
        decoded: { igmp_version: value },
        metadata: {},
      }),
      /未知版本/,
    );
});

test("owned helper status must match actual source interface/namespace and whitelist an atomic31bit marker", async () => {
  const { currentIgmpOwnedLink } = await import("../src/igmp-runtime.ts");
  const r = structuredClone(sample);
  r.link_mode = "owned-vxlan";
  r.interface.name = "plig0123456789";
  const receipt = {
    schema_version: 1,
    protocol: "igmp-link",
    owner_id: "01234567-89ab-4cde-8fab-0123456789ab",
    atomic_group_id: 2147483647,
    name: r.interface.name,
    alias: "protocol-target-lab igmp owned alias",
    phase: "ready",
    ifindex: r.interface.ifindex,
    boot_id: "boot",
    network_namespace: r.kernel.network_namespace,
    link_sha256: "b".repeat(64),
    spec: { unrendered_arbitrary: "must not leak into view" },
  };
  r.owned_link = {
    ready: true,
    matches_requested: true,
    interface: { ...r.interface },
    receipt,
  };
  const view = currentIgmpOwnedLink(r);
  assert.equal(view?.atomicGroup, 2147483647);
  assert.equal(view?.name, r.interface.name);
  assert.equal("spec" in view!, false);
  assert.equal("unrendered_arbitrary" in view!, false);
  for (const patch of [
    { atomic_group_id: 0 },
    { atomic_group_id: 2147483648 },
    { atomic_group_id: "1" },
    { ifindex: 999 },
    { name: "foreign" },
    { phase: "intent" },
    { network_namespace: { device: 5, inode: 1 } },
    { owner_id: "bad-owner" },
  ]) {
    r.owned_link = {
      ready: true,
      matches_requested: true,
      interface: { ...r.interface },
      receipt: { ...receipt, ...patch },
    };
    assert.equal(currentIgmpOwnedLink(r), null);
  }
});
test("bridge/host do not imply an owned helper and false ready/foreign actual interface cannot become verified", async () => {
  const { currentIgmpOwnedLink } = await import("../src/igmp-runtime.ts");
  const r = structuredClone(sample);
  assert.equal(currentIgmpOwnedLink(r), null);
  r.link_mode = "host-interface";
  r.owned_link = { ready: true, matches_requested: true };
  assert.equal(currentIgmpOwnedLink(r), null);
  r.link_mode = "owned-vxlan";
  r.owned_link = { ready: false, matches_requested: true, receipt: {} };
  assert.equal(currentIgmpOwnedLink(r), null);
});
