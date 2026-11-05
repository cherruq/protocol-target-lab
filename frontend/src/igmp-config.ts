import { validIpv4 } from "./dns-config.ts";
export type IgmpBridgeLink = { mode: "docker-bridge" };
export type IgmpHostLink = {
  mode: "host-interface";
  interface: string;
  interface_ip: string;
  peer_interface: string | null;
};
export type IgmpVxlanLink = {
  mode: "owned-vxlan";
  outer_interface: string;
  local_outer_ip: string;
  peer_outer_ip: string;
  vni: number;
  udp_port: number;
  mtu: number;
  local_inner_cidr: string;
  local_inner_mac: string;
  peer_inner_ip: string;
  peer_inner_mac: string;
};
export type IgmpLink = IgmpBridgeLink | IgmpHostLink | IgmpVxlanLink;
export type IgmpLinkMode = IgmpLink["mode"];
export type IgmpLinkDrafts = Partial<{
  [M in IgmpLinkMode]: Extract<IgmpLink, { mode: M }>;
}>;
export type IgmpConfig = {
  wire_profile: "linux-kernel-igmp-v2";
  link: IgmpLink;
  groups: string[];
  query_profile: { version: 2; max_response_code: 100 };
};
export const igmpDefaults: IgmpConfig = {
  wire_profile: "linux-kernel-igmp-v2",
  link: { mode: "docker-bridge" },
  groups: ["239.192.19.1"],
  query_profile: { version: 2, max_response_code: 100 },
};
/** Example values are never discovery of the existing target or peer's interface. */
export const igmpHostExample: IgmpHostLink = {
  mode: "host-interface",
  interface: "eth0",
  interface_ip: "192.0.2.20",
  peer_interface: null,
};
export const igmpVxlanExample: IgmpVxlanLink = {
  mode: "owned-vxlan",
  outer_interface: "eth0",
  local_outer_ip: "192.0.2.20",
  peer_outer_ip: "192.0.2.10",
  vni: 1919,
  udp_port: 47895,
  mtu: 1400,
  local_inner_cidr: "198.18.19.20/24",
  local_inner_mac: "02:00:00:00:19:20",
  peer_inner_ip: "198.18.19.10",
  peer_inner_mac: "02:00:00:00:19:10",
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(v).length === expected.length &&
    expected.every((k) => Object.hasOwn(v, k))
  );
}
export function isIgmpLink(v: unknown): v is IgmpLink {
  if (!object(v)) return false;
  if (v.mode === "docker-bridge") return keys(v, ["mode"]);
  if (v.mode === "host-interface")
    return (
      keys(v, ["mode", "interface", "interface_ip", "peer_interface"]) &&
      typeof v.interface === "string" &&
      typeof v.interface_ip === "string" &&
      (v.peer_interface === null || typeof v.peer_interface === "string")
    );
  if (v.mode === "owned-vxlan")
    return (
      keys(v, [
        "mode",
        "outer_interface",
        "local_outer_ip",
        "peer_outer_ip",
        "vni",
        "udp_port",
        "mtu",
        "local_inner_cidr",
        "local_inner_mac",
        "peer_inner_ip",
        "peer_inner_mac",
      ]) &&
      [
        "outer_interface",
        "local_outer_ip",
        "peer_outer_ip",
        "local_inner_cidr",
        "local_inner_mac",
        "peer_inner_ip",
        "peer_inner_mac",
      ].every((k) => typeof v[k] === "string") &&
      ["vni", "udp_port", "mtu"].every((k) => typeof v[k] === "number")
    );
  return false;
}
export function isIgmpConfig(v: unknown): v is IgmpConfig {
  return (
    object(v) &&
    keys(v, ["wire_profile", "link", "groups", "query_profile"]) &&
    v.wire_profile === "linux-kernel-igmp-v2" &&
    isIgmpLink(v.link) &&
    Array.isArray(v.groups) &&
    v.groups.every((g) => typeof g === "string") &&
    object(v.query_profile) &&
    keys(v.query_profile, ["version", "max_response_code"]) &&
    v.query_profile.version === 2 &&
    v.query_profile.max_response_code === 100
  );
}
function iface(v: string) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(v);
}
function unicastIp(v: string) {
  if (!validIpv4(v)) return false;
  const first = Number(v.split(".")[0]);
  return first > 0 && first < 224 && v !== "255.255.255.255";
}
function mac(v: string) {
  return (
    /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(v) &&
    v !== "00:00:00:00:00:00" &&
    !(parseInt(v.slice(0, 2), 16) & 1)
  );
}
function integer(v: number, min: number, max: number) {
  return Number.isInteger(v) && v >= min && v <= max;
}
function ipNumber(v: string) {
  return v.split(".").reduce((n, p) => n * 256 + Number(p), 0);
}
export function validateIgmpConfig(c: IgmpConfig): void {
  if (!isIgmpConfig(c))
    throw new Error(
      "IGMP必须为严格4字段、完整link分支及固定query profile（v2/MRT100），不能含应用port、bind_ip或多余字段。",
    );
  if (
    c.groups.length < 1 ||
    c.groups.length > 16 ||
    new Set(c.groups).size !== c.groups.length ||
    c.groups.some((g) => !validIpv4(g) || !g.startsWith("239."))
  )
    throw new Error(
      "成员组须为1～16个不同的标准239/8 IPv4字面地址；顺序保留，Group-specific只验证第一组。",
    );
  const l = c.link;
  if (l.mode === "host-interface") {
    if (!iface(l.interface) || !unicastIp(l.interface_ip))
      throw new Error(
        "填写目标实际接口名（1～15字符）和非零单播IPv4；启动要求UP Ethernet且恰好一个实际primary地址匹配，不接受secondary歧义。",
      );
    if (
      l.peer_interface !== null &&
      (!iface(l.peer_interface) || l.peer_interface === l.interface)
    )
      throw new Error(
        "内置测试端须显式指定不同的有效本机接口名；留空为null，仅外部客户端，不猜测peer接口。",
      );
  }
  if (l.mode === "owned-vxlan") {
    if (
      !iface(l.outer_interface) ||
      !unicastIp(l.local_outer_ip) ||
      !unicastIp(l.peer_outer_ip) ||
      l.local_outer_ip === l.peer_outer_ip
    )
      throw new Error(
        "VXLAN外层需有效本机接口及两个不同的非零单播IPv4；本地IP实际归属/路由由只读预检核对。",
      );
    if (
      !integer(l.vni, 1, 16777215) ||
      !integer(l.udp_port, 1024, 65535) ||
      !integer(l.mtu, 576, 9000)
    )
      throw new Error(
        "VNI须1～16777215、承载UDP1024～65535、MTU576～9000；启动另核对MTU≤实际underlay MTU-50。",
      );
    const parts = l.local_inner_cidr.split("/"),
      prefix = Number(parts[1]);
    if (
      parts.length !== 2 ||
      !/^(?:1[6-9]|2[0-9]|30)$/.test(parts[1]) ||
      !unicastIp(parts[0]) ||
      !unicastIp(l.peer_inner_ip)
    )
      throw new Error(
        "内层需标准本地IPv4/CIDR（/16～/30）及同网段peer IPv4，不使用示例代替实际参数。",
      );
    const local = ipNumber(parts[0]),
      peer = ipNumber(l.peer_inner_ip),
      size = 2 ** (32 - prefix),
      network = Math.floor(local / size) * size;
    if (
      local === peer ||
      local === network ||
      local === network + size - 1 ||
      peer <= network ||
      peer >= network + size - 1 ||
      [parts[0], l.peer_inner_ip].some(
        (ip) => ip === l.local_outer_ip || ip === l.peer_outer_ip,
      )
    )
      throw new Error(
        "内层两端须为同前缀两个不同的可用主机地址，不能是网络/广播地址或外层地址。实际其他地址/路由冲突由启动预检检查。",
      );
    if (
      !mac(l.local_inner_mac) ||
      !mac(l.peer_inner_mac) ||
      l.local_inner_mac.toLowerCase() === l.peer_inner_mac.toLowerCase()
    )
      throw new Error("VXLAN内层MAC须为两个不同的非零单播6字节地址。");
  }
}
export function normalizeIgmpConfig(c: IgmpConfig): IgmpConfig {
  validateIgmpConfig(c);
  return {
    ...c,
    groups: [...c.groups],
    query_profile: { ...c.query_profile },
    link:
      c.link.mode === "owned-vxlan"
        ? {
            ...c.link,
            local_inner_mac: c.link.local_inner_mac.toLowerCase(),
            peer_inner_mac: c.link.peer_inner_mac.toLowerCase(),
          }
        : { ...c.link },
  };
}
function stable(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(stable)
    : object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
}
export function sameIgmpConfig(a: IgmpConfig, b: IgmpConfig): boolean {
  try {
    return (
      JSON.stringify(stable(normalizeIgmpConfig(a))) ===
      JSON.stringify(stable(normalizeIgmpConfig(b)))
    );
  } catch {
    return false;
  }
}
export function changeIgmpLink(
  c: IgmpConfig,
  mode: IgmpLinkMode,
  cache: IgmpLinkDrafts,
): { config: IgmpConfig; cache: IgmpLinkDrafts } {
  const nextCache = { ...cache, [c.link.mode]: structuredClone(c.link) };
  const link: IgmpLink =
    nextCache[mode] ??
    (mode === "docker-bridge"
      ? { mode }
      : mode === "host-interface"
        ? { ...igmpHostExample, interface: "", interface_ip: "" }
        : {
            ...igmpVxlanExample,
            outer_interface: "",
            local_outer_ip: "",
            peer_outer_ip: "",
          });
  return { config: { ...c, link: structuredClone(link) }, cache: nextCache };
}
export const igmpCaseLabels = {
  GENERAL_QUERY: "General Query（全部组，2轮）",
  GROUP_QUERY: "Group-specific（仅首组，2轮）",
  ALL: "当前成员查询验证（4检查组）",
};
export function igmpLinkDescription(c: IgmpConfig): string {
  const l = c.link;
  return l.mode === "docker-bridge"
    ? "受管隔离bridge · 实际endpoint接口/IP/MAC"
    : l.mode === "host-interface"
      ? `现有接口 ${l.interface} / 实际primary ${l.interface_ip} · ${l.peer_interface ? `本机peer接口 ${l.peer_interface}` : "仅外部客户端"}`
      : `专属kernel VXLAN · VNI ${l.vni} · 承载UDP ${l.udp_port}（非IGMP端口） · ${l.local_inner_cidr}`;
}
export function igmpDescription(c: IgmpConfig): string {
  return `${igmpLinkDescription(c)} · ${c.groups.length}成员组 [${c.groups.join(", ")}] · v2 Query/MRT100（10秒），Group-specific仅首组 ${c.groups[0]}`;
}
export function igmpReportLabel(method: string, snapshot: unknown): string {
  if (!isIgmpConfig(snapshot)) return method;
  return `${method === "ALL" ? "计划4检查组" : method === "GENERAL_QUERY" ? "General两轮/全部成员组" : "Group-specific两轮/仅首组"} · ${snapshot.groups.length}组 / 首组${snapshot.groups[0]} · ${snapshot.link.mode}（测试时生效快照）`;
}

export function igmpBuiltinConfigured(c: IgmpConfig): boolean {
  return c.link.mode !== "host-interface" || c.link.peer_interface !== null;
}
export function igmpPlannedCounts(
  method: string,
  groups: number,
): { checks: number; queries: number; reports: number } | null {
  if (!Number.isInteger(groups) || groups < 1 || groups > 16) return null;
  return method === "GENERAL_QUERY"
    ? { checks: 2, queries: 2, reports: 2 * groups }
    : method === "GROUP_QUERY"
      ? { checks: 2, queries: 2, reports: 2 }
      : method === "ALL"
        ? { checks: 4, queries: 4, reports: 2 * groups + 2 }
        : null;
}
