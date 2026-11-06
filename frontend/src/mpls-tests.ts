import { guideText } from "./protocol-description.ts";
import type { ProtocolTestRun } from "./protocol-tests.ts";
import { isMplsConfig, type MplsConfig } from "./mpls-config.ts";
/** Additional MPLS-only result sanity: zero exit or an empty report never establishes protocol success. */
export function mplsResultProblem(
  run: ProtocolTestRun<MplsConfig>,
): string | null {
  if (run.status !== "passed") return null;
  if (!isMplsConfig(run.applied_config))
    return guideText("mpls.overview.mpls-tests.001");
  const expected =
    run.method === "ALL"
      ? 8
      : ["ECHO", "TC_TTL", "PADDING", "INVALID_REQUEST"].includes(run.method)
        ? 2
        : 0;
  const r = run.report;
  const expectedResponses =
    run.method === "INVALID_REQUEST" ||
    run.applied_config.scenario.mode === "silent"
      ? 0
      : run.method === "ALL"
        ? 6
        : 2;
  if (
    !expected ||
    run.path !== "echo" ||
    !r ||
    r.passed !== true ||
    !Array.isArray(r.checks) ||
    r.checks.length !== expected ||
    r.checks.some((c) => c.passed !== true) ||
    r.summary?.actual_requests !== expected ||
    r.summary?.actual_responses !== expectedResponses ||
    (r.summary?.unexpected_responses !== undefined &&
      r.summary.unexpected_responses !== 0) ||
    run.error ||
    r.error ||
    (r.exit_code !== undefined && r.exit_code !== 0)
  )
    return guideText("mpls.overview.mpls-tests.002");
  return null;
}

/** Worker actual count; absence is not silently interpreted as zero. */
export function mplsUnexpectedCount(summary: unknown): number | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    return null;
  const value = (summary as Record<string, unknown>).unexpected_responses;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
export function mplsUnexpectedPeer(
  response: unknown,
): {
  frames: unknown[];
  total: number | null;
  serverTruncated: boolean | null;
  displayTruncated: boolean;
} | null {
  if (!response || typeof response !== "object" || Array.isArray(response))
    return null;
  const r = response as Record<string, unknown>;
  if (!Array.isArray(r.unexpected_peer)) return null;
  const n = r.unexpected_peer_total;
  return {
    frames: r.unexpected_peer.slice(0, 8),
    total:
      typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null,
    serverTruncated:
      typeof r.unexpected_peer_truncated === "boolean"
        ? r.unexpected_peer_truncated
        : null,
    displayTruncated: r.unexpected_peer.length > 8,
  };
}
