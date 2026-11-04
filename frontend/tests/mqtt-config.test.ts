import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mqttDefaults,
  validateMqttConfig,
  sameMqttConfig,
  type MqttConfig,
} from "../src/mqtt-config.ts";
import { isHttpConfig } from "../src/config.ts";

test("MQTT accepts configured defaults and connection/whole-packet boundaries", () => {
  assert.doesNotThrow(() => validateMqttConfig(mqttDefaults));
  for (const max_connections of [1, 128])
    for (const max_packet_size of [128, 1048576])
      assert.doesNotThrow(() =>
        validateMqttConfig({
          ...mqttDefaults,
          max_connections,
          max_packet_size,
        }),
      );
  for (const port of [1, 65535])
    assert.doesNotThrow(() => validateMqttConfig({ ...mqttDefaults, port }));
});
test("MQTT rejects invalid IPv4 bindings, ports, fractional and out-of-bound limits", () => {
  const invalid: MqttConfig[] = [
    ...[
      "224.0.0.1",
      "239.255.255.255",
      "255.255.255.255",
      "127.000.0.1",
      "::1",
      "host.test",
      "192.0.2.256",
    ].map((bind_ip) => ({ ...mqttDefaults, bind_ip })),
    ...[0, 65536, NaN, 1.5].map((port) => ({ ...mqttDefaults, port })),
    ...[0, 129, NaN, 1.5].map((max_connections) => ({
      ...mqttDefaults,
      max_connections,
    })),
    ...[0, 127, 1048577, NaN, 128.5].map((max_packet_size) => ({
      ...mqttDefaults,
      max_packet_size,
    })),
  ];
  invalid.forEach((config) => assert.throws(() => validateMqttConfig(config)));
});
test("MQTT comparison keeps its limits distinct and never classifies it or unknown settings as HTTP", () => {
  assert.equal(sameMqttConfig(mqttDefaults, { ...mqttDefaults }), true);
  assert.equal(
    sameMqttConfig(mqttDefaults, { ...mqttDefaults, max_packet_size: 128 }),
    false,
  );
  assert.equal(
    sameMqttConfig(mqttDefaults, { ...mqttDefaults, max_connections: 1 }),
    false,
  );
  assert.equal(isHttpConfig(mqttDefaults), false);
  assert.equal(
    isHttpConfig({ bind_ip: "127.0.0.1", port: 9999, unknown_mode: "future" }),
    false,
  );
});
