import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bannerByteLength,
  isTelnetConfig,
  sameTelnetConfig,
  telnetDefaults,
  validateTelnetConfig,
  type TelnetConfig,
} from "../src/telnet-config.ts";
import { mqttDefaults, isMqttConfig } from "../src/mqtt-config.ts";
import { defaults, isHttpConfig } from "../src/config.ts";
import { dnsDefaults, isDnsConfig } from "../src/dns-config.ts";

test("TELNET banner validation counts UTF-8 bytes and preserves original text", () => {
  const config = { ...telnetDefaults, banner: " 欢迎😀 " };
  const before = structuredClone(config);
  assert.doesNotThrow(() => validateTelnetConfig(config));
  assert.deepEqual(config, before);
  assert.equal(bannerByteLength("欢迎😀"), 10);
  for (const banner of [
    "a".repeat(256),
    "😀".repeat(64),
    "测".repeat(85) + "a",
  ])
    assert.doesNotThrow(() =>
      validateTelnetConfig({ ...telnetDefaults, banner }),
    );
  for (const banner of ["", "a".repeat(257), "😀".repeat(65), "测".repeat(86)])
    assert.throws(() => validateTelnetConfig({ ...telnetDefaults, banner }));
});
test("TELNET rejects every ASCII C0 control and DEL in its single-line banner", () => {
  for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127])
    assert.throws(
      () =>
        validateTelnetConfig({
          ...telnetDefaults,
          banner: `before${String.fromCharCode(code)}after`,
        }),
      undefined,
      `ASCII ${code}`,
    );
});
test("TELNET accepts line/connection/port endpoints and rejects fractional or out-of-range values", () => {
  for (const max_line_bytes of [64, 65536])
    for (const max_connections of [1, 128])
      assert.doesNotThrow(() =>
        validateTelnetConfig({
          ...telnetDefaults,
          max_line_bytes,
          max_connections,
        }),
      );
  for (const port of [1, 65535])
    assert.doesNotThrow(() =>
      validateTelnetConfig({ ...telnetDefaults, port }),
    );
  const invalid: TelnetConfig[] = [
    ...[63, 65537, 64.5, NaN].map((max_line_bytes) => ({
      ...telnetDefaults,
      max_line_bytes,
    })),
    ...[0, 129, 1.5, NaN].map((max_connections) => ({
      ...telnetDefaults,
      max_connections,
    })),
    ...[0, 65536, 1.5, NaN].map((port) => ({ ...telnetDefaults, port })),
    ...["224.0.0.1", "255.255.255.255", "127.000.0.1", "::1"].map(
      (bind_ip) => ({ ...telnetDefaults, bind_ip }),
    ),
  ];
  invalid.forEach((config) =>
    assert.throws(() => validateTelnetConfig(config)),
  );
});
test("TELNET settings are distinct from MQTT, DNS, HTTP and unknown future settings", () => {
  assert.equal(isTelnetConfig(telnetDefaults), true);
  for (const value of [
    mqttDefaults,
    dnsDefaults,
    defaults,
    { banner: "hello", max_connections: 16 },
    {
      banner: "hello",
      max_line_bytes: "4096",
      max_connections: 16,
      bind_ip: "0.0.0.0",
      port: 2323,
    },
  ])
    assert.equal(isTelnetConfig(value), false);
  assert.equal(isMqttConfig(telnetDefaults), false);
  assert.equal(isHttpConfig(telnetDefaults), false);
  assert.equal(isDnsConfig(telnetDefaults), false);
  assert.equal(sameTelnetConfig(telnetDefaults, { ...telnetDefaults }), true);
  assert.equal(
    sameTelnetConfig(telnetDefaults, { ...telnetDefaults, banner: "another" }),
    false,
  );
  assert.equal(
    sameTelnetConfig(telnetDefaults, { ...telnetDefaults, max_line_bytes: 64 }),
    false,
  );
});
