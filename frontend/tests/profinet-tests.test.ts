import test from "node:test";
import assert from "node:assert/strict";
import { profinetDefaults } from "../src/profinet-config.ts";
import {
  profinetResultProblem,
  profinetActualCount,
} from "../src/profinet-tests.ts";
import type { ProtocolTestRun } from "../src/protocol-tests.ts";
const run = (): ProtocolTestRun<typeof profinetDefaults> => ({
  id: "id",
  instance_id: "profinet-demo",
  method: "ALL",
  path: "suite",
  status: "passed",
  started_at: 1,
  finished_at: 2,
  source_container_id: "cid",
  container_name: "peer",
  applied_config: structuredClone(profinetDefaults),
  report: {
    passed: true,
    exit_code: 0,
    checks: Array.from({ length: 24 }, (_, i) => ({
      name: "real " + i,
      passed: true,
    })),
    summary: {
      total: 24,
      passed: 24,
      failed: 0,
      actual_requests: 26,
      actual_responses: 26,
      matched_responses: 20,
      other_node_responses: 6,
      unexpected_responses: 0,
    },
  },
  error: null,
  cleanup_complete: true,
});
test("three-node readonly24/26 is not empty success and legitimate other-node replies are not mistaken for unexpected", () => {
  const r = run();
  assert.equal(profinetResultProblem(r), null);
  for (const change of [
    (r: ReturnType<typeof run>) => {
      r.report = null;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.checks = [];
    },
    (r: ReturnType<typeof run>) => {
      r.report!.summary!.actual_requests = 24;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.summary!.other_node_responses = 0;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.summary!.unexpected_responses = 1;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.exit_code = 1;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.summary!.passed = 0;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.summary!.total = 0;
    },
  ]) {
    const r = run();
    change(r);
    assert.ok(profinetResultProblem(r));
  }
  assert.equal(
    profinetActualCount({ actual_responses: true }, "actual_responses"),
    null,
  );
});
test("fault response totals are not forced to normal26 or request count; failed oversized raw counts remain untouched", () => {
  const r = run();
  r.applied_config.ptcp_n.scenario.mode = "old-seq-first";
  r.applied_config.ptcp_f.scenario.mode = "old-seq-first";
  r.report!.summary = {
    total: 24,
    passed: 24,
    failed: 0,
    actual_requests: 26,
    actual_responses: 38,
    matched_responses: 26,
    other_node_responses: 12,
    unexpected_responses: 0,
  };
  assert.equal(profinetResultProblem(r), null);
  r.status = "failed";
  r.report!.passed = false;
  r.report!.summary = {
    actual_requests: 2,
    actual_responses: 50,
    matched_responses: 0,
    other_node_responses: 20,
    unexpected_responses: 30,
  };
  const before = JSON.stringify(r);
  assert.equal(profinetResultProblem(r), null);
  assert.equal(JSON.stringify(r), before);
});
test("write transaction restoration is distinct from peer container cleanup and cannot pass when missing", () => {
  const r = run();
  r.method = "DCP_WRITE_IP_TEMP";
  r.report!.checks = r.report!.checks.slice(0, 1);
  r.report!.summary = {
    total: 1,
    passed: 1,
    failed: 0,
    actual_requests: 12,
    actual_responses: 12,
    matched_responses: 12,
    other_node_responses: 0,
    unexpected_responses: 0,
  };
  assert.equal(r.cleanup_complete, true);
  assert.match(profinetResultProblem(r)!, /恢复/);
  r.report!.restoration_complete = false;
  assert.ok(profinetResultProblem(r));
  r.report!.restoration_complete = true;
  assert.equal(profinetResultProblem(r), null);
});
test("shared Sync pair verifies4actual sends and zero ACKs; malformed or incomplete summaries do not pass", () => {
  const r = run();
  r.method = "PTCP_SYNC_FOLLOW_UP";
  r.report!.checks = r.report!.checks.slice(0, 2);
  r.report!.summary = {
    total: 2,
    passed: 2,
    failed: 0,
    actual_requests: 4,
    actual_responses: 0,
    matched_responses: 0,
    other_node_responses: 0,
    unexpected_responses: 0,
  };
  assert.equal(profinetResultProblem(r), null);
  r.report!.summary.actual_responses = 1;
  r.report!.summary.matched_responses = 1;
  assert.match(profinetResultProblem(r)!, /ACK/);
  r.report!.summary.actual_responses = null;
  assert.ok(profinetResultProblem(r));
});
