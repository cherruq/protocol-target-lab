import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLOAT32_MAX,
  iec104Defaults,
  iec104StartupDescription,
  isIec104Config,
  sameIec104Config,
  validateIec104Config,
  type Iec104Config,
} from "../src/iec104-config.ts";
import { mqttDefaults } from "../src/mqtt-config.ts";
import { telnetDefaults } from "../src/telnet-config.ts";
import { dnsDefaults } from "../src/dns-config.ts";
import { defaults } from "../src/config.ts";

test("IEC104 accepts the fixed three roles and inclusive address/connection limits", () => {
  assert.doesNotThrow(() => validateIec104Config(iec104Defaults));
  const config = structuredClone(iec104Defaults);
  config.max_connections = 64;
  config.points.single = { ca: 65534, ioa: 16777215, value: true };
  config.points.measured = { ca: 65534, ioa: 16777214, value: -FLOAT32_MAX };
  config.points.command = { ca: 65534, ioa: 16777213 };
  assert.doesNotThrow(() => validateIec104Config(config));
  config.max_connections = 1;
  config.port = 1;
  assert.doesNotThrow(() => validateIec104Config(config));
  config.port = 65535;
  assert.doesNotThrow(() => validateIec104Config(config));
});
test("IEC104 validates unique CA/IOA pairs, not IOA alone, across all roles", () => {
  const config = structuredClone(iec104Defaults);
  assert.equal(config.points.single.ioa, config.points.command.ioa);
  assert.doesNotThrow(() => validateIec104Config(config));
  config.points.command = {
    ca: config.points.single.ca,
    ioa: config.points.single.ioa,
  };
  assert.throws(() => validateIec104Config(config), /全局唯一/);
  const measured = structuredClone(iec104Defaults);
  measured.points.measured.ca = measured.points.single.ca;
  measured.points.measured.ioa = measured.points.single.ioa;
  assert.throws(() => validateIec104Config(measured), /全局唯一/);
});
test("IEC104 rejects invalid CA/IOA and resource values including fractional input", () => {
  for (const role of ["single", "measured", "command"] as const)
    for (const [field, values] of [
      ["ca", [0, 65535, 1.5, NaN]],
      ["ioa", [0, 16777216, 1.5, NaN]],
    ] as const)
      for (const value of values) {
        const config = structuredClone(iec104Defaults);
        config.points[role][field] = value;
        assert.throws(() => validateIec104Config(config));
      }
  for (const max_connections of [0, 65, 1.5, NaN])
    assert.throws(() =>
      validateIec104Config({ ...iec104Defaults, max_connections }),
    );
  for (const port of [0, 65536, 1.5, NaN])
    assert.throws(() => validateIec104Config({ ...iec104Defaults, port }));
  for (const bind_ip of ["224.0.0.1", "255.255.255.255", "127.000.0.1", "::1"])
    assert.throws(() => validateIec104Config({ ...iec104Defaults, bind_ip }));
});
test("IEC104 single is strictly boolean and measured accepts only finite float32 range", () => {
  for (const value of [false, true]) {
    const config = structuredClone(iec104Defaults);
    config.points.single.value = value;
    assert.doesNotThrow(() => validateIec104Config(config));
  }
  for (const value of [0, 1, "false", null]) {
    const config = structuredClone(iec104Defaults);
    (config.points.single as { value: unknown }).value = value;
    assert.equal(isIec104Config(config), false);
    assert.throws(() => validateIec104Config(config));
  }
  for (const value of [-FLOAT32_MAX, FLOAT32_MAX, 0, -0, 0.1, 12.5]) {
    const config = structuredClone(iec104Defaults);
    config.points.measured.value = value;
    assert.doesNotThrow(() => validateIec104Config(config));
  }
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    FLOAT32_MAX * 1.001,
    -FLOAT32_MAX * 1.001,
  ]) {
    const config = structuredClone(iec104Defaults);
    config.points.measured.value = value;
    assert.throws(() => validateIec104Config(config));
  }
});
test("IEC104 configuration and startup display stay distinct from runtime values and other protocols", () => {
  assert.equal(isIec104Config(iec104Defaults), true);
  for (const config of [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    { ...iec104Defaults, points: null },
  ])
    assert.equal(isIec104Config(config), false);
  assert.equal(
    sameIec104Config(iec104Defaults, structuredClone(iec104Defaults)),
    true,
  );
  const changed = structuredClone(iec104Defaults);
  changed.points.single.value = true;
  assert.equal(sameIec104Config(iec104Defaults, changed), false);
  changed.points.single = { ca: 5, ioa: 501, value: true };
  changed.points.command = { ca: 9, ioa: 700 };
  const text = iec104StartupDescription(changed);
  assert.match(text, /非实时/);
  assert.match(text, /初值 true/);
  assert.match(text, /DIRECT 命令 CA 9 \/ IOA 700 → 模拟单点 CA 5 \/ IOA 501/);
});
