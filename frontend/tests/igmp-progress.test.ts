import test from "node:test";
import assert from "node:assert/strict";
import {
  ownIgmpProgress,
  sampledRemainingMs,
  igmpActualCount,
  type IgmpProgress,
} from "../src/igmp-progress.ts";
const sample: IgmpProgress = {
  schema_version: 1,
  test_run_id: "own-run",
  sequence: 0,
  phase: "warmup",
  round: null,
  groups_expected: [],
  groups_covered: [],
  queries_sent: 0,
  reports_matched: 0,
  prequery_reports: 2,
  warmup_remaining_upper_ms: 13000,
  elapsed_ms: 100,
  remaining_ms: 89900,
};
test("IGMP progress accepts only exact run/schema and finite real counts, not stale candidate reports as matches", () => {
  assert.equal(ownIgmpProgress(sample, "own-run", ["239.192.19.1"]), sample);
  assert.equal(ownIgmpProgress(sample, "other-run", ["239.192.19.1"]), null);
  for (const patch of [
    { test_run_id: undefined },
    { schema_version: 2 },
    { sequence: -1 },
    { queries_sent: true },
    { reports_matched: NaN },
    { remaining_ms: Infinity },
    { round: 3 },
    { phase: ["warmup"] },
  ])
    assert.equal(
      ownIgmpProgress({ ...sample, ...patch }, "own-run", ["239.192.19.1"]),
      null,
    );
  assert.equal(sample.prequery_reports, 2);
  assert.equal(sample.reports_matched, 0);
});
test("group coverage remains current applied scope and checks/query/report counts are independent", () => {
  const p = {
    ...sample,
    phase: "general-query" as const,
    round: 1 as const,
    groups_expected: ["239.192.19.1", "239.64.19.1"],
    groups_covered: ["239.192.19.1"],
    queries_sent: 1,
    reports_matched: 1,
  };
  assert.equal(ownIgmpProgress(p, "own-run", p.groups_expected), p);
  assert.equal(
    ownIgmpProgress(
      { ...p, groups_covered: ["239.192.19.2"] },
      "own-run",
      p.groups_expected,
    ),
    null,
  );
  assert.equal(
    ownIgmpProgress(
      { ...p, groups_expected: ["239.192.19.1", "239.192.19.1"] },
      "own-run",
      p.groups_expected,
    ),
    null,
  );
  assert.equal(
    igmpActualCount(
      { total: 4, actual_queries: 4, actual_reports: 34 },
      "actual_reports",
    ),
    34,
  );
  assert.equal(
    igmpActualCount(
      { total: 4, actual_queries: 4, actual_reports: 0 },
      "actual_reports",
    ),
    0,
  );
  assert.equal(igmpActualCount({ total: 4 }, "actual_reports"), null);
});
test("monotonic sampled budget estimates saturate without fabricating completion or effective QRV", () => {
  assert.equal(sampledRemainingMs(13000, 2500), 10500);
  assert.equal(sampledRemainingMs(13000, 14000), 0);
  assert.equal(sampledRemainingMs(90000, 60000), 30000);
  assert.equal(sampledRemainingMs(90000, -1), null);
  assert.equal(sampledRemainingMs(Infinity, 0), null);
});
test("final counts do not coerce booleans/strings/fractions or infer reports from groups", () => {
  for (const x of [
    null,
    [],
    { actual_reports: "4" },
    { actual_reports: true },
    { actual_reports: -1 },
    { actual_reports: 1.2 },
  ])
    assert.equal(igmpActualCount(x, "actual_reports"), null);
  assert.equal(
    igmpActualCount(
      { actual_queries: 2, actual_reports: 32, total: 2 },
      "actual_queries",
    ),
    2,
  );
});
