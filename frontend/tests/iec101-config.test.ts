import assert from "node:assert/strict";
import { test } from "node:test";
import {
  iec101Defaults,
  isIec101Config,
  validateIec101Config,
  sameIec101Config,
  updateIec101Channel,
  iec101Description,
  type Iec101Config,
} from "../src/iec101-config.ts";
import { iec104Defaults } from "../src/iec104-config.ts";
import { rtpDefaults } from "../src/rtp-config.ts";
import { rtcpDefaults } from "../src/rtcp-config.ts";

test("IEC101 keeps two mandatory independent profiles and exact address-width endpoints", () => {
  assert.doesNotThrow(() => validateIec101Config(iec101Defaults));
  for (const kind of ["single", "double"] as const) {
    const max = kind === "single" ? 254 : 65534;
    const maxIoa = kind === "single" ? 255 : 16777215;
    for (const endpoint of [1, max])
      assert.doesNotThrow(() =>
        validateIec101Config(
          updateIec101Channel(iec101Defaults, kind, {
            link_address: endpoint,
            common_address: endpoint,
            point: { ioa: maxIoa, value: false },
            single_char_ack: true,
          }),
        ),
      );
    for (const [key, values] of [
      ["link_address", [0, max + 1, 1.5, NaN]],
      ["common_address", [0, max + 1, 1.5, NaN]],
      ["port", [0, 65536, 1.5, NaN]],
    ] as const)
      for (const value of values)
        assert.throws(() =>
          validateIec101Config(
            updateIec101Channel(iec101Defaults, kind, { [key]: value }),
          ),
        );
    for (const ioa of [0, maxIoa + 1, 1.5, NaN])
      assert.throws(() =>
        validateIec101Config(
          updateIec101Channel(iec101Defaults, kind, { point: { ioa } }),
        ),
      );
  }
  for (const originator_address of [0, 255])
    assert.doesNotThrow(() =>
      validateIec101Config(
        updateIec101Channel(iec101Defaults, "double", { originator_address }),
      ),
    );
  assert.throws(() =>
    validateIec101Config(
      updateIec101Channel(iec101Defaults, "single", { originator_address: 1 }),
    ),
  );
  assert.throws(() =>
    validateIec101Config(
      updateIec101Channel(iec101Defaults, "double", {
        originator_address: 256,
      }),
    ),
  );
  assert.throws(() =>
    validateIec101Config(
      updateIec101Channel(iec101Defaults, "double", {
        port: iec101Defaults.single.port,
      }),
    ),
  );
  assert.doesNotThrow(() =>
    validateIec101Config(
      updateIec101Channel(iec101Defaults, "double", {
        link_address: 1,
        common_address: 1,
        point: { ioa: 1 },
      }),
    ),
  );
});
test("IEC101 strict shape rejects missing channels, enabled selectors and altered serial literals", () => {
  assert.equal(isIec101Config(iec101Defaults), true);
  const invalid: unknown[] = [
    iec104Defaults,
    rtpDefaults,
    rtcpDefaults,
    { ...iec101Defaults, port: 1 },
    { ...iec101Defaults, single: { ...iec101Defaults.single, enabled: false } },
    { ...iec101Defaults, serial: { ...iec101Defaults.serial, parity: "E" } },
    {
      ...iec101Defaults,
      serial: { ...iec101Defaults.serial, baud_rate: 19200 },
    },
    {
      ...iec101Defaults,
      single: { ...iec101Defaults.single, point: { ioa: 1, value: 1 } },
    },
  ];
  for (const key of Object.keys(iec101Defaults)) {
    const missing = { ...iec101Defaults } as Record<string, unknown>;
    delete missing[key];
    invalid.push(missing);
  }
  for (const config of invalid) {
    assert.equal(isIec101Config(config), false);
    assert.throws(() => validateIec101Config(config as Iec101Config));
  }
  for (const bind_ip of [
    "224.0.0.1",
    "255.255.255.255",
    "127.000.0.1",
    "::1",
    "host.test",
  ])
    assert.throws(() => validateIec101Config({ ...iec101Defaults, bind_ip }));
});
test("IEC101 partial channel edits preserve opposite channel and nested point fields without mutation", () => {
  const edited = updateIec101Channel(iec101Defaults, "single", {
    port: 18661,
    point: { value: false },
  });
  assert.equal(edited.single.point.ioa, 1);
  assert.equal(edited.single.point.value, false);
  assert.deepEqual(edited.double, iec101Defaults.double);
  assert.equal(iec101Defaults.single.port, 24741);
  assert.equal(iec101Defaults.single.point.value, true);
  assert.equal(
    sameIec101Config(iec101Defaults, structuredClone(iec101Defaults)),
    true,
  );
  assert.equal(sameIec101Config(iec101Defaults, edited), false);
  assert.match(iec101Description(edited), /OA不在线编码/);
  assert.match(iec101Description(edited), /2\/2\/2\/3/);
});
