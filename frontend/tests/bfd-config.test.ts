import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bfdDefaults,
  bfdModes,
  changeBfdMode,
  isBfdConfig,
  validateBfdConfig,
  sameBfdConfig,
  bfdCaseLabels,
  bfdReportLabel,
  type BfdConfig,
} from "../src/bfd-config.ts";
import {
  currentBfdRuntime,
  bfdHeartbeatAge,
  type BfdRuntimeEnvelope,
} from "../src/bfd-runtime.ts";
import { iec101Defaults } from "../src/iec101-config.ts";
import { rtpDefaults } from "../src/rtp-config.ts";

test("BFD exact tagged mode changes drop irrelevant fields while retaining shared delay", () => {
  assert.doesNotThrow(() => validateBfdConfig(bfdDefaults));
  const quiet = changeBfdMode(bfdDefaults, "quiet");
  assert.deepEqual(quiet.scenario, {
    mode: "quiet",
    after_up_ms: 1000,
    duration_ms: 4000,
  });
  const poll = changeBfdMode(
    {
      ...quiet,
      scenario: { mode: "quiet", after_up_ms: 42, duration_ms: 9000 },
    },
    "poll",
  );
  assert.deepEqual(poll.scenario, { mode: "poll", after_up_ms: 42 });
  assert.deepEqual(changeBfdMode(poll, "normal").scenario, { mode: "normal" });
  assert.deepEqual(bfdDefaults.scenario, { mode: "normal" });
  for (const mode of bfdModes)
    assert.doesNotThrow(() =>
      validateBfdConfig(changeBfdMode(bfdDefaults, mode)),
    );
  for (const scenario of [
    { mode: "normal", after_up_ms: 0 },
    { mode: "poll", after_up_ms: 0, duration_ms: 1 },
    { mode: "quiet", after_up_ms: 0 },
    { mode: "poll", after_up_ms: null },
    { mode: "wrong" },
    { mode: "quiet", after_up_ms: 0, duration_ms: true },
  ])
    assert.equal(isBfdConfig({ ...bfdDefaults, scenario }), false);
  assert.equal(sameBfdConfig(bfdDefaults, structuredClone(bfdDefaults)), true);
  assert.equal(sameBfdConfig(bfdDefaults, poll), false);
  assert.match(bfdCaseLabels.ALL, /当前生效模式/);
});
test("BFD numeric boundaries preserve uint32 and reject bool/extra/null/foreign shapes", () => {
  for (const [key, low, high] of [
    ["source_port", 49152, 65535],
    ["local_discriminator", 1, 4294967295],
    ["min_tx_us", 1000000, 4294967295],
    ["min_rx_us", 1000000, 4294967295],
    ["detect_mult", 1, 255],
  ] as const) {
    for (const value of [low, high])
      assert.doesNotThrow(() =>
        validateBfdConfig({ ...bfdDefaults, [key]: value }),
      );
    for (const value of [low - 1, high + 1, 1.5, NaN, true, null])
      assert.throws(() =>
        validateBfdConfig({ ...bfdDefaults, [key]: value } as BfdConfig),
      );
  }
  for (const config of [
    iec101Defaults,
    rtpDefaults,
    { ...bfdDefaults, port: 3784 },
    { ...bfdDefaults, wire_profile: null },
  ])
    assert.equal(isBfdConfig(config), false);
  for (const key of Object.keys(bfdDefaults)) {
    const missing = { ...bfdDefaults } as Record<string, unknown>;
    delete missing[key];
    assert.equal(isBfdConfig(missing), false);
  }
  for (const [after_up_ms, duration_ms] of [
    [0, 1],
    [3600000, 3600000],
  ])
    assert.doesNotThrow(() =>
      validateBfdConfig({
        ...bfdDefaults,
        scenario: { mode: "quiet", after_up_ms, duration_ms },
      }),
    );
  for (const [after_up_ms, duration_ms] of [
    [-1, 1],
    [3600001, 1],
    [0, 0],
    [0, 3600001],
    [0, 1.5],
  ])
    assert.throws(() =>
      validateBfdConfig({
        ...bfdDefaults,
        scenario: { mode: "quiet", after_up_ms, duration_ms },
      }),
    );
});
test("BFD requires distinct explicit unicast addresses and syntactic target interface", () => {
  for (const ip of [
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "host.test",
    "127.000.0.1",
  ])
    for (const key of ["bind_ip", "peer_ip"] as const)
      assert.throws(() => validateBfdConfig({ ...bfdDefaults, [key]: ip }));
  assert.throws(() =>
    validateBfdConfig({ ...bfdDefaults, peer_ip: bfdDefaults.bind_ip }),
  );
  for (const name of ["", "a".repeat(16), "网卡", "lo\n", "lo eth0"])
    assert.throws(() => validateBfdConfig({ ...bfdDefaults, interface: name }));
  // Saving a syntactically valid remote address is legal; actual membership belongs to server preflight.
  assert.doesNotThrow(() =>
    validateBfdConfig({
      ...bfdDefaults,
      bind_ip: "192.0.2.1",
      peer_ip: "192.0.2.2",
      interface: "eth0",
    }),
  );
});
test("BFD runtime ignores unavailable, foreign CID and unsupported schema instead of showing stale Up", () => {
  const value = {
    available: true,
    source_container_id: "owned-a",
    runtime: {
      schema_version: 1,
      protocol: "bfd",
      worker_ready_after_bind: true,
      event_loop_age_ms: 2,
      local_state: "Up",
      remote_state: "Up",
      diagnostic: 0,
      remote_discriminator: 42,
      negotiated_tx_us: 1000000,
      receive_detection_us: 3000000,
      epoch_id: 1,
      epoch_peer_discriminator: 42,
      last_valid_age_ms: 0,
      scenario: {
        mode: "normal",
        phase: "idle",
        poll_started: false,
        poll_completed: false,
        windows_started: 0,
      },
      counters: {
        rx_total: 2,
        accepted: 2,
        rejected: 0,
        tx_periodic: 2,
        tx_final: 0,
        suppressed: 0,
      },
    },
  } as BfdRuntimeEnvelope;
  assert.equal(currentBfdRuntime(value, "owned-a")?.local_state, "Up");
  assert.equal(
    currentBfdRuntime(
      { ...value, runtime: { ...value.runtime!, negotiated_tx_us: null } },
      "owned-a",
    )?.negotiated_tx_us,
    null,
  );
  assert.equal(currentBfdRuntime(value, "owned-b"), null);
  assert.equal(currentBfdRuntime(value, null), null);
  assert.equal(
    currentBfdRuntime({ ...value, available: false }, "owned-a"),
    null,
  );
  assert.equal(
    currentBfdRuntime(
      {
        ...value,
        runtime: { ...value.runtime!, protocol: "rtp" },
      } as unknown as BfdRuntimeEnvelope,
      "owned-a",
    ),
    null,
  );
  assert.equal(
    currentBfdRuntime(
      { ...value, runtime: { ...value.runtime!, event_loop_age_ms: NaN } },
      "owned-a",
    ),
    null,
  );
});

test("BFD heartbeat age includes server validation and monotonic elapsed without renewing old Up", () => {
  assert.equal(bfdHeartbeatAge(1900, 100, 200), 2000);
  assert.equal(bfdHeartbeatAge(1900, 100, 201) > 2000, true);
  assert.equal(bfdHeartbeatAge(1800, 100, 200, 101), 2001);
  assert.equal(bfdHeartbeatAge(0, 100, 5101), 5001);
  assert.equal(bfdHeartbeatAge(1, 100, 99), Infinity);
  for (const age of [-1, NaN, Infinity])
    assert.equal(bfdHeartbeatAge(1, 100, 200, age), Infinity);
});

test("BFD retained ALL report labels use that run's applied mode after current mode changes", () => {
  const oldRun = structuredClone(bfdDefaults);
  const current = changeBfdMode(bfdDefaults, "quiet");
  assert.match(bfdReportLabel("ALL", oldRun), /^normal /);
  assert.match(bfdReportLabel("ALL", current), /^quiet /);
  assert.match(bfdReportLabel("ALL", oldRun), /测试时生效快照/);
  assert.equal(bfdReportLabel("NORMAL", oldRun), bfdCaseLabels.NORMAL);
});

test("BFD tagged mode never coerces arrays, objects or booleans into accepted fault strings", () => {
  for (const mode of [
    ["quiet"],
    ["poll"],
    { toString: "quiet" },
    {},
    true,
    false,
    null,
  ]) {
    const config = {
      ...bfdDefaults,
      scenario: { mode, after_up_ms: 1000, duration_ms: 4000 },
    };
    assert.equal(isBfdConfig(config), false);
    assert.throws(() => validateBfdConfig(config as unknown as BfdConfig));
  }
});
