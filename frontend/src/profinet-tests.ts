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
    return "PROFINET结果不完整或互相矛盾，不能确认通过；须含当前方法全部实际检查，不从exit0或空报告推定成功。";
  if (
    profinetActualCount(r.summary, "total") !== n ||
    profinetActualCount(r.summary, "passed") !== n ||
    profinetActualCount(r.summary, "failed") !== 0
  )
    return "检查组汇总与逐项结果不一致，不能确认通过。";
  const keys = [
    "actual_requests",
    "actual_responses",
    "matched_responses",
    "other_node_responses",
    "unexpected_responses",
  ];
  const counts = keys.map((k) => profinetActualCount(r.summary, k));
  if (counts.some((n) => n === null))
    return "实际请求、目标匹配、其他节点与异常计数未完整提供，不能确认通过。";
  const [req, rx, matched, other, unexpected] = counts as number[];
  if (
    req === 0 ||
    (profinetMethodRequests[run.method] !== undefined &&
      req !== profinetMethodRequests[run.method]) ||
    unexpected !== 0 ||
    rx !== matched + other + unexpected
  )
    return "PROFINET实际计数矛盾，不能把计划数、合法其他节点或异常帧冒作当前目标通过。";
  if (
    ["PTCP_SYNC", "PTCP_SYNC_FOLLOW_UP", "PTCP_ANNOUNCE"].includes(
      run.method,
    ) &&
    rx !== 0
  )
    return "Sync/Announce接纳没有线上ACK，请核对报告响应归类。";
  if (profinetWriteMethod(run.method) && r.restoration_complete !== true)
    return "写测试尚未核验当前/NV/OS语义恢复；容器已清理不等于配置已恢复，不能确认通过。";
  return null;
}
