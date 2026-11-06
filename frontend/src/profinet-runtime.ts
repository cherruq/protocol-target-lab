import { guideText } from "./protocol-description.ts";
import type { RuntimeEnvelope } from "./runtime-status.ts";
import {
  isProfinetIpSuite,
  profinetNScenarios,
  profinetFScenarios,
  type ProfinetIpSuite,
} from "./profinet-config.ts";
export type ProfinetInterface = {
  name: string;
  ifindex: number;
  mac: string;
  hardware_type: 1;
  mtu: number;
  ipv4: { address: string; prefixlen: number }[];
  iflink: number;
  namespace: string;
};
export type ProfinetNativeValue = {
  station_name: string;
  ip_suite: ProfinetIpSuite;
};
export type ProfinetDcp = {
  ready: boolean;
  pid?: number | null;
  start_ticks?: number | null;
  native_binary_sha256?: string | null;
  version?: string | null;
  commit?: string | null;
  tick_sequence?: number;
  tick_age_ms?: number | null;
  snapshot_sequence?: number;
  snapshot_stable?: boolean;
  current?: ProfinetNativeValue | null;
  nonvolatile?: ProfinetNativeValue | null;
  factory?: Record<string, unknown> | null;
};
export type ProfinetPtcp = {
  ready: boolean;
  mode?: string | null;
  scenario?: string | null;
  packet_socket_inode?: number | string;
  packet_filter?: { ethertype: number; protocol: string };
  counters?: Record<string, number> | null;
  pending?: number | null;
  last_request?: Record<string, unknown> | null;
  last_output?: Record<string, unknown> | null;
};
export type ProfinetRuntime = {
  schema_version: 1;
  protocol: "profinet";
  boot_id: string;
  runtime_id: string;
  config_sha256: string;
  worker_ready_after_bind: boolean;
  event_loop_age_ms: number;
  uptime_ms: number;
  interfaces: {
    management: ProfinetInterface | null;
    data: ProfinetInterface | null;
    ptcp_n: ProfinetInterface | null;
    ptcp_f: ProfinetInterface | null;
  };
  components: {
    dcp: ProfinetDcp | null;
    ptcp_n: ProfinetPtcp | null;
    ptcp_f: ProfinetPtcp | null;
  };
  network_apply: null | {
    phase: string;
    sequence: number | null;
    requested: Record<string, unknown> | null;
    actual_ipv4: unknown[];
    actual_routes: unknown[];
    management_unchanged: boolean | null;
    confirmed: boolean;
    error: string | null;
  };
  storage: null | {
    path: string;
    abi: string;
    owner_nonce: string;
    writer_locked: boolean;
    initialized: boolean;
    validation: string;
    durability: string;
    files: unknown[];
    native_nonvolatile_matches_saved: boolean | null;
    error: string | null;
  };
  signal: null | {
    software_only: true;
    state: boolean | null;
    transitions: number;
    last_transition_ms: number | null;
    history: unknown[];
  };
  capture: null | {
    packet_socket_inode: number | string;
    received: number;
    outgoing: number;
    errors: number;
    native_packet_pid_attribution: false;
  };
  next_event_id: number;
  cache_evictions: number;
};
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
function nullable<T>(v: unknown, f: (v: unknown) => v is T): v is T | null {
  return v === null || f(v);
}
function native(v: unknown): v is ProfinetNativeValue {
  return (
    record(v) &&
    typeof v.station_name === "string" &&
    isProfinetIpSuite(v.ip_suite)
  );
}
function iface(v: unknown): v is ProfinetInterface {
  return (
    record(v) &&
    typeof v.name === "string" &&
    num(v.ifindex) &&
    typeof v.mac === "string" &&
    v.hardware_type === 1 &&
    num(v.mtu) &&
    num(v.iflink) &&
    typeof v.namespace === "string" &&
    Array.isArray(v.ipv4) &&
    v.ipv4.every(
      (a) => record(a) && typeof a.address === "string" && num(a.prefixlen),
    )
  );
}
function optional(v: unknown, f: (v: unknown) => boolean) {
  return v === undefined || v === null || f(v);
}
function inode(v: unknown) {
  return typeof v === "string" ? /^\d+$/.test(v) : num(v);
}
function dcp(v: unknown): v is ProfinetDcp {
  return (
    record(v) &&
    typeof v.ready === "boolean" &&
    optional(v.current, native) &&
    optional(v.nonvolatile, native) &&
    optional(v.tick_age_ms, num) &&
    optional(v.pid, num) &&
    optional(v.start_ticks, num) &&
    optional(v.version, (x) => typeof x === "string") &&
    optional(v.commit, (x) => typeof x === "string") &&
    optional(v.native_binary_sha256, (x) => typeof x === "string") &&
    optional(v.snapshot_stable, (x) => typeof x === "boolean")
  );
}
function ptcp(v: unknown, node: "n" | "f"): v is ProfinetPtcp {
  if (
    !record(v) ||
    typeof v.ready !== "boolean" ||
    !optional(v.mode, (x) => typeof x === "string") ||
    !optional(v.scenario, (x) => typeof x === "string") ||
    !optional(v.packet_socket_inode, inode) ||
    !optional(v.pending, num) ||
    !optional(v.counters, (x) => record(x) && Object.values(x).every(num)) ||
    !optional(v.last_request, record) ||
    !optional(v.last_output, record)
  )
    return false;
  if (!v.ready) return true;
  const modes: readonly string[] =
    node === "n" ? profinetNScenarios : profinetFScenarios;
  return (
    v.mode === (node === "n" ? "without-follow-up" : "with-follow-up") &&
    typeof v.scenario === "string" &&
    modes.includes(v.scenario) &&
    record(v.counters) &&
    [
      "received",
      "accepted",
      "rejected",
      "ignored",
      "tx_submitted",
      "tx_errors",
      "pending_expired",
    ].every((k) => num((v.counters as Record<string, unknown>)[k])) &&
    num(v.pending) &&
    inode(v.packet_socket_inode) &&
    record(v.packet_filter) &&
    v.packet_filter.ethertype === 34962 &&
    v.packet_filter.protocol === "ETH_P_PROFINET"
  );
}
export function currentProfinetRuntime(
  value: RuntimeEnvelope<ProfinetRuntime> | null,
  cid: string | null,
): ProfinetRuntime | null {
  const r = value?.runtime;
  if (
    !(
      value?.available === true &&
      cid !== null &&
      value.source_container_id === cid &&
      r?.schema_version === 1 &&
      r.protocol === "profinet" &&
      typeof r.boot_id === "string" &&
      /^[0-9a-f-]{36}$/.test(r.boot_id) &&
      typeof r.runtime_id === "string" &&
      /^[0-9a-f]{32}$/.test(r.runtime_id) &&
      typeof r.config_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(r.config_sha256) &&
      typeof r.worker_ready_after_bind === "boolean" &&
      [
        r.event_loop_age_ms,
        r.uptime_ms,
        r.next_event_id,
        r.cache_evictions,
      ].every(num) &&
      record(r.interfaces) &&
      ["management", "data", "ptcp_n", "ptcp_f"].every((k) =>
        nullable(r.interfaces[k as keyof typeof r.interfaces], iface),
      ) &&
      record(r.components) &&
      nullable(r.components.dcp, dcp) &&
      (r.components.ptcp_n === null || ptcp(r.components.ptcp_n, "n")) &&
      (r.components.ptcp_f === null || ptcp(r.components.ptcp_f, "f"))
    )
  )
    return null;
  if (
    r.network_apply !== null &&
    (!record(r.network_apply) ||
      typeof r.network_apply.phase !== "string" ||
      !(r.network_apply.sequence === null || num(r.network_apply.sequence)) ||
      typeof r.network_apply.confirmed !== "boolean" ||
      !(
        r.network_apply.management_unchanged === null ||
        typeof r.network_apply.management_unchanged === "boolean"
      ) ||
      !Array.isArray(r.network_apply.actual_ipv4) ||
      !Array.isArray(r.network_apply.actual_routes) ||
      !(
        r.network_apply.error === null ||
        typeof r.network_apply.error === "string"
      ))
  )
    return null;
  if (
    r.storage !== null &&
    (!record(r.storage) ||
      typeof r.storage.writer_locked !== "boolean" ||
      typeof r.storage.initialized !== "boolean" ||
      typeof r.storage.path !== "string" ||
      typeof r.storage.abi !== "string" ||
      typeof r.storage.owner_nonce !== "string" ||
      typeof r.storage.validation !== "string" ||
      typeof r.storage.durability !== "string" ||
      !Array.isArray(r.storage.files) ||
      !(
        r.storage.native_nonvolatile_matches_saved === null ||
        typeof r.storage.native_nonvolatile_matches_saved === "boolean"
      ) ||
      !(r.storage.error === null || typeof r.storage.error === "string"))
  )
    return null;
  if (
    r.signal !== null &&
    (!record(r.signal) ||
      r.signal.software_only !== true ||
      !(r.signal.state === null || typeof r.signal.state === "boolean") ||
      !num(r.signal.transitions) ||
      !(
        r.signal.last_transition_ms === null || num(r.signal.last_transition_ms)
      ) ||
      !Array.isArray(r.signal.history))
  )
    return null;
  if (
    r.capture !== null &&
    (!record(r.capture) ||
      r.capture.native_packet_pid_attribution !== false ||
      !inode(r.capture.packet_socket_inode) ||
      ![r.capture.received, r.capture.outgoing, r.capture.errors].every(num))
  )
    return null;
  return r;
}
export function profinetNativeText(v: ProfinetNativeValue | null | undefined) {
  return v
    ? `${guideText("profinet.overview.profinet-runtime.002")}${v.station_name === "" ? guideText("profinet.overview.profinet-runtime.001") : v.station_name} · IP ${v.ip_suite.ip} / mask ${v.ip_suite.netmask} / gateway ${v.ip_suite.gateway}`
    : guideText("profinet.overview.profinet-runtime.003");
}
/** Local process/interface readiness only; never native state application, persistence, sync or peer delivery. */
export function profinetAllLocalReady(
  r: ProfinetRuntime,
  workerAge: number,
  nativeAge: number,
) {
  return Boolean(
    r.worker_ready_after_bind &&
    Object.values(r.interfaces).every(Boolean) &&
    workerAge >= 0 &&
    workerAge <= 2000 &&
    nativeAge >= 0 &&
    nativeAge <= 2000 &&
    r.components.dcp?.ready &&
    r.components.ptcp_n?.ready &&
    r.components.ptcp_f?.ready,
  );
}
