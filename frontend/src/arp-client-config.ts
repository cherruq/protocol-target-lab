import { validIpv4 } from "./dns-config.ts";
export const arpClientModes = [
  "whois",
  "response-fuzz",
  "rarp",
  "inarp",
] as const;
export type ArpClientMode = (typeof arpClientModes)[number];
export const arpClientScenarios = [
  "normal",
  "wrong-target-ip",
  "wrong-target-mac",
  "unknown-tha",
  "short-arp",
  "nonzero-rarp-proto",
  "nonzero-whois-tha",
] as const;
export type ArpClientScenario = (typeof arpClientScenarios)[number];
export type ArpClientLink =
  | { mode: "docker-bridge" }
  | { mode: "host-interface"; interface: string };
export type ArpClientConfig = {
  wire_profile: "ethernet-ipv4-active-arp";
  link: ArpClientLink;
  source_mac: string;
  source_ip: string;
  server_mac: string;
  server_ip: string;
  assigned_ip: string;
  mode: ArpClientMode;
  request_scenario: { mode: ArpClientScenario };
  interval_ms: number;
  timeout_ms: number;
  retries: number;
};
export const arpClientDefaults: ArpClientConfig = {
  wire_profile: "ethernet-ipv4-active-arp",
  link: { mode: "docker-bridge" },
  source_mac: "02:00:00:00:01:10",
  source_ip: "198.18.1.10",
  server_mac: "02:00:00:00:01:20",
  server_ip: "198.18.1.20",
  assigned_ip: "198.18.1.10",
  mode: "whois",
  request_scenario: { mode: "normal" },
  interval_ms: 500,
  timeout_ms: 1000,
  retries: 0,
};
export const arpClientModeLabels: Record<ArpClientMode, string> = {
  whois: "ARP 查询（主动 Request）",
  "response-fuzz": "ARP 响应插件测试（仍主动请求）",
  rarp: "RARP 获取实验分配地址",
  inarp: "InARP 查询已知 MAC 的协议地址",
};
export const arpClientScenarioLabels: Record<ArpClientScenario, string> = {
  normal: "正常请求",
  "wrong-target-ip": "错误目标 IP（预期无映射）",
  "wrong-target-mac": "错误目标 MAC（预期无映射）",
  "unknown-tha": "未知 RARP THA（预期无映射）",
  "short-arp": "37 字节请求意图（预期无映射）",
  "nonzero-rarp-proto": "非零 RARP 协议字段（正向）",
  "nonzero-whois-tha": "非零 ARP 请求 THA（正向）",
};
export const arpClientAllowedScenarios: Record<
  ArpClientMode,
  readonly ArpClientScenario[]
> = {
  whois: ["normal", "wrong-target-ip", "short-arp", "nonzero-whois-tha"],
  "response-fuzz": [
    "normal",
    "wrong-target-ip",
    "short-arp",
    "nonzero-whois-tha",
  ],
  rarp: ["normal", "unknown-tha", "short-arp", "nonzero-rarp-proto"],
  inarp: ["normal", "wrong-target-mac", "short-arp"],
};
export const arpClientCases = [
  "OBSERVE_REQUEST",
  "MAPPING",
  "REJECT_REPLY",
  "TIMEOUT",
  "ALL",
] as const;
export type ArpClientCase = (typeof arpClientCases)[number];
export const arpClientCaseLabels: Record<string, string> = {
  OBSERVE_REQUEST: "观察实际 incoming 请求（2轮）",
  MAPPING: "响应与映射策略（2轮）",
  REJECT_REPLY: "拒绝错误响应（2轮）",
  TIMEOUT: "真实 pending 期限与静默（2轮）",
  ALL: "当前生效模式 / 场景全部阶段（8项）",
};
function object(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}
function keys(v: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(v).length === expected.length &&
    Object.keys(v).every((k) => expected.includes(k))
  );
}
export function isArpClientLink(v: unknown): v is ArpClientLink {
  return (
    object(v) &&
    (v.mode === "docker-bridge"
      ? keys(v, ["mode"])
      : v.mode === "host-interface" &&
        keys(v, ["mode", "interface"]) &&
        typeof v.interface === "string")
  );
}
/** Shape-only: temporarily incompatible mode/scenario drafts survive switching; validate before saving. */
export function isArpClientConfig(v: unknown): v is ArpClientConfig {
  return (
    object(v) &&
    keys(v, [
      "wire_profile",
      "link",
      "source_mac",
      "source_ip",
      "server_mac",
      "server_ip",
      "assigned_ip",
      "mode",
      "request_scenario",
      "interval_ms",
      "timeout_ms",
      "retries",
    ]) &&
    v.wire_profile === "ethernet-ipv4-active-arp" &&
    isArpClientLink(v.link) &&
    ["source_mac", "source_ip", "server_mac", "server_ip", "assigned_ip"].every(
      (k) => typeof v[k] === "string",
    ) &&
    typeof v.mode === "string" &&
    arpClientModes.includes(v.mode as ArpClientMode) &&
    object(v.request_scenario) &&
    keys(v.request_scenario, ["mode"]) &&
    typeof v.request_scenario.mode === "string" &&
    arpClientScenarios.includes(v.request_scenario.mode as ArpClientScenario) &&
    ["interval_ms", "timeout_ms", "retries"].every(
      (k) => typeof v[k] === "number",
    )
  );
}
export function validArpClientPair(
  mode: ArpClientMode,
  scenario: ArpClientScenario,
): boolean {
  return arpClientAllowedScenarios[mode].includes(scenario);
}
export function positiveArpClientScenario(
  c: Pick<ArpClientConfig, "mode" | "request_scenario">,
): boolean {
  return (
    validArpClientPair(c.mode, c.request_scenario.mode) &&
    ["normal", "nonzero-rarp-proto", "nonzero-whois-tha"].includes(
      c.request_scenario.mode,
    )
  );
}
function roleIp(ip: string): boolean {
  if (!validIpv4(ip)) return false;
  const first = Number(ip.split(".")[0]);
  return (
    first > 0 && !(first >= 224 && first <= 239) && ip !== "255.255.255.255"
  );
}
function mac(v: string): boolean {
  return (
    /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(v) &&
    v !== "00:00:00:00:00:00" &&
    (parseInt(v.slice(0, 2), 16) & 1) === 0
  );
}
export function validateArpClientConfig(c: ArpClientConfig): void {
  if (!isArpClientConfig(c))
    throw new Error(
      "ARP-client 必须含固定 profile、完整12字段和严格 link / request_scenario 对象，不能含 bind_ip、port 或多余字段。",
    );
  if (!validArpClientPair(c.mode, c.request_scenario.mode))
    throw new Error(
      "此请求模式与场景不兼容，请明确选择适用场景；不会自动改回 normal。",
    );
  if (
    !mac(c.source_mac) ||
    !mac(c.server_mac) ||
    c.source_mac.toLowerCase() === c.server_mac.toLowerCase()
  )
    throw new Error(
      "目标与反向对端 MAC 必须是两个不同的完整非零单播地址，保存时统一小写。",
    );
  if (
    ![c.source_ip, c.server_ip, c.assigned_ip].every(roleIp) ||
    c.source_ip === c.server_ip
  )
    throw new Error(
      "实验角色 IP 必须是非零单播 IPv4，不能是0/8、组播或全一广播；源 IP 与预期对端 IP 必须不同。",
    );
  if (
    c.link.mode === "host-interface" &&
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(c.link.interface)
  )
    throw new Error(
      "现有接口名须为1～15个 ASCII 字符，以字母、数字或下划线开头，其余只含字母、数字、下划线、点、连字符。",
    );
  for (const [key, min, max, label] of [
    ["interval_ms", 10, 60000, "组间隔"],
    ["timeout_ms", 10, 60000, "单次响应期限"],
    ["retries", 0, 10, "额外重试次数"],
  ] as const)
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max)
      throw new Error(`${label}必须为 ${min}～${max} 之间的整数。`);
}
export function normalizeArpClientConfig(c: ArpClientConfig): ArpClientConfig {
  validateArpClientConfig(c);
  return {
    ...c,
    source_mac: c.source_mac.toLowerCase(),
    server_mac: c.server_mac.toLowerCase(),
    link:
      c.link.mode === "docker-bridge"
        ? { mode: "docker-bridge" }
        : { mode: "host-interface", interface: c.link.interface },
    request_scenario: { mode: c.request_scenario.mode },
  };
}
export function changeArpClientLink(
  c: ArpClientConfig,
  mode: ArpClientLink["mode"],
): ArpClientConfig {
  return {
    ...c,
    link:
      mode === "docker-bridge"
        ? { mode }
        : {
            mode,
            interface: c.link.mode === "host-interface" ? c.link.interface : "",
          },
  };
}
export function sameArpClientConfig(
  a: ArpClientConfig,
  b: ArpClientConfig,
): boolean {
  return (
    a.wire_profile === b.wire_profile &&
    a.link.mode === b.link.mode &&
    (a.link.mode !== "host-interface" ||
      (b.link.mode === "host-interface" &&
        a.link.interface === b.link.interface)) &&
    a.source_mac.toLowerCase() === b.source_mac.toLowerCase() &&
    a.server_mac.toLowerCase() === b.server_mac.toLowerCase() &&
    a.source_ip === b.source_ip &&
    a.server_ip === b.server_ip &&
    a.assigned_ip === b.assigned_ip &&
    a.mode === b.mode &&
    a.request_scenario.mode === b.request_scenario.mode &&
    a.interval_ms === b.interval_ms &&
    a.timeout_ms === b.timeout_ms &&
    a.retries === b.retries
  );
}
export function arpClientLinkDescription(c: ArpClientConfig): string {
  return c.link.mode === "docker-bridge"
    ? "受管隔离内部 bridge · 双真实虚拟网卡"
    : `现有宿主 Ethernet 接口 ${c.link.interface}（启动时核对真实身份）`;
}
export function arpClientDescription(c: ArpClientConfig): string {
  return `${arpClientLinkDescription(c)} · ${c.mode} / ${c.request_scenario.mode} · 目标 ${c.source_mac.toLowerCase()} / 实验源 ${c.source_ip} · 对端 ${c.server_mac.toLowerCase()} / ${c.server_ip}${c.mode === "rarp" ? ` / 实验分配 ${c.assigned_ip}` : ""} · 间隔 ${c.interval_ms}ms / 期限 ${c.timeout_ms}ms / 额外重试 ${c.retries}`;
}
export function arpClientReportLabel(
  method: string,
  c: ArpClientConfig,
): string {
  return `${c.mode} / ${c.request_scenario.mode} · ${c.link.mode} · ${method === "ALL" ? "全部8项" : arpClientCaseLabels[method] || method}（测试时生效快照）`;
}
export type ArpClientBudget = {
  testable: boolean;
  total_ms: number;
  max_phase_ms: number;
  positive: boolean;
  reason: string | null;
};
/** Frozen integer-ms deadline envelopes; the manager's applied-config preflight remains authoritative. */
export function arpClientBudget(
  c: ArpClientConfig,
  method: ArpClientCase = "ALL",
): ArpClientBudget {
  validateArpClientConfig(c);
  if (!arpClientCases.includes(method))
    throw new Error("不支持的 ARP-client 测试案例。");
  const I = c.interval_ms,
    T = c.timeout_ms,
    W = I + T,
    positive = positiveArpClientScenario(c);
  const phases = {
    OBSERVE_REQUEST: W + 1000,
    MAPPING: W + (positive ? 0 : T) + 1000,
    REJECT_REPLY: W + (positive ? 100 : T) + 1000,
    TIMEOUT: W + T + 1000,
  };
  const selected = method === "ALL" ? Object.values(phases) : [phases[method]],
    total_ms = 2 * selected.reduce((a, b) => a + b, 0) + 4000,
    max_phase_ms = Math.max(...selected);
  const reason =
    T < 250
      ? "响应期限小于250ms，缺少有界反向应答与取证窗口。"
      : max_phase_ms > 4000
        ? "所选案例的阶段预算超过4秒。"
        : total_ms > 30000
          ? "所选测试总预算超过30秒。"
          : null;
  return {
    testable: reason === null,
    total_ms,
    max_phase_ms,
    positive,
    reason,
  };
}
