import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rtcpDefaults,
  isRtcpConfig,
  validateRtcpConfig,
  sameRtcpConfig,
  rtcpDescription,
  type RtcpConfig,
} from "../src/rtcp-config.ts";
import { rtpDefaults, isRtpConfig } from "../src/rtp-config.ts";
import { mqttDefaults } from "../src/mqtt-config.ts";

test("RTCP capacity accepts 65507 and unaligned capacities while describing the 65504 wire boundary", () => {
  for (const max_packet_size of [64, 65, 2048, 65504, 65505, 65507])
    assert.doesNotThrow(() =>
      validateRtcpConfig({ ...rtcpDefaults, max_packet_size }),
    );
  for (const max_packet_size of [63, 65508, 128.5, NaN, Infinity])
    assert.throws(() =>
      validateRtcpConfig({ ...rtcpDefaults, max_packet_size }),
    );
  const description = rtcpDescription({
    ...rtcpDefaults,
    max_packet_size: 65507,
  });
  assert.ok(description.includes((65507).toLocaleString()));
  assert.ok(description.includes((65504).toLocaleString()));
  for (const port of [1, 65535])
    assert.doesNotThrow(() => validateRtcpConfig({ ...rtcpDefaults, port }));
  for (const port of [0, 65536, 1.5, NaN])
    assert.throws(() => validateRtcpConfig({ ...rtcpDefaults, port }));
  for (const bind_ip of ["0.0.0.0", "127.0.0.1", "192.0.2.28"])
    assert.doesNotThrow(() => validateRtcpConfig({ ...rtcpDefaults, bind_ip }));
  for (const bind_ip of [
    "224.0.0.1",
    "255.255.255.255",
    "127.000.0.1",
    "::1",
    "host.test",
  ])
    assert.throws(() => validateRtcpConfig({ ...rtcpDefaults, bind_ip }));
});
test("RTCP requires the explicit fixed profile and stays distinct from the unchanged RTP shape", () => {
  assert.equal(isRtcpConfig(rtcpDefaults), true);
  for (const value of [undefined, null, "", "rr", "SR-SDES"]) {
    const config = { ...rtcpDefaults, packet_profile: value };
    assert.equal(isRtcpConfig(config), false);
    assert.throws(() => validateRtcpConfig(config as RtcpConfig));
  }
  for (const config of [
    rtpDefaults,
    mqttDefaults,
    { ...rtcpDefaults, observer_url: "http://unused.invalid" },
  ])
    assert.equal(isRtcpConfig(config), false);
  assert.equal(isRtpConfig(rtcpDefaults), false);
  assert.equal(
    sameRtcpConfig(rtcpDefaults, structuredClone(rtcpDefaults)),
    true,
  );
  assert.equal(
    sameRtcpConfig(rtcpDefaults, { ...rtcpDefaults, max_packet_size: 64 }),
    false,
  );
  assert.equal(
    JSON.stringify(rtpDefaults),
    '{"bind_ip":"0.0.0.0","port":5004,"max_packet_size":2048}',
  );
});
