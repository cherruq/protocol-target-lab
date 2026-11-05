import test from "node:test";
import assert from "node:assert/strict";
import {
  mplsResultProblem,
  mplsUnexpectedCount,
  mplsUnexpectedPeer,
} from "../src/mpls-tests.ts";
import { mplsDefaults, mplsDescription } from "../src/mpls-config.ts";
import type { ProtocolTestRun } from "../src/protocol-tests.ts";
const run = (): ProtocolTestRun<typeof mplsDefaults> => ({
  id: "r",
  instance_id: "mpls-demo",
  method: "ALL",
  path: "echo",
  status: "passed",
  started_at: 1,
  finished_at: 2,
  source_container_id: "cid",
  container_name: "client",
  applied_config: structuredClone(mplsDefaults),
  report: {
    passed: true,
    exit_code: 0,
    summary: { actual_requests: 8, actual_responses: 6 },
    checks: Array.from({ length: 8 }, (_, i) => ({
      name: "actual" + i,
      passed: true,
      request: { sha256: "sent" },
      response: { proof: "actual" },
    })),
  },
  error: null,
  cleanup_complete: true,
});
test("MPLS empty/missing/partial result and exit0 alone never establish passed state", () => {
  for (const mutate of [
    (r: ReturnType<typeof run>) => {
      r.report = null;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.checks = [];
    },
    (r: ReturnType<typeof run>) => {
      r.report!.checks.pop();
    },
    (r: ReturnType<typeof run>) => {
      r.report!.passed = false;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.exit_code = 1;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.checks[0].passed = false;
    },
    (r: ReturnType<typeof run>) => {
      r.report!.error = "environment_unavailable: tx_error errno22";
    },
    (r: ReturnType<typeof run>) => {
      r.method = "NOT_A_CASE";
    },
  ]) {
    const r = run();
    mutate(r);
    assert.match(mplsResultProblem(r)!, /不能确认通过/);
  }
});
test("MPLS current applied mode may pass only complete8 ALL or2 selected checks; failed short13 stays error", () => {
  for (const mode of ["normal", "silent", "short-ipv4"] as const) {
    const r = run();
    r.applied_config.scenario.mode = mode;
    r.report!.summary!.actual_responses = mode === "silent" ? 0 : 6;
    assert.equal(mplsResultProblem(r), null);
    r.method = "INVALID_REQUEST";
    assert.ok(mplsResultProblem(r));
    r.report!.checks = r.report!.checks.slice(0, 2);
    r.report!.summary = { actual_requests: 2, actual_responses: 0 };
    assert.equal(mplsResultProblem(r), null);
  }
  const r = run();
  r.applied_config.scenario.mode = "short-ethernet";
  r.status = "error";
  r.report = {
    passed: false,
    checks: [],
    error: "environment_unavailable: tx_error errno22",
  };
  assert.equal(mplsResultProblem(r), null);
  assert.equal(r.status, "error");
});

test("MPLS matching true checks cannot override missing or contradictory actual request/response totals", () => {
  for (const summary of [
    undefined,
    {},
    { actual_requests: 0, actual_responses: 0 },
    { actual_requests: 8, actual_responses: 8 },
    { actual_requests: true, actual_responses: 6 },
    { actual_requests: 8, actual_responses: null },
  ]) {
    const r = run();
    r.report!.summary = summary;
    assert.match(mplsResultProblem(r)!, /实际请求/);
  }
  const r = run();
  r.applied_config.scenario.mode = "silent";
  assert.ok(mplsResultProblem(r));
  r.report!.summary = { actual_requests: 8, actual_responses: 0 };
  assert.equal(mplsResultProblem(r), null);
  r.method = "ECHO";
  r.report!.checks = r.report!.checks.slice(0, 2);
  r.report!.summary = { actual_requests: 2, actual_responses: 0 };
  assert.equal(mplsResultProblem(r), null);
  r.applied_config.scenario.mode = "normal";
  assert.ok(mplsResultProblem(r));
  r.report!.summary.actual_responses = 2;
  assert.equal(mplsResultProblem(r), null);
});

test("MPLS malformed historical snapshot is diagnosed without coercion or rendering as another protocol", () => {
  const r = run();
  r.applied_config = { wire_profile: "http" } as typeof mplsDefaults;
  assert.match(mplsResultProblem(r)!, /配置快照/);
  assert.match(mplsDescription(r.applied_config), /不匹配/);
});

test("MPLS failed reports preserve unlimited actual unexpected counts and real frame/metadata/association evidence", () => {
  const r = run();
  r.status = "failed";
  r.report!.passed = false;
  r.report!.summary = {
    actual_requests: 2,
    actual_responses: 17,
    unexpected_responses: 17,
  };
  const response = {
    unexpected_peer: [
      {
        frame: {
          wire_length: 60,
          sha256: "full-hash",
          preview_hex: "0200",
          truncated: true,
        },
        metadata: { packet_type: 0, ifindex: 2 },
        association_reason: "current ICMP id/sequence, altered payload",
      },
    ],
    unexpected_peer_total: 17,
    unexpected_peer_truncated: true,
  };
  r.report!.checks[0].response = response;
  const before = JSON.stringify(r);
  assert.equal(mplsResultProblem(r), null);
  assert.equal(mplsUnexpectedCount(r.report!.summary), 17);
  const view = mplsUnexpectedPeer(response)!;
  assert.equal(view.total, 17);
  assert.equal(view.serverTruncated, true);
  assert.deepEqual(view.frames, response.unexpected_peer);
  assert.equal(JSON.stringify(r), before);
  r.status = "passed";
  r.report!.passed = true;
  r.report!.summary = {
    actual_requests: 8,
    actual_responses: 6,
    unexpected_responses: 1,
  };
  assert.ok(mplsResultProblem(r));
  r.report!.summary.unexpected_responses = 0;
  assert.equal(mplsResultProblem(r), null);
});
test("MPLS optional unexpected counts never invent0 or infer total from a bounded frame prefix", () => {
  for (const value of [
    undefined,
    null,
    {},
    { unexpected_responses: true },
    { unexpected_responses: -1 },
    { unexpected_responses: 1.5 },
  ])
    assert.equal(mplsUnexpectedCount(value), null);
  assert.equal(mplsUnexpectedPeer({ unexpected_peer: [] })?.total, null);
  assert.equal(mplsUnexpectedPeer({ unexpected_peer: "bad" }), null);
  const frames = Array.from({ length: 9 }, (_, i) => ({
    frame: { wire_length: i },
  }));
  const view = mplsUnexpectedPeer({
    unexpected_peer: frames,
    unexpected_peer_total: 100,
    unexpected_peer_truncated: false,
  })!;
  assert.equal(view.frames.length, 8);
  assert.equal(view.total, 100);
  assert.equal(view.displayTruncated, true);
  assert.equal(view.serverTruncated, false);
  assert.equal(frames.length, 9);
});
