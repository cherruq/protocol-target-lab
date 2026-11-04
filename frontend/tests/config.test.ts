import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaults,
  normalizeConfig,
  sameGeneratedConfig,
  sameStoredConfig,
  validateConfig,
} from "../src/config.ts";

test("legacy Unicode body becomes a byte-length draft without mutating saved semantics", () => {
  const legacy = { bind_ip: "127.0.0.1", port: 18091, response_body: "测试😀" };
  const before = structuredClone(legacy);
  assert.deepEqual(normalizeConfig(legacy), {
    bind_ip: "127.0.0.1",
    port: 18091,
    response_length: 10,
    response_mode: "fixed",
  });
  assert.deepEqual(legacy, before);
  assert.equal(sameStoredConfig(legacy, normalizeConfig(legacy)), false);
});

test("an empty legacy body and explicit zero length stay empty", () => {
  assert.equal(
    normalizeConfig({ bind_ip: "0.0.0.0", port: 18090, response_body: "" })
      .response_length,
    0,
  );
  for (const response_mode of ["fixed", "random"] as const) {
    const config = { ...defaults, response_length: 0, response_mode };
    assert.deepEqual(normalizeConfig(config), config);
    assert.doesNotThrow(() => validateConfig(config));
  }
});

test("dirty and applied comparison preserve length, mode and legacy distinctions", () => {
  assert.equal(sameGeneratedConfig(defaults, { ...defaults }), true);
  assert.equal(
    sameGeneratedConfig(defaults, { ...defaults, response_length: 65 }),
    false,
  );
  assert.equal(
    sameGeneratedConfig(defaults, { ...defaults, response_mode: "random" }),
    false,
  );
  const a = { bind_ip: "0.0.0.0", port: 18090, response_body: "hello" };
  const b = { ...a, response_body: "world" };
  assert.equal(sameStoredConfig(a, b), false);
  assert.equal(sameStoredConfig(a, { ...a }), true);
  assert.equal(sameStoredConfig(a, { ...defaults, response_length: 5 }), false);
});

test("response length accepts both boundaries and rejects invalid or fractional lengths", () => {
  assert.doesNotThrow(() =>
    validateConfig({ ...defaults, response_length: 1048576 }),
  );
  for (const response_length of [-1, 0.5, 1048577, Number.NaN, Infinity]) {
    assert.throws(() => validateConfig({ ...defaults, response_length }));
  }
});
