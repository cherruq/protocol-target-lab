import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dlt645Defaults,
  dlt645FixtureDefaults,
  isDlt645Config,
  validateDlt645Config,
  sameDlt645Config,
  dlt645Description,
  type Dlt645Config,
} from "../src/dlt645-config.ts";
import { rtpDefaults, isRtpConfig } from "../src/rtp-config.ts";
import { rtcpDefaults, isRtcpConfig } from "../src/rtcp-config.ts";
import { mqttDefaults } from "../src/mqtt-config.ts";

test("DLT645 validates startup address/energy/period/connection boundaries and preserves address zeros", () => {
  assert.doesNotThrow(() => validateDlt645Config(dlt645Defaults));
  for (const meter_address of ["000000000000", "000000000001", "999999999998"])
    for (const energy_hundredths of [0, 99999999])
      for (const period_minutes of [1, 99])
        for (const max_connections of [1, 128])
          assert.doesNotThrow(() =>
            validateDlt645Config({
              ...dlt645Defaults,
              meter_address,
              energy_hundredths,
              period_minutes,
              max_connections,
            }),
          );
  for (const meter_address of [
    "999999999999",
    "00000000001",
    "0000000000001",
    "１２３４５６７８９０１２",
    "12345678901a",
    " 00000000001",
  ])
    assert.throws(() =>
      validateDlt645Config({ ...dlt645Defaults, meter_address }),
    );
  for (const [key, values] of [
    ["energy_hundredths", [-1, 100000000, 1.5, NaN]],
    ["period_minutes", [0, 100, 1.5, NaN]],
    ["max_connections", [0, 129, 1.5, NaN]],
    ["port", [0, 65536, 1.5, NaN]],
  ] as const)
    for (const value of values)
      assert.throws(() =>
        validateDlt645Config({ ...dlt645Defaults, [key]: value }),
      );
  for (const bind_ip of [
    "224.0.0.1",
    "255.255.255.255",
    "127.000.0.1",
    "::1",
    "host.test",
  ])
    assert.throws(() => validateDlt645Config({ ...dlt645Defaults, bind_ip }));
});
test("DLT645 strict shape and tagged security reject incomplete/extra objects without reclassifying prior protocols", () => {
  assert.equal(isDlt645Config(dlt645Defaults), true);
  for (const config of [
    rtpDefaults,
    rtcpDefaults,
    mqttDefaults,
    { ...dlt645Defaults, wire_profile: "dlt645-1997-tcp" },
    { ...dlt645Defaults, security: { mode: "reject", request_di: "07000001" } },
    { ...dlt645Defaults, security: { mode: "fixture" } },
    { ...dlt645Defaults, extra: true },
    { ...dlt645Defaults, programming_key_enabled: 1 },
  ]) {
    assert.equal(isDlt645Config(config), false);
    assert.throws(() => validateDlt645Config(config as Dlt645Config));
  }
  for (const key of Object.keys(dlt645Defaults)) {
    const missing = { ...dlt645Defaults } as Record<string, unknown>;
    delete missing[key];
    assert.equal(isDlt645Config(missing), false);
  }
  assert.equal(isRtpConfig(dlt645Defaults), false);
  assert.equal(isRtcpConfig(dlt645Defaults), false);
  assert.equal(
    JSON.stringify(rtpDefaults),
    '{"bind_ip":"0.0.0.0","port":5004,"max_packet_size":2048}',
  );
});
test("DLT645 fixture allows only the reference DI subset and exact byte widths without crypto claims", () => {
  const config = { ...dlt645Defaults, security: { ...dlt645FixtureDefaults } };
  for (const request_di of ["07000001", "07000002", "07000003"])
    assert.doesNotThrow(() =>
      validateDlt645Config({
        ...config,
        security: { ...config.security, request_di, response_di: "070000ff" },
      }),
    );
  for (const [key, values] of [
    ["request_di", ["07000004", "00000001"]],
    ["response_di", ["070000FE", "00000000"]],
    ["operator", ["0000000", "000000000", "0000000g"]],
    ["request_hex", ["00", "0x01020304050607", "00 01020304050607"]],
    ["response_hex", ["00", "g".repeat(24)]],
  ] as const)
    for (const value of values)
      assert.throws(() =>
        validateDlt645Config({
          ...config,
          security: { ...config.security, [key]: value },
        }),
      );
  assert.equal(
    sameDlt645Config(config, {
      ...config,
      security: {
        ...config.security,
        response_di: "070000ff",
        response_hex: config.security.response_hex.toUpperCase(),
      },
    }),
    false,
  );
  assert.match(dlt645Description(config), /crypto_verified=false/);
});
test("DLT645 applied descriptions and comparisons distinguish startup values and exact fixture parameters", () => {
  assert.equal(
    sameDlt645Config(dlt645Defaults, structuredClone(dlt645Defaults)),
    true,
  );
  for (const config of [
    { ...dlt645Defaults, meter_address: "000000000002" },
    { ...dlt645Defaults, programming_key_enabled: true },
    { ...dlt645Defaults, period_minutes: 31 },
    { ...dlt645Defaults, energy_hundredths: 0 },
    { ...dlt645Defaults, security: { ...dlt645FixtureDefaults } },
  ])
    assert.equal(sameDlt645Config(dlt645Defaults, config), false);
  assert.match(dlt645Description(dlt645Defaults), /启动表地址 000000000001/);
  assert.match(
    dlt645Description({
      ...dlt645Defaults,
      security: { ...dlt645FixtureDefaults },
    }),
    /07000001 → 070000FF/,
  );
});
