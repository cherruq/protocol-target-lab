import type { RuntimeEnvelope } from "./runtime-status.ts";
export type ArpPending = {
  query_id: number;
  retry_index: number;
  sent_ms: number;
  deadline_ms: number;
  expected_response: boolean;
  unexpected_responses: number;
};
export type ArpLastMapping = {
  query_id: number;
  received_ms: number;
  mapping_kind: string;
  mapping_mac: string;
  mapping_ip: string;
  response_sha256: string;
};
export type ArpClientRuntime = {
  schema_version: 1;
  protocol: "arp-client";
  boot_id: string;
  runtime_id: string;
  worker_ready_after_bind: boolean;
  event_loop_age_ms: number;
  uptime_ms: number;
  interface: { name: string; ifindex: number; hardware_type: 1; mac: string };
  link_mode: string;
  mode: string;
  request_scenario: string;
  pending: ArpPending | null;
  last_mapping: ArpLastMapping | null;
  counters: Record<string, number>;
  next_event_id: number;
  cache_evictions: number;
  protocol_has_transaction_id: false;
  late_identical_response_is_ambiguous: true;
  response_ack_sent: false;
  filter: { name: string; attached: boolean; sha256: string };
};
export type ArpClientRuntimeEnvelope = RuntimeEnvelope<ArpClientRuntime>;
function record(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}
function number(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
function pending(v: unknown): v is ArpPending {
  return (
    record(v) &&
    [
      v.query_id,
      v.retry_index,
      v.sent_ms,
      v.deadline_ms,
      v.unexpected_responses,
    ].every(number) &&
    typeof v.expected_response === "boolean" &&
    Number(v.deadline_ms) >= Number(v.sent_ms)
  );
}
function mapping(v: unknown): v is ArpLastMapping {
  return (
    record(v) &&
    [v.query_id, v.received_ms].every(number) &&
    [v.mapping_kind, v.mapping_mac, v.mapping_ip, v.response_sha256].every(
      (x) => typeof x === "string",
    )
  );
}
export function currentArpClientRuntime(
  value: ArpClientRuntimeEnvelope | null,
  containerId: string | null,
): ArpClientRuntime | null {
  const r = value?.runtime;
  return value?.available === true &&
    containerId !== null &&
    value.source_container_id === containerId &&
    r?.schema_version === 1 &&
    r.protocol === "arp-client" &&
    typeof r.worker_ready_after_bind === "boolean" &&
    [
      r.event_loop_age_ms,
      r.uptime_ms,
      r.next_event_id,
      r.cache_evictions,
    ].every(number) &&
    r.interface &&
    typeof r.interface.name === "string" &&
    number(r.interface.ifindex) &&
    r.interface.hardware_type === 1 &&
    typeof r.interface.mac === "string" &&
    [r.link_mode, r.mode, r.request_scenario].every(
      (x) => typeof x === "string",
    ) &&
    (r.pending === null || pending(r.pending)) &&
    (r.last_mapping === null || mapping(r.last_mapping)) &&
    r.counters &&
    [
      "queries_sent",
      "resolved",
      "timeouts",
      "negative_silent",
      "unexpected_responses",
      "observed_frames",
      "incoming_frames",
      "rejected_frames",
      "ignored_control",
      "ignored_outgoing",
      "log_dropped",
    ].every((k) => number(r.counters[k])) &&
    r.protocol_has_transaction_id === false &&
    r.late_identical_response_is_ambiguous === true &&
    r.response_ack_sent === false &&
    r.filter &&
    typeof r.filter.attached === "boolean" &&
    typeof r.filter.name === "string" &&
    typeof r.filter.sha256 === "string"
    ? r
    : null;
}
/** Only a display estimate from source boot time and monotonic sample transit, never a timeout event. */
export function arpPendingRemainingMs(
  r: ArpClientRuntime,
  sampleElapsedMs: number,
): number | null {
  if (!r.pending) return null;
  if (!Number.isFinite(sampleElapsedMs) || sampleElapsedMs < 0) return 0;
  return Math.max(0, r.pending.deadline_ms - r.uptime_ms - sampleElapsedMs);
}
