import type { RuntimeEnvelope } from "./runtime-status.ts";
export type IgmpParameters = {
  sysctl_qrv: number;
  interface_force: number;
  all_force: number;
  v2_unsolicited_interval_ms: number;
  v3_unsolicited_interval_ms: number;
};
export type IgmpRuntime = {
  schema_version: 1;
  protocol: "igmp";
  boot_id: string;
  runtime_id: string;
  config_sha256: string;
  worker_ready_after_bind: boolean;
  event_loop_age_ms: number;
  uptime_ms: number;
  link_mode: string;
  owned_link?: unknown;
  kernel: {
    origin: string;
    release: string;
    network_namespace: { device: number | string; inode: number | string };
  };
  interface: {
    name: string;
    ifindex: number;
    hardware_type: 1;
    mac: string;
    primary_ipv4: string;
    prefixlen: number;
    mtu: number;
  };
  membership: {
    udp_socket_inode: number | string;
    udp_local_address: [string, number];
    groups: {
      group: string;
      joined_age_ms: number;
      preexisting_other_refs: number;
      current_kernel_refs: number;
      other_refs: number;
    }[];
    other_refs_detected: boolean;
  };
  parameters: {
    at_join: IgmpParameters;
    current: IgmpParameters;
    detected_parameter_changes: boolean;
    sysctl_qrv_at_join: number;
    qrv_upper_bound_at_join: number;
    qrv_upper_bound_reason: string;
    startup_upper_ms: number;
  };
  testability: {
    available: boolean;
    remaining_warmup_upper_ms: number;
    reason: string | null;
  };
  packet_socket_inode: number | string;
  counters: Record<string, number>;
  last_query: {
    decoded: Record<string, unknown>;
    metadata: Record<string, unknown>;
  } | null;
  last_report: {
    decoded: Record<string, unknown>;
    metadata: Record<string, unknown>;
  } | null;
  next_event_id: number;
  cache_evictions: number;
};
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function number(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
function inode(v: unknown) {
  return typeof v === "string" ? /^\d+$/.test(v) : number(v);
}
function parameters(v: unknown) {
  return (
    record(v) &&
    [
      "sysctl_qrv",
      "interface_force",
      "all_force",
      "v2_unsolicited_interval_ms",
      "v3_unsolicited_interval_ms",
    ].every((k) => number(v[k]))
  );
}
function wire(v: unknown) {
  return v === null || (record(v) && record(v.decoded) && record(v.metadata));
}
export function currentIgmpRuntime(
  value: RuntimeEnvelope<IgmpRuntime> | null,
  cid: string | null,
): IgmpRuntime | null {
  const r = value?.runtime;
  return value?.available === true &&
    cid !== null &&
    value.source_container_id === cid &&
    r?.schema_version === 1 &&
    r.protocol === "igmp" &&
    [r.boot_id, r.runtime_id, r.config_sha256, r.link_mode].every(
      (v) => typeof v === "string",
    ) &&
    typeof r.worker_ready_after_bind === "boolean" &&
    [
      r.event_loop_age_ms,
      r.uptime_ms,
      r.next_event_id,
      r.cache_evictions,
    ].every(number) &&
    r.kernel &&
    [r.kernel.origin, r.kernel.release].every((v) => typeof v === "string") &&
    r.kernel.network_namespace &&
    [r.kernel.network_namespace.device, r.kernel.network_namespace.inode].every(
      inode,
    ) &&
    r.interface &&
    [r.interface.name, r.interface.mac, r.interface.primary_ipv4].every(
      (v) => typeof v === "string",
    ) &&
    r.interface.hardware_type === 1 &&
    [r.interface.ifindex, r.interface.prefixlen, r.interface.mtu].every(
      number,
    ) &&
    r.membership &&
    inode(r.membership.udp_socket_inode) &&
    Array.isArray(r.membership.udp_local_address) &&
    r.membership.udp_local_address.length === 2 &&
    typeof r.membership.udp_local_address[0] === "string" &&
    number(r.membership.udp_local_address[1]) &&
    typeof r.membership.other_refs_detected === "boolean" &&
    Array.isArray(r.membership.groups) &&
    r.membership.groups.length >= 1 &&
    r.membership.groups.length <= 16 &&
    r.membership.groups.every(
      (g) =>
        g &&
        typeof g.group === "string" &&
        [
          g.joined_age_ms,
          g.preexisting_other_refs,
          g.current_kernel_refs,
          g.other_refs,
        ].every(number),
    ) &&
    r.parameters &&
    parameters(r.parameters.at_join) &&
    parameters(r.parameters.current) &&
    typeof r.parameters.detected_parameter_changes === "boolean" &&
    [
      r.parameters.sysctl_qrv_at_join,
      r.parameters.qrv_upper_bound_at_join,
      r.parameters.startup_upper_ms,
    ].every(number) &&
    typeof r.parameters.qrv_upper_bound_reason === "string" &&
    r.testability &&
    typeof r.testability.available === "boolean" &&
    number(r.testability.remaining_warmup_upper_ms) &&
    (r.testability.reason === null ||
      typeof r.testability.reason === "string") &&
    inode(r.packet_socket_inode) &&
    record(r.counters) &&
    [
      "queries_in",
      "reports_out",
      "reports_v1_out",
      "reports_v2_out",
      "reports_v3_out",
      "reports_in",
      "ignored",
      "rejected_capture",
      "log_dropped",
    ].every((k) => number(r.counters[k])) &&
    wire(r.last_query) &&
    wire(r.last_report)
    ? r
    : null;
}
export function igmpForceDescription(value: number): string {
  return value === 0
    ? "0 · 自动兼容（非强制v2）"
    : value === 2
      ? "2 · 配置值2，仍可能v1回退；结合all与实际Report判读"
      : `${value} · 实际force值，不承诺v2报告`;
}
export function igmpNativeReportDescription(
  record: IgmpRuntime["last_report"],
): string {
  if (!record) return "尚无实际原生Report记录";
  const v = record.decoded.igmp_version,
    t = record.decoded.igmp_type;
  return `${typeof v === "number" && [1, 2, 3].includes(v) ? `v${v}` : "未知版本"} · type ${typeof t === "number" ? `0x${t.toString(16)}` : "未提供"}（实际捕获，不由query profile推断）`;
}

export type IgmpOwnedLinkView = {
  ownerId: string;
  atomicGroup: number;
  alias: string;
  phase: "ready";
  name: string;
  ifindex: number;
  mac: string;
  primaryIpv4: string;
  prefixlen: number;
  mtu: number;
  linkSha256: string;
};
/** Only the whitelisted verified helper view in this source namespace; never render an arbitrary receipt/spec object. */
export function currentIgmpOwnedLink(r: IgmpRuntime): IgmpOwnedLinkView | null {
  const o = r.owned_link;
  if (
    r.link_mode !== "owned-vxlan" ||
    !record(o) ||
    o.ready !== true ||
    o.matches_requested !== true ||
    !record(o.interface) ||
    !record(o.receipt)
  )
    return null;
  const i = o.interface,
    c = o.receipt,
    n = c.network_namespace;
  if (
    c.schema_version !== 1 ||
    c.protocol !== "igmp-link" ||
    typeof c.owner_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      c.owner_id,
    ) ||
    typeof c.atomic_group_id !== "number" ||
    !Number.isInteger(c.atomic_group_id) ||
    c.atomic_group_id < 1 ||
    c.atomic_group_id > 2147483647 ||
    typeof c.alias !== "string" ||
    !c.alias ||
    new TextEncoder().encode(c.alias).length > 256 ||
    c.phase !== "ready" ||
    c.name !== r.interface.name ||
    !Number.isSafeInteger(c.ifindex) ||
    Number(c.ifindex) < 1 ||
    c.ifindex !== r.interface.ifindex ||
    !record(n) ||
    String(n.device) !== String(r.kernel.network_namespace.device) ||
    String(n.inode) !== String(r.kernel.network_namespace.inode) ||
    typeof c.link_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(c.link_sha256) ||
    ![
      "name",
      "ifindex",
      "hardware_type",
      "mac",
      "primary_ipv4",
      "prefixlen",
      "mtu",
    ].every((k) => i[k] === r.interface[k as keyof IgmpRuntime["interface"]])
  )
    return null;
  return {
    ownerId: c.owner_id,
    atomicGroup: c.atomic_group_id,
    alias: c.alias,
    phase: "ready",
    name: r.interface.name,
    ifindex: r.interface.ifindex,
    mac: r.interface.mac,
    primaryIpv4: r.interface.primary_ipv4,
    prefixlen: r.interface.prefixlen,
    mtu: r.interface.mtu,
    linkSha256: c.link_sha256,
  };
}
