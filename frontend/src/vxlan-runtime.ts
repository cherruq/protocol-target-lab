import type { RuntimeEnvelope } from "./runtime-status.ts";
export type VxlanRuntime = {
  schema_version: 1;
  protocol: "vxlan";
  boot_id: string;
  runtime_id: string;
  worker_ready_after_bind: boolean;
  event_loop_age_ms: number;
  receiver: {
    bind_ip: string;
    port: number;
    source_port: number;
    peer_ip: string;
    peer_port: number;
  };
  scenario: { mode: string };
  reply_inner_size: number;
  vni: number;
  counters: {
    received: number;
    accepted: number;
    rejected: number;
    tx_actual: number;
    normal_replies: number;
    suppressed: number;
    log_dropped: number;
  };
  last_valid_request_age_ms: number | null;
  next_request_id: number;
  next_event_id: number;
  cache_evictions: number;
};
export type VxlanRuntimeEnvelope = RuntimeEnvelope<VxlanRuntime>;
export function currentVxlanRuntime(
  value: VxlanRuntimeEnvelope | null,
  containerId: string | null,
): VxlanRuntime | null {
  const r = value?.runtime;
  const numeric = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  return value?.available === true &&
    containerId !== null &&
    value.source_container_id === containerId &&
    r?.schema_version === 1 &&
    r.protocol === "vxlan" &&
    typeof r.worker_ready_after_bind === "boolean" &&
    numeric(r.event_loop_age_ms) &&
    r.receiver &&
    typeof r.receiver.bind_ip === "string" &&
    typeof r.receiver.peer_ip === "string" &&
    [
      r.receiver.port,
      r.receiver.peer_port,
      r.receiver.source_port,
      r.reply_inner_size,
      r.vni,
      r.next_request_id,
      r.next_event_id,
      r.cache_evictions,
    ].every(numeric) &&
    r.scenario &&
    typeof r.scenario.mode === "string" &&
    r.counters &&
    [
      r.counters.received,
      r.counters.accepted,
      r.counters.rejected,
      r.counters.tx_actual,
      r.counters.normal_replies,
      r.counters.suppressed,
      r.counters.log_dropped,
    ].every(numeric) &&
    (r.last_valid_request_age_ms === null ||
      numeric(r.last_valid_request_age_ms))
    ? r
    : null;
}
