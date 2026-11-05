import type { RuntimeEnvelope } from "./runtime-status.ts";
import { mplsScenarios, type MplsScenario } from "./mpls-config.ts";
export type MplsRuntime = {
  schema_version: 1;
  protocol: "mpls";
  boot_id: string;
  runtime_id: string;
  config_sha256: string;
  worker_ready_after_bind: boolean;
  event_loop_age_ms: number;
  uptime_ms: number;
  interface: {
    name: string;
    ifindex: number;
    hardware_type: 1;
    mac: string;
    mtu: number;
  };
  link_mode: "docker-bridge" | "host-interface";
  scenario: MplsScenario;
  label: number;
  reply_ttl: number;
  packet_auxdata: true;
  filter: {
    name: "mpls-unicast-ethertype-v1";
    attached: boolean;
    instructions: number[][];
    sha256: string;
    packet_socket_inode: number | string;
  };
  counters: Record<string, number>;
  last_request: Record<string, unknown> | null;
  last_output: Record<string, unknown> | null;
  next_event_id: number;
};
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function number(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
export function mplsRuntimeScenario(v: unknown): MplsScenario | null {
  const mode = typeof v === "string" ? v : null;
  return typeof mode === "string" &&
    mplsScenarios.includes(mode as MplsScenario)
    ? (mode as MplsScenario)
    : null;
}
export function currentMplsRuntime(
  value: RuntimeEnvelope<MplsRuntime> | null,
  cid: string | null,
): MplsRuntime | null {
  const r = value?.runtime;
  return value?.available === true &&
    cid !== null &&
    value.source_container_id === cid &&
    r?.schema_version === 1 &&
    r.protocol === "mpls" &&
    typeof r.boot_id === "string" &&
    /^[0-9a-f-]{36}$/.test(r.boot_id) &&
    typeof r.runtime_id === "string" &&
    /^[0-9a-f]{32}$/.test(r.runtime_id) &&
    typeof r.config_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(r.config_sha256) &&
    typeof r.worker_ready_after_bind === "boolean" &&
    [r.event_loop_age_ms, r.uptime_ms, r.next_event_id].every(number) &&
    r.interface &&
    r.interface.hardware_type === 1 &&
    typeof r.interface.name === "string" &&
    typeof r.interface.mac === "string" &&
    Number.isInteger(r.interface.ifindex) &&
    r.interface.ifindex > 0 &&
    number(r.interface.mtu) &&
    (r.link_mode === "docker-bridge" || r.link_mode === "host-interface") &&
    mplsRuntimeScenario(r.scenario) !== null &&
    Number.isInteger(r.label) &&
    r.label >= 16 &&
    r.label <= 1048575 &&
    Number.isInteger(r.reply_ttl) &&
    r.reply_ttl >= 1 &&
    r.reply_ttl <= 255 &&
    r.packet_auxdata === true &&
    r.filter &&
    r.filter.name === "mpls-unicast-ethertype-v1" &&
    typeof r.filter.attached === "boolean" &&
    typeof r.filter.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(r.filter.sha256) &&
    (typeof r.filter.packet_socket_inode === "string"
      ? /^\d+$/.test(r.filter.packet_socket_inode)
      : number(r.filter.packet_socket_inode)) &&
    Array.isArray(r.filter.instructions) &&
    r.filter.instructions.length >= 1 &&
    r.filter.instructions.length <= 512 &&
    r.filter.instructions.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 4 &&
        row.every(
          (n, i) =>
            Number.isInteger(n) &&
            n >= 0 &&
            n <= (i === 0 ? 65535 : i === 3 ? 4294967295 : 255),
        ),
    ) &&
    record(r.counters) &&
    [
      "rx_frames",
      "accepted",
      "rejected",
      "expired",
      "tx_submitted",
      "suppressed",
      "tx_error",
      "ignored",
      "log_dropped",
    ].every((k) => number(r.counters[k])) &&
    (r.last_request === null || record(r.last_request)) &&
    (r.last_output === null || record(r.last_output))
    ? r
    : null;
}
