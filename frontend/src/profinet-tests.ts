import { guideText } from "./protocol-description.ts";
import type { ProtocolTestRun } from "./protocol-tests.ts";
import { isProfinetConfig, type ProfinetConfig } from "./profinet-config.ts";
export const profinetMethodChecks: Record<string, number> = {
  DCP_READ: 14,
  PTCP_N_DELAY: 2,
  PTCP_F_DELAY: 2,
  PTCP_SYNC: 2,
  PTCP_SYNC_FOLLOW_UP: 2,
  PTCP_ANNOUNCE: 2,
  ALL: 24,
  DCP_WRITE_STATION_TEMP: 1,
  DCP_WRITE_IP_TEMP: 1,
  DCP_SIGNAL: 2,
};
export const profinetMethodRequests: Record<string, number> = {
  DCP_READ: 14,
  PTCP_N_DELAY: 2,
  PTCP_F_DELAY: 2,
  PTCP_SYNC: 2,
  PTCP_SYNC_FOLLOW_UP: 4,
  PTCP_ANNOUNCE: 2,
  ALL: 26,
  DCP_SIGNAL: 2,
};
export function profinetWriteMethod(method: string) {
  return method === "DCP_WRITE_STATION_TEMP" || method === "DCP_WRITE_IP_TEMP";
}
export function profinetActualCount(
  summary: unknown,
  key: string,
): number | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    return null;
  const n = (summary as Record<string, unknown>)[key];
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function profinetResultProblem(
  run: ProtocolTestRun<ProfinetConfig>,
): string | null {
  if (run.status !== "passed") return null;
  const r = run.report,
    n = profinetMethodChecks[run.method];
  if (
    !isProfinetConfig(run.applied_config) ||
    run.path !== "suite" ||
    !n ||
    !r ||
    r.passed !== true ||
    !Array.isArray(r.checks) ||
    r.checks.length !== n ||
    r.checks.some((c) => c.passed !== true) ||
    run.error ||
    r.error ||
    (r.exit_code !== undefined && r.exit_code !== 0)
  )
    return guideText("profinet.overview.profinet-tests.001");
  if (
    profinetActualCount(r.summary, "total") !== n ||
    profinetActualCount(r.summary, "passed") !== n ||
    profinetActualCount(r.summary, "failed") !== 0
  )
    return guideText("profinet.overview.profinet-tests.002");
  const keys = [
    "actual_requests",
    "actual_responses",
    "matched_responses",
    "other_node_responses",
    "unexpected_responses",
  ];
  const counts = keys.map((k) => profinetActualCount(r.summary, k));
  if (counts.some((n) => n === null))
    return guideText("profinet.overview.profinet-tests.003");
  const [req, rx, matched, other, unexpected] = counts as number[];
  if (
    req === 0 ||
    (profinetMethodRequests[run.method] !== undefined &&
      req !== profinetMethodRequests[run.method]) ||
    unexpected !== 0 ||
    rx !== matched + other + unexpected
  )
    return guideText("profinet.overview.profinet-tests.004");
  if (
    ["PTCP_SYNC", "PTCP_SYNC_FOLLOW_UP", "PTCP_ANNOUNCE"].includes(
      run.method,
    ) &&
    rx !== 0
  )
    return guideText("profinet.overview.profinet-tests.005");
  if (profinetWriteMethod(run.method) && r.restoration_complete !== true)
    return guideText("profinet.overview.profinet-tests.006");
  return null;
}
