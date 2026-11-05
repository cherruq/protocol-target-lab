import type { RuntimeEnvelope } from "./runtime-status.ts";
export type CustomEthernetRuntime = {
  schema_version: 1;
  protocol: "custom-ethernet";
  boot_id: string;
  runtime_id: string;
  config_sha256: string;
  worker_ready_after_bind: boolean;
  event_loop_age_ms: number;
  uptime_ms: number;
  interface: { name: string; ifindex: number; mac: string; mtu: number };
  link_mode: string;
  response_mode: "payload" | "frame";
  filter: {
    instructions: number[][];
    sha256: string;
    installed: boolean;
    readback_instructions: number[][];
    packet_socket_inode: number | string;
  };
  library: { version: string; sha256: string };
  counters: Record<string, number>;
  last_received: Record<string, unknown> | null;
  last_sent: Record<string, unknown> | null;
  next_event_id: number;
  next_request_id: number;
  cache_evictions: number;
};
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function preview(v: unknown) {
  return (
    record(v) &&
    number(v.request_id) &&
    number(v.wire_length) &&
    typeof v.raw_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(v.raw_sha256) &&
    typeof v.preview_hex === "string" &&
    /^(?:[0-9a-f]{2}){0,128}$/.test(v.preview_hex) &&
    typeof v.truncated === "boolean"
  );
}
function number(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
function instructions(v: unknown) {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= 512 &&
    v.every(
      (x) =>
        Array.isArray(x) &&
        x.length === 4 &&
        x.every(
          (y, i) =>
            typeof y === "number" &&
            Number.isInteger(y) &&
            y >= 0 &&
            y <= (i === 0 ? 65535 : i === 3 ? 4294967295 : 255),
        ),
    )
  );
}
export function currentCustomEthernetRuntime(
  value: RuntimeEnvelope<CustomEthernetRuntime> | null,
  cid: string | null,
): CustomEthernetRuntime | null {
  const r = value?.runtime;
  return value?.available === true &&
    cid !== null &&
    value.source_container_id === cid &&
    r?.schema_version === 1 &&
    r.protocol === "custom-ethernet" &&
    [r.boot_id, r.runtime_id, r.config_sha256, r.link_mode].every(
      (x) => typeof x === "string",
    ) &&
    typeof r.worker_ready_after_bind === "boolean" &&
    [
      r.event_loop_age_ms,
      r.uptime_ms,
      r.next_event_id,
      r.next_request_id,
      r.cache_evictions,
    ].every(number) &&
    r.interface &&
    typeof r.interface.name === "string" &&
    typeof r.interface.mac === "string" &&
    [r.interface.ifindex, r.interface.mtu].every(number) &&
    (r.response_mode === "payload" || r.response_mode === "frame") &&
    r.filter &&
    typeof r.filter.installed === "boolean" &&
    typeof r.filter.sha256 === "string" &&
    instructions(r.filter.instructions) &&
    instructions(r.filter.readback_instructions) &&
    (typeof r.filter.packet_socket_inode === "string" ||
      number(r.filter.packet_socket_inode)) &&
    r.library &&
    [r.library.version, r.library.sha256].every((x) => typeof x === "string") &&
    record(r.counters) &&
    [
      "received",
      "outgoing_ignored",
      "rejected",
      "accepted",
      "tx_actual",
      "log_dropped",
    ].every((k) => number(r.counters[k])) &&
    (r.last_received === null || preview(r.last_received)) &&
    (r.last_sent === null || preview(r.last_sent))
    ? r
    : null;
}
