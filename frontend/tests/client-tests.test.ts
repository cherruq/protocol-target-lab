import assert from "node:assert/strict";
import { test } from "node:test";
import {
  elapsedSeconds,
  resultCounts,
  visibleTestRun,
  testDurationLabel,
  type TestRun,
} from "../src/client-tests.ts";

test("switching instance or waiting for a new test never exposes the old result", () => {
  const result = {
    id: "test-a",
    instance_id: "instance-a",
    status: "passed",
  } as TestRun;
  assert.equal(visibleTestRun(result, "instance-b", null), null);
  assert.equal(visibleTestRun(result, "instance-a", "test-b"), null);
  assert.equal(visibleTestRun(result, "instance-a", "test-a"), result);
  assert.equal(visibleTestRun(null, "instance-a", null), null);
});

test("elapsed duration handles second and millisecond timestamps, running and backwards clocks", () => {
  assert.equal(
    elapsedSeconds({ started_at: 1700000000, finished_at: 1700000002.5 }),
    2.5,
  );
  assert.equal(
    elapsedSeconds({ started_at: 1700000000000, finished_at: 1700000002500 }),
    2.5,
  );
  assert.equal(
    elapsedSeconds(
      { started_at: 1700000000, finished_at: null },
      1700000003000,
    ),
    3,
  );
  assert.equal(
    elapsedSeconds({ started_at: 1700000002, finished_at: 1700000000 }),
    0,
  );
});

test("displayed counts come from actual per-check results", () => {
  assert.deepEqual(
    resultCounts([
      { name: "one", passed: true },
      { name: "two", passed: false },
      { name: "three", passed: true },
    ]),
    { total: 3, passed: 2, failed: 1 },
  );
  assert.deepEqual(resultCounts([]), { total: 0, passed: 0, failed: 0 });
});

test("duration labels preserve client precision when manager timestamps share a whole second", () => {
  const run = {
    started_at: 1700000000,
    finished_at: 1700000000,
    report: { passed: true, checks: [], seconds: 0.0184 },
  };
  assert.equal(testDurationLabel(run), "客户端耗时 0.018 秒");
  assert.equal(testDurationLabel({ ...run, report: null }), "总耗时不足 1 秒");
});
