export type BfdRuntime = {
  schema_version: 1;
  protocol: "bfd";
  boot_id: string;
  runtime_id: string;
  worker_ready_after_bind: boolean;
  event_loop_age_ms: number;
  local_state: string;
  diagnostic: number;
  remote_state: string;
  remote_discriminator: number;
  last_valid_age_ms: number | null;
  negotiated_tx_us: number | null;
  receive_detection_us: number;
  epoch_id: number;
  epoch_peer_discriminator: number;
  scenario: {
    mode: string;
    phase: string;
    poll_started: boolean;
    poll_completed: boolean;
    windows_started: number;
  };
  counters: Record<string, number>;
};
export type BfdRuntimeEnvelope = {
  available: boolean;
  reason?: string;
  source_container_id?: string;
  sample_age_ms?: number;
  runtime?: BfdRuntime;
};
export const bfdStateLabels: Record<string, string> = {
  Up: "Up（双向建立）",
  Down: "Down（未建立）",
  Init: "Init（协商中）",
  AdminDown: "AdminDown（管理停止）",
};
export const bfdDiagnosticLabels: Record<number, string> = {
  0: "无诊断",
  1: "控制检测超时",
  2: "Echo 失败",
  3: "对端报告会话 Down",
  4: "转发平面重置",
  5: "路径 Down",
  6: "连接路径 Down",
  7: "管理停止",
  8: "反向连接路径 Down",
};
/** Never render an Up from a previous selected source container or unsupported status schema. */
export function currentBfdRuntime(
  value: BfdRuntimeEnvelope | null,
  containerId: string | null,
): BfdRuntime | null {
  const r = value?.runtime;
  const numeric = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  return value?.available === true &&
    containerId !== null &&
    value.source_container_id === containerId &&
    r?.schema_version === 1 &&
    r.protocol === "bfd" &&
    typeof r.worker_ready_after_bind === "boolean" &&
    numeric(r.event_loop_age_ms) &&
    Object.hasOwn(bfdStateLabels, r.local_state) &&
    Object.hasOwn(bfdStateLabels, r.remote_state) &&
    [
      r.diagnostic,
      r.remote_discriminator,
      r.receive_detection_us,
      r.epoch_id,
      r.epoch_peer_discriminator,
    ].every(numeric) &&
    (r.negotiated_tx_us === null || numeric(r.negotiated_tx_us)) &&
    (r.last_valid_age_ms === null || numeric(r.last_valid_age_ms)) &&
    r.scenario &&
    typeof r.scenario.mode === "string" &&
    typeof r.scenario.phase === "string" &&
    typeof r.scenario.poll_started === "boolean" &&
    typeof r.scenario.poll_completed === "boolean" &&
    numeric(r.scenario.windows_started) &&
    r.counters &&
    [
      "rx_total",
      "accepted",
      "rejected",
      "tx_periodic",
      "tx_final",
      "suppressed",
    ].every((k) => numeric(r.counters[k]))
    ? r
    : null;
}

export { runtimeHeartbeatAge as bfdHeartbeatAge } from "./runtime-status.ts";
