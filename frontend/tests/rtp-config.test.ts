import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rtpDefaults,
  isRtpConfig,
  validateRtpConfig,
  sameRtpConfig,
  rtpDescription,
} from "../src/rtp-config.ts";
import { mqttDefaults } from "../src/mqtt-config.ts";
import { defaults, isHttpConfig } from "../src/config.ts";

test("RTP capacity and endpoint bounds use full UDP datagrams, distinct from MQTT limits", () => {
  assert.doesNotThrow(() => validateRtpConfig(rtpDefaults));
  for (const bind_ip of ["0.0.0.0", "127.0.0.1", "192.0.2.28"])
    for (const port of [1, 65535])
      for (const max_packet_size of [64, 2048, 65507])
        assert.doesNotThrow(() =>
          validateRtpConfig({ bind_ip, port, max_packet_size }),
        );
  for (const max_packet_size of [0, 63, 65508, 128.5, NaN, Infinity])
    assert.throws(() => validateRtpConfig({ ...rtpDefaults, max_packet_size }));
  for (const port of [0, 65536, 1.5, NaN])
    assert.throws(() => validateRtpConfig({ ...rtpDefaults, port }));
  for (const bind_ip of [
    "224.0.0.1",
    "239.192.0.2",
    "255.255.255.255",
    "127.000.0.1",
    "::1",
    "host.test",
    "256.0.0.1",
  ])
    assert.throws(() => validateRtpConfig({ ...rtpDefaults, bind_ip }));
});
test("RTP configuration cannot become MQTT, HTTP or a future unknown shape", () => {
  assert.equal(isRtpConfig(rtpDefaults), true);
  for (const other of [
    mqttDefaults,
    defaults,
    {},
    null,
    { ...rtpDefaults, future_mode: true },
    { ...rtpDefaults, max_packet_size: "64" },
  ])
    assert.equal(isRtpConfig(other), false);
  assert.equal(isHttpConfig(rtpDefaults), false);
  assert.equal(sameRtpConfig(rtpDefaults, structuredClone(rtpDefaults)), true);
  for (const config of [
    { ...rtpDefaults, port: 18324 },
    { ...rtpDefaults, bind_ip: "127.0.0.1" },
    { ...rtpDefaults, max_packet_size: 64 },
  ])
    assert.equal(sameRtpConfig(rtpDefaults, config), false);
  assert.match(rtpDescription(rtpDefaults), /UDP.*2,048 字节.*接收/);
});
