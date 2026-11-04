import assert from "node:assert/strict";
import { test } from "node:test";
import {
  vxlanDefaults,
  vxlanModes,
  isVxlanConfig,
  validateVxlanConfig,
  normalizeVxlanConfig,
  sameVxlanConfig,
  vxlanReportLabel,
  vxlanDescription,
  type VxlanConfig,
} from "../src/vxlan-config.ts";
import {
  currentVxlanRuntime,
  type VxlanRuntimeEnvelope,
} from "../src/vxlan-runtime.ts";
import { runtimeHeartbeatAge } from "../src/runtime-status.ts";
import { bfdDefaults } from "../src/bfd-config.ts";
import { rtpDefaults } from "../src/rtp-config.ts";

test("VXLAN exact13 fields and eleven mode-only scenarios never coerce or absorb other protocols", () => {
  assert.equal(isVxlanConfig(vxlanDefaults), true);
  for (const mode of vxlanModes)
    assert.doesNotThrow(() =>
      validateVxlanConfig({ ...vxlanDefaults, scenario: { mode } }),
    );
  for (const key of Object.keys(vxlanDefaults)) {
    const c = { ...vxlanDefaults } as Record<string, unknown>;
    delete c[key];
    assert.equal(isVxlanConfig(c), false);
  }
  for (const c of [
    bfdDefaults,
    rtpDefaults,
    { ...vxlanDefaults, interface: "lo" },
    { ...vxlanDefaults, wire_profile: null },
    { ...vxlanDefaults, scenario: { mode: "normal", duration_ms: 1 } },
  ])
    assert.equal(isVxlanConfig(c), false);
  for (const mode of [
    ["normal"],
    ["silent"],
    {},
    true,
    false,
    null,
    "not-a-mode",
  ])
    assert.equal(
      isVxlanConfig({ ...vxlanDefaults, scenario: { mode } }),
      false,
    );
});
test("VXLAN same-outer-IP endpoints separate all three roles but different IPs may share port numbers", () => {
  assert.doesNotThrow(() =>
    validateVxlanConfig({
      ...vxlanDefaults,
      peer_ip: "127.0.0.1",
      peer_port: 4790,
    }),
  );
  for (const peer_port of [vxlanDefaults.port, vxlanDefaults.source_port])
    assert.throws(() =>
      validateVxlanConfig({
        ...vxlanDefaults,
        peer_ip: vxlanDefaults.bind_ip,
        peer_port,
      }),
    );
  assert.doesNotThrow(() =>
    validateVxlanConfig({
      ...vxlanDefaults,
      peer_port: vxlanDefaults.source_port,
    }),
  );
  assert.throws(() =>
    validateVxlanConfig({ ...vxlanDefaults, port: vxlanDefaults.source_port }),
  );
  for (const key of ["bind_ip", "peer_ip", "inner_ip"] as const)
    for (const value of [
      "0.0.0.0",
      "0.1.2.3",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "127.000.0.1",
    ])
      assert.throws(() =>
        validateVxlanConfig({ ...vxlanDefaults, [key]: value }),
      );
  assert.doesNotThrow(() =>
    validateVxlanConfig({ ...vxlanDefaults, requester_ip: "0.0.0.0" }),
  );
  assert.throws(() =>
    validateVxlanConfig({
      ...vxlanDefaults,
      requester_ip: vxlanDefaults.inner_ip,
    }),
  );
  assert.doesNotThrow(() =>
    validateVxlanConfig({ ...vxlanDefaults, inner_ip: "240.0.0.1" }),
  );
});
test("VXLAN uint24 VNI0, UDP port bounds and exact0/18 padding retain wire-size meaning", () => {
  for (const [key, lo, hi] of [
    ["port", 1, 65535],
    ["peer_port", 1, 65535],
    ["source_port", 49152, 65535],
    ["vni", 0, 16777215],
  ] as const) {
    for (const value of [lo, hi])
      assert.doesNotThrow(() =>
        validateVxlanConfig({ ...vxlanDefaults, [key]: value }),
      );
    for (const value of [lo - 1, hi + 1, 1.5, NaN, true, null])
      assert.throws(() =>
        validateVxlanConfig({ ...vxlanDefaults, [key]: value } as VxlanConfig),
      );
  }
  for (const reply_padding of [1, 17, 19, true, "18", null])
    assert.equal(isVxlanConfig({ ...vxlanDefaults, reply_padding }), false);
  for (const reply_padding of [0, 18] as const)
    assert.match(
      vxlanDescription({ ...vxlanDefaults, reply_padding }),
      reply_padding === 18 ? /inner 60B \/ UDP 68B/ : /inner 42B \/ UDP 50B/,
    );
});
test("VXLAN MAC canonicalization accepts mixed-case without mutation or phantom pending hash", () => {
  const input = {
    ...vxlanDefaults,
    inner_mac: "02:aB:Cd:eF:00:20",
    requester_mac: "02:aB:Cd:eF:00:10",
  };
  const normalized = normalizeVxlanConfig(input);
  assert.equal(normalized.inner_mac, "02:ab:cd:ef:00:20");
  assert.equal(normalized.requester_mac, "02:ab:cd:ef:00:10");
  assert.equal(input.inner_mac, "02:aB:Cd:eF:00:20");
  assert.equal(sameVxlanConfig(input, normalized), true);
  assert.throws(() =>
    validateVxlanConfig({ ...input, requester_mac: "02:AB:CD:EF:00:20" }),
  );
  for (const key of ["inner_mac", "requester_mac"] as const)
    for (const value of [
      "00:00:00:00:00:00",
      "01:00:00:00:00:01",
      "ff:ff:ff:ff:ff:ff",
      "02:0:00:00:00:01",
      "02:00:00:00:00:01 ",
      "not-a-mac",
    ])
      assert.throws(() =>
        validateVxlanConfig({ ...vxlanDefaults, [key]: value }),
      );
});
test("VXLAN old ALL reports keep their own applied target-mode label as current mode changes", () => {
  const old = structuredClone(vxlanDefaults);
  const now = { ...vxlanDefaults, scenario: { mode: "silent" as const } };
  assert.match(vxlanReportLabel("ALL", old), /^normal /);
  assert.match(vxlanReportLabel("ALL", now), /^silent /);
  assert.match(vxlanReportLabel("ALL", old), /8项.*测试时生效快照/);
  assert.equal(sameVxlanConfig(old, now), false);
});
test("VXLAN runtime is current-CID readiness/counters and shares monotonic stale protection with BFD", () => {
  const value: VxlanRuntimeEnvelope = {
    available: true,
    source_container_id: "owned",
    sample_age_ms: 100,
    runtime: {
      schema_version: 1,
      protocol: "vxlan",
      boot_id: "boot",
      runtime_id: "runtime",
      worker_ready_after_bind: true,
      event_loop_age_ms: 5,
      receiver: {
        bind_ip: "127.0.0.1",
        port: 4789,
        source_port: 55029,
        peer_ip: "127.0.0.2",
        peer_port: 4789,
      },
      scenario: { mode: "silent" },
      reply_inner_size: 42,
      vni: 0,
      counters: {
        received: 2,
        accepted: 1,
        rejected: 1,
        tx_actual: 0,
        normal_replies: 0,
        suppressed: 1,
        log_dropped: 0,
      },
      last_valid_request_age_ms: null,
      next_request_id: 3,
      next_event_id: 4,
      cache_evictions: 0,
    },
  };
  assert.equal(currentVxlanRuntime(value, "owned")?.counters.suppressed, 1);
  assert.equal(currentVxlanRuntime(value, "other"), null);
  assert.equal(
    currentVxlanRuntime({ ...value, available: false }, "owned"),
    null,
  );
  assert.equal(
    currentVxlanRuntime(
      {
        ...value,
        runtime: { ...value.runtime!, protocol: "bfd" },
      } as unknown as VxlanRuntimeEnvelope,
      "owned",
    ),
    null,
  );
  assert.equal(
    currentVxlanRuntime(
      {
        ...value,
        runtime: {
          ...value.runtime!,
          counters: { ...value.runtime!.counters, accepted: NaN },
        },
      },
      "owned",
    ),
    null,
  );
  assert.equal(runtimeHeartbeatAge(1900, 100, 101, 100) > 2000, true);
  assert.equal(runtimeHeartbeatAge(0, 100, 99), Infinity);
});
