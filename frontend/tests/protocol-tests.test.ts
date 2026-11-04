import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundedWireSummary,
  ownProtocolTest,
  protocolTestLabel,
  type ProtocolTestRun,
} from "../src/protocol-tests.ts";

test("generic test controls prefer server labels while preserving unknown future case IDs", () => {
  assert.equal(
    protocolTestLabel(
      "MQTT5_QOS2",
      { MQTT5_QOS2: "MQTT 5.0 · QoS 2" },
      { MQTT5_QOS2: "fallback" },
    ),
    "MQTT 5.0 · QoS 2",
  );
  assert.equal(protocolTestLabel("future-case"), "future-case");
  assert.equal(
    protocolTestLabel("ALL", undefined, { ALL: "全部测试" }),
    "全部测试",
  );
});
test("structured protocol previews retain wire and handshake fields and bound display text", () => {
  const message = {
    delivered: true,
    packets: [
      {
        role: "publisher",
        direction: "receive",
        packet: "PUBCOMP",
        length: 4,
        truncated: false,
        preview_hex: "70020001",
      },
    ],
  };
  const complete = boundedWireSummary(message);
  assert.equal(complete.truncated, false);
  assert.deepEqual(JSON.parse(complete.text), message);
  const limited = boundedWireSummary(message, 40);
  assert.equal(limited.truncated, true);
  assert.equal(limited.text.length, 40);
  assert.equal(limited.originalCharacters, complete.text.length);
  assert.equal(boundedWireSummary(undefined).text, "");
});
test("generic retained reports require both current workspace and accepted test identity", () => {
  const run = {
    id: "test-a",
    instance_id: "mqtt-old",
    status: "passed",
  } as ProtocolTestRun<unknown>;
  assert.equal(ownProtocolTest(run, "mqtt-old", null), run);
  assert.equal(ownProtocolTest(run, "mqtt-new", null), null);
  assert.equal(ownProtocolTest(run, "mqtt-old", "test-b"), null);
  assert.equal(ownProtocolTest(run, "mqtt-old", "test-a"), run);
});
